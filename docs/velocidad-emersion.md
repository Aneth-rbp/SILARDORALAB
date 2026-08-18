# Velocidad de emersión

Hasta ahora la receta tenía una sola velocidad para el eje Z: el sustrato bajaba
a la solución y volvía a subir a la misma velocidad. En SILAR eso no da igual.
La emersión es la que decide cuánta solución se queda adherida al sustrato, y
con ella el espesor de la capa: sacarlo despacio deja más que sacarlo rápido.
La inmersión, en cambio, solo tiene que llegar al fondo sin salpicar.

Por eso ahora son dos parámetros:

| Campo | Qué controla |
|---|---|
| **Velocidad Inmersión Z (mm/s)** | La bajada del sustrato hacia la solución |
| **Velocidad Emersión Z (mm/s)** | La subida del sustrato al sacarlo |

Los dos están en el formulario de receta normal y en el de cada etapa, y los dos
van en mm/s, la misma unidad que ya usaban la transferencia y la inmersión.

**Dejar la emersión vacía significa "sube a la misma velocidad con la que
bajaste".** Es exactamente cómo se comportaba el equipo antes, así que las
recetas que ya estaban guardadas corren igual que siempre sin tocarlas.

## Qué hay que hacer para que funcione

Son dos pasos, y los dos hacen falta: con solo uno el campo se guarda pero la
máquina lo ignora.

### 1. La migración de la base

```bash
mysql -u root -p silar_db < database/migration_add_emersion_speed.sql
```

Agrega `emersion_speed` a `recipe_parameters` y a `recipe_stages`. Es
idempotente: comprueba si la columna existe antes de agregarla, así que
volver a correrla no rompe nada. En una instalación nueva no hace falta,
`database/schema.sql` ya la trae.

### 2. Reflashear el Arduino

La ejecución de la inmersión vive en el firmware, no en el PC: es
`ejecutarInmersion()` la que baja el eje, espera y lo vuelve a subir. Mientras
la placa siga con el sketch viejo, el JSON de la receta llegará con el campo
`emersionSpeed` y el firmware simplemente no lo leerá — el sustrato seguirá
subiendo a la velocidad de bajada.

Hay que volver a cargar `src/arduino/arduino-sketch/SILAR_Control.ino` en la
placa. No se pierde la calibración: los bloques `CAL_Z_*` y `CAL_Y_*` viven en
la EEPROM y el flasheo no los toca.

Para comprobar que la placa ya lo entiende, al iniciar una receta el firmware
imprime la línea `PARAMETROS_RECIBIDOS:`, que ahora incluye `EmersionSpeed=` con
la velocidad en mm/s y su equivalente en microsegundos.

## Cómo viaja el parámetro

```
Formulario (mm/s)
  -> POST /api/recipes          parameters.emersionSpeed
  -> MySQL                      recipe_parameters.emersion_speed
                                recipe_stages.emersion_speed
  -> ArduinoController          "emersionSpeed":N dentro de START_RECIPE / ADD_STAGE
  -> Firmware                   recipeParams.emersionSpeedMMs
  -> velocidadEmersionMMs()     0 => usa dipSpeedMMs
  -> velocidadMMsAMicros()      mm/s -> microsegundos entre flancos
```

El 0 se resuelve en `velocidadEmersionMMs()`, al usarlo, y no al recibir la
receta: así el valor guardado sigue significando "igual que la bajada" aunque
después se cambie la velocidad de inmersión. Es el mismo criterio que
`posicionVasoPasos()` con las posiciones de los vasos.

## De paso: los campos en rpm

En el mismo cambio se quitaron del formulario **Velocidad Motor X/Y (rpm)** y
**Aceleración Motor X/Y (rpm/s)**. Se guardaban en la base pero
`construirParametrosReceta()` nunca los metía en el JSON que va al Arduino: el
operador estaba ajustando una velocidad que no hacía nada, al lado de la
*Velocidad Transferencia Y (mm/s)*, que es la que sí manda y describe lo mismo.

Las columnas `velocity_x`, `velocity_y`, `accel_x` y `accel_y` **no** se
borraron: tienen datos de recetas y procesos ya corridos. Simplemente ya no se
piden en la interfaz y se guardan en 0.

La velocidad real de cada eje son las tres en mm/s:

| Campo | Eje |
|---|---|
| Velocidad Transferencia Y (mm/s) | Y, el traslado entre vasos |
| Velocidad Inmersión Z (mm/s) | Z, la bajada |
| Velocidad Emersión Z (mm/s) | Z, la subida |
