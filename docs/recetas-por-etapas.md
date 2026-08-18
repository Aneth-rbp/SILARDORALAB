# Recetas por etapas

Una receta por etapas es una sola receta que encadena varios juegos de
parámetros: 5 ciclos de una manera, luego 6 de otra, luego 15 de otra. Todo eso
corre en una sola ejecución, sin que el operador tenga que parar el proceso y
cambiar de receta a media corrida.

Las recetas normales no cambian en nada. Una receta por etapas es un tipo
aparte, con su propio formulario, y las que ya existían siguen guardándose y
ejecutándose exactamente igual que antes.

## Antes de nada: la migración

La funcionalidad necesita la tabla `recipe_stages` y la columna
`recipes.is_staged`. En una base ya instalada se aplican con:

```bash
mysql -u root -p silar_system < database/migration_add_recipe_stages.sql
```

La migración es idempotente: comprueba si la columna existe antes de agregarla y
crea la tabla con `IF NOT EXISTS`. En una instalación nueva no hace falta,
`database/schema.sql` ya la trae.

## Cómo se usa

En **Recetas → Nueva Receta** hay un selector **Modo**:

- **Receta normal**: el formulario de siempre.
- **Receta por etapas**: aparece la lista de etapas.

Cada etapa lleva **los mismos parámetros que una receta normal**: tiempos de
inmersión, ciclos, ventilador, temperatura, offsets, velocidades, exclusiones de
inmersión, posición inicial de Z, longitud de inmersión y las posiciones de los
cuatro vasos. No hay parámetros "globales" que las etapas compartan: cada una es
autónoma.

Las etapas se pueden reordenar, duplicar y eliminar. La etapa nueva sale copiada
de la anterior, porque encadenar etapas casi siempre es repetir el mismo baño
cambiando un par de tiempos o la cantidad de ciclos.

La **duración estimada** de la receta es la suma de las duraciones de sus
etapas, y se recalcula sola.

El máximo son **8 etapas**. El tope lo fija la memoria del Arduino, que es donde
vive la secuencia mientras corre; está escrito en tres sitios que tienen que
coincidir:

| Dónde | Constante |
|---|---|
| `src/arduino/arduino-sketch/SILAR_Control.ino` | `MAX_ETAPAS` |
| `server.js` | `SilarWebServer.MAX_STAGES` |
| `src/public/js/screens/recipes.js` | `RecipesScreen.MAX_STAGES` |

## Qué pasa entre una etapa y la siguiente

Nada: encadenado continuo. Cuando terminan los ciclos de una etapa, la siguiente
empieza de inmediato. **No** se hace home, **no** hay pausa y la lámpara no se
apaga. Solo al terminar la última etapa el proceso apaga lámpara y ventilador y
manda el eje al home.

El ventilador sí es por etapa: si una etapa lo lleva encendido y la siguiente
apagado, cambia en el salto. El pin solo se escribe cuando el estado cambia de
verdad, así que un ventilador encendido en todas las etapas no parpadea.

## Por qué la secuencia vive en el firmware

El PC podría ir mandando una etapa cada vez que termina la anterior, pero eso
significaría un home completo entre etapas, la lámpara parpadeando, y sobre todo
que una caída del PC o un tropiezo del puerto serie dejaría el proceso químico a
medias. Con la lista cargada en el Arduino, PAUSA, REANUDAR, PARO y el paro de
emergencia siguen funcionando igual que en una receta normal, y el PC solo
escucha.

### Protocolo serial

El buffer de recepción del Mega es de 64 bytes, así que las etapas no se mandan
en una sola trama gigante sino de una en una, con acuse:

```
PC  -> RECIPE_BEGIN
ARD <- RECETA_ETAPAS_INICIO
PC  -> ADD_STAGE:{"cycles":5,"dippingWait0":30000,...}
ARD <- ETAPA_AGREGADA: 1/8
PC  -> ADD_STAGE:{"cycles":6,...}
ARD <- ETAPA_AGREGADA: 2/8
PC  -> RECIPE_START
ARD <- PROCESO_INICIADO: Etapas=2, Ciclos=5
ARD <- ETAPA_INICIADA: 1/2 Ciclos=5
ARD <- ETAPA_COMPLETADA: 1/2
ARD <- ETAPA_INICIADA: 2/2 Ciclos=6
ARD <- ETAPA_COMPLETADA: 2/2
ARD <- PROCESO_COMPLETADO
```

Cada trama `ADD_STAGE` pesa lo mismo que el `START_RECIPE` de una receta normal,
que ya funcionaba. `START_RECIPE` sigue existiendo sin cambios para las recetas
normales.

En la interfaz, `ETAPA_INICIADA` se propaga como el evento de socket
`process-stage`, que la pantalla de **Proceso** muestra junto al estado
("Etapa 2/3 · 6 ciclos") y **Monitoreo** en la tarjeta *Etapa*. El servidor lo
reenvía también al conectarse un cliente, para que recargar la página a media
corrida no deje al operador a ciegas.

## Cómo se guarda

- `recipes.is_staged` marca la receta.
- `recipe_stages` guarda la secuencia, una fila por etapa, con las mismas
  columnas que `recipe_parameters` más `stage_order` y un `name` opcional.
- `recipe_parameters` **también** se llena para una receta por etapas, con un
  resumen: la duración y los ciclos son la suma de todas las etapas y el resto
  sale de la primera. Es lo que hace que las pantallas, las consultas y la vista
  `v_recipes_with_parameters` que ya existían sigan funcionando sin saber nada
  de etapas.

Al editar una receta, la lista de etapas se borra y se vuelve a insertar entera:
el operador puede reordenar, quitar o insertar etapas en medio, y casar filas
viejas con nuevas sería adivinar.
