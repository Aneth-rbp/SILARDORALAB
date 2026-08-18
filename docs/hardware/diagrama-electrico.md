# ⚡ Diagrama Eléctrico y Pinout — Sistema SILAR

Documentación del **diagrama de conexiones eléctricas del sistema de control del SILAR** y del **pinout de la tarjeta controladora (Arduino MEGA 2560 REV3)**.

---

## 📋 Datos del plano

| Campo | Valor |
|---|---|
| **Empresa** | MOCTECH-DORALAB — Ingeniería Eléctrica |
| **Título** | Diagrama de control del SILAR |
| **Descripción** | Diagrama de conexiones eléctricas del sistema de control del SILAR |
| **Documento No.** | MOC-ELEC-001 |
| **Revisiones** | REV 2 y REV 3 (ambas en la hoja) |
| **Diseñado por** | REGP |
| **Revisado por** | JMU |
| **Aprobado por** | JMU / JCM / ZW |
| **Fecha** | 03/Abr/2023 |
| **Escala** | N/A |
| **Hoja** | 1 de 1 |

---

## 🏷️ Tabla de etiquetas (nomenclatura de conductores)

### Alimentación AC — Líneas y Neutros

| Etiqueta | Descripción |
|---|---|
| `PS-L01` | Línea (fase) de la fuente de poder 1 |
| `PS-L02` | Línea (fase) de la fuente de poder 2 |
| `PS-L03` | Línea (fase) de la fuente de poder 3 |
| `PS-N01` | Neutro de la fuente de poder 1 |
| `PS-N02` | Neutro de la fuente de poder 2 |
| `PS-N03` | Neutro de la fuente de poder 3 |

> Alimentación general del tablero: **110 VAC**.

### Alimentación DC de control

| Etiqueta | Descripción |
|---|---|
| `CTRL-24VDC` | Positivo 24 VDC (drivers de motores a pasos) |
| `CTRL-0VDC` | Retorno / común de 24 VDC |
| `CTRL-05VDC` | Positivo 5 VDC (lógica de control) |
| `CTRL-0VDC` | Retorno / común de 5 VDC |

> ⚠️ La etiqueta `CTRL-0VDC` aparece **dos veces** en la lista: una como retorno del bus de 24 VDC y otra como retorno del bus de 5 VDC. Verificar en campo si ambos comunes están puenteados o si se mantienen como referencias separadas.

### Bobinas de los motores a pasos

| Etiqueta | Descripción |
|---|---|
| `AY+` / `AY-` | Bobina A del motor del **eje Y** |
| `BY+` / `BY-` | Bobina B del motor del **eje Y** |
| `AZ+` / `AZ-` | Bobina A del motor del **eje Z** |
| `BZ+` / `BZ-` | Bobina B del motor del **eje Z** |

### Señales de control hacia los drivers

| Etiqueta | Señal | Eje |
|---|---|---|
| `PULY+` / `PULY-` | Pulso / Step | Y |
| `DIRY+` / `DIRY-` | Dirección | Y |
| `ENAY+` / `ENAY-` | Habilitación (Enable) | Y |
| `PULZ+` / `PULZ-` | Pulso / Step | Z |
| `DIRZ+` / `DIRZ-` | Dirección | Z |
| `ENAZ+` / `ENAZ-` | Habilitación (Enable) | Z |

> Señales diferenciales (par `+` / `-`) típicas de drivers de motor a pasos con entradas optoacopladas. En el diagrama se aprecia una **resistencia limitadora de ~1.8 kΩ** en la línea de señal.

### Interruptores de límite (limit switches)

| Etiqueta | Descripción |
|---|---|
| `LSY-START` | Límite de inicio / home del eje Y |
| `LSY-END` | Límite final del eje Y |
| `LSZ-START` | Límite de inicio / home del eje Z |
| `LSZ-END` | Límite final del eje Z |
| `LSD-IZQ` | Límite de puerta izquierda |
| `LSD-DER` | Límite de puerta derecha |

---

## 🔌 Diagrama de control — REV 3

Cadena de alimentación y control:

```
110 VAC
  ├── PS-L01/PS-N01 ──> POWER SOURCE 18 VDC ──> PC
  ├── PS-L02/PS-N02 ──> POWER SOURCE  6 VDC ──┐
  └── PS-L03/PS-N03 ──> POWER SOURCE 24 VDC ──┤
                                              │
                        CTRL-24VDC / CTRL-0VDC│
                                              v
              ARDUINO MEGA 2560  ──PUL/DIR/ENA──>  DRIVER Y ──A/B──> STEPPER Y
                    ^                              DRIVER Z ──A/B──> STEPPER Z
                    │
              LIMIT SWITCHES (LSY-*, LSZ-*, LSD-*)
```

**Elementos identificados en la REV 3:**

- Tres fuentes de poder independientes: **18 VDC** (PC), **6 VDC** y **24 VDC** (potencia de drivers).
- Tarjeta **Arduino MEGA 2560** como controlador central.
- Dos **drivers de motor a pasos** (ejes Y y Z), cada uno con entradas `PUL±`, `DIR±`, `ENA±` y salidas `A±`, `B±`.
- Dos **motores a pasos** (STEPPER Y y STEPPER Z).
- Bloque de **limit switches** conectado a las entradas digitales del Arduino.
- Resistencias de aproximadamente **1.8 kΩ** en las líneas de señal.

