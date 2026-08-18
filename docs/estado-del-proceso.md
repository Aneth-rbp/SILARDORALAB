# Estado del proceso

El estado de una corrida vive en tres sitios a la vez: en el firmware
(`procesoActivo` / `procesoPausado`), en la fila de `processes` en MySQL, y en la
pantalla de proceso del navegador. El problema era cómo se mantenían de acuerdo.

## Qué estaba mal

**El estado guardado se llevaba solo con los mensajes sueltos del firmware.**
`PROCESO_PAUSADO`, `PROCESO_COMPLETADO`, `PROCESO_DETENIDO`. Eso falla de dos
maneras:

- **Al pausar y reanudar seguido.** El firmware solo mira el puerto serie entre
  paso y paso del motor, así que su `PROCESO_PAUSADO` puede llegar segundos
  después de haberlo pedido. Si mientras tanto el operador ya reanudó, ese
  mensaje atrasado volvía a marcar `paused` sobre una receta que estaba
  corriendo. Además **no había ningún manejador para `PROCESO_REANUDADO`**: se
  apuntaba la pausa pero nadie apuntaba la vuelta. Tras varios ciclos el estado
  guardado y el real dejaban de coincidir y la pantalla mostraba cualquier cosa.

- **Cuando la corrida termina sin que nadie lo diga.** Paro de emergencia, cable
  USB desconectado, la aplicación cerrada a media receta. En todos esos casos la
  fila se quedaba en `running` **para siempre**, y eso arrastraba tres cosas: no
  se podía iniciar otra receta (`409 Ya hay un proceso ejecutándose`), la
  pantalla seguía mostrando una corrida fantasma, y el updater OTA veía el equipo
  ocupado de por vida y no volvía a instalar nada.

## Cómo se arregló

**La placa es la que tiene la razón.** El firmware ya venía mandando
`ProcessActive` y `ProcessPaused` dentro de cada `STATUS:`, dos veces por
segundo, y nadie los usaba para nada. Ahora `reconciliarProcesoConArduino()` en
[server.js](../server.js) los lee y corrige la base de forma continua: como
mucho, el estado guardado va un segundo por detrás del real.

- Si la placa dice que hay proceso, la fila se pone en `running` o `paused`
  según `ProcessPaused`. Esto solo mata la carrera de pausar/reanudar: da igual
  en qué orden lleguen los mensajes sueltos, un segundo después queda bien.
- Si la placa dice que no hay proceso, se cierra la fila. Se exigen **seis
  lecturas seguidas** para no cerrarla por un `STATUS` llegado a destiempo.
- Se lee una vez por segundo, no las dos que llegan, para no consultar MySQL sin
  motivo. Y si el estado ya es el que toca, no se reescribe ni se avisa a los
  clientes.

**Hay dos momentos en los que "sin proceso" es normal** y el reconciliador no
debe cerrar nada: entre el `INSERT` de la corrida y el `RECIPE_START` (la receta
viaja etapa por etapa y tarda), y justo después de arrancar el servidor.

Para eso está `adoptarProcesosHuerfanos()`. Al arrancar, si encuentra filas en
`running` o `paused` de una ejecución anterior **no las cierra de golpe**: el
Arduino es independiente del PC y puede seguir corriendo la receta tras un
reinicio de la aplicación. Se le dan 30 segundos para reclamarla. Si la reclama,
se adopta y se sigue como si nada. Si no —o si ni siquiera hay placa conectada—
se cierra con `error_message = 'Interrumpido: la aplicación se cerró durante la
corrida'`.

## Los otros arreglos que iban con esto

**Paro de emergencia.** El firmware pone `procesoActivo = false` y ahí se acaban
los avisos: no imprime ningún `PROCESO_DETENIDO`. El servidor no lo estaba
escuchando, así que la receta quedaba abierta. Ahora se cierra con motivo
`'Paro de emergencia'`.

**`"desactivado"` contiene `"activado"`.** [parser.js](../src/arduino/parser.js)
decidía si el paro estaba activo con `line.includes('activado')`, así que leía
*"Paro de emergencia desactivado"* como una activación. El controlador se
quedaba creyendo que el paro seguía puesto y rechazaba el HOME hasta el
siguiente `STATUS`.

**`ORDER BY start_time DESC` sin desempate.** `start_time` es `TIMESTAMP`, con
resolución de un segundo. Dos procesos arrancados en el mismo segundo se
ordenaban al azar, y pausar o detener podía caerle al que no era. Ahora todas
esas consultas llevan `, id DESC`.

**La pantalla no miraba de qué proceso hablaba.**
[process.js](../src/public/js/screens/process.js) solo guardaba el texto del
estado, así que si terminaba una corrida y empezaba otra no se enteraba: el
texto era el mismo (`running`) y todas las comprobaciones eran
`currentStatus !== status`. Ahora guarda el **id** y, en cuanto cambia, se
resincroniza desde cero con la hora de arranque que da el servidor. La limpieza
está toda junta en `clearProcessState()`, porque olvidarse de uno de los cuatro
campos era justo lo que dejaba rastros de la corrida anterior.

**El cronómetro contaba el tiempo en pausa.** Se congelaba durante la pausa y al
reanudar saltaba de golpe con todo el rato que la máquina había estado parada.
Ahora se descuenta.

> Nota: `processes.duration_minutes` sigue guardándose como tiempo de reloj
> entre `start_time` y el final, pausas incluidas. El cronómetro de la pantalla
> y ese campo no miden lo mismo a propósito: uno es tiempo de proceso y el otro
> es cuánto estuvo ocupado el equipo.

## Nada de esto necesita reflashear

Todos los cambios son del lado del PC. El firmware ya mandaba lo que hacía
falta; solo no se estaba escuchando.