---

## 🔌 Diagrama de control — REV 2

Diferencias respecto a la REV 3:

```
110 VAC ──> POWER SOURCE 18 VDC ──> PC ──USB──> ARDUINO MEGA 2560
                                     └──> MONITOR ──> SILAR (interfaz)
110 VAC ──> POWER SOURCE 24 VDC ──> DRIVER Y / DRIVER Z ──> STEPPER Y / STEPPER Z
110 VAC ──> Lámpara interior / Extractor
```

- Usa únicamente **dos fuentes**: 18 VDC y 24 VDC (no aparece la fuente de 6 VDC).
- Incluye explícitamente el **monitor** y la aplicación **SILAR** en la cadena.
- Incluye **lámpara interior y extractor** alimentados desde la línea de 110 VAC.
- Muestra la conexión **USB** entre la PC y el Arduino (canal de comunicación serial del software).

> La **REV 3 es la revisión vigente**; la REV 2 se conserva como referencia histórica.

---

## 🧩 Pinout de la tarjeta — Arduino MEGA 2560 REV3

### Leyenda de colores del plano

| Color | Significado |
|---|---|
| ⬛ Negro | Ground (GND) |
| 🟥 Rojo | Power |
| 🟩 Verde | LED |
| ⬜ Gris claro | Internal Pin |
| 🟫 Gris | SWD Pin |
| ⬜ Blanco | Other Pin |
| 🟧 Naranja | Digital Pin |
| 🟧 Naranja claro | Analog Pin |
| 🟨 Amarillo | Default |
| 🟧 Naranja | Microcontroller's Port |

### Características relevantes

- Microcontrolador **ATmega2560**.
- **54 pines digitales** (15 con salida PWM).
- **16 entradas analógicas** (A0–A15).
- Alimentación: **VIN**, **5V**, **3V3**, **GND**.
- Puerto **USB tipo B** para programación y comunicación serial con la PC.
- LEDs integrados: `LED_BUILTIN` (pin 13), `TX`, `RX`, `Power`.
- Cabecera **ICSP** y pin **AREF**.

---

## 🔗 Mapeo con el firmware

Asignación de pines definida en [src/arduino/commands.js](src/arduino/commands.js) (`AXIS_CONFIG`), correlacionada con las etiquetas del plano:

### Eje Y

| Función | Pin Arduino | Etiqueta del plano |
|---|---|---|
| Dirección (DIR) | `2` | `DIRY+` / `DIRY-` |
| Pulso (STEP) | `3` | `PULY+` / `PULY-` |
| Habilitación (ENABLE) | `4` | `ENAY+` / `ENAY-` |
| Home | `9` | `LSY-START` |
| Límite mínimo | `10` | `LSY-START` |
| Límite máximo | `11` | `LSY-END` |

### Eje Z

| Función | Pin Arduino | Etiqueta del plano |
|---|---|---|
| Dirección (DIR) | `5` | `DIRZ+` / `DIRZ-` |
| Pulso (STEP) | `6` | `PULZ+` / `PULZ-` |
| Habilitación (ENABLE) | `7` | `ENAZ+` / `ENAZ-` |
| Home | `12` | `LSZ-START` |
| Límite mínimo | `13` | `LSZ-START` |
| Límite máximo | `8` | `LSZ-END` |

### Otros

| Función | Pin Arduino | Etiqueta del plano |
|---|---|---|
| Paro de emergencia | `14` | — |
| Límite puerta izquierda | *(por confirmar)* | `LSD-IZQ` |
| Límite puerta derecha | *(por confirmar)* | `LSD-DER` |

**Parámetros de movimiento configurados en firmware:**

- `STEPS_PER_REV`: `200` pasos por revolución (ambos ejes).
- `DEFAULT_SPEED`: `1000` µs entre pasos.
- `HOME_SPEED`: `2000` µs entre pasos (búsqueda de home, más lenta).

> ⚠️ Los pines `LSD-IZQ` y `LSD-DER` (límites de puerta) aparecen en el plano eléctrico pero **no están mapeados** en `AXIS_CONFIG`. Confirmar su asignación antes de implementar el enclavamiento de seguridad de puertas.

---

## ✅ Verificaciones recomendadas

1. Confirmar si los comunes de 24 VDC y 5 VDC (`CTRL-0VDC`) están puenteados.
2. Confirmar el valor y ubicación exacta de las resistencias limitadoras (~1.8 kΩ) en las líneas `PUL±` / `DIR±` / `ENA±`.
3. Confirmar la asignación de pines para `LSD-IZQ` y `LSD-DER`.
4. Verificar si la fuente de **6 VDC** de la REV 3 se instaló y qué carga alimenta.
5. Contrastar el sentido de giro real de cada motor con la polaridad de `A±` / `B±`.

---

**Fuente:** Plano MOC-ELEC-001 — MOCTECH-DORALAB, 03/Abr/2023 (REV 2 y REV 3)
**Sistema SILAR** — DORA Lab
