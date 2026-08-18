#include <AccelStepper.h>
#include <ezButton.h>
#include <EEPROM.h>

/*
 * Sistema de Control SILAR - Motores Stepper   
 * Control de ejes Y y Z con límites y home
 * Versión mejorada con soporte para procesos automáticos con parámetros de receta
 * 
 * Hardware: Arduino Mega 2560 Rev3
 * Documento: MOC-ELEC-001 REV 2/3
 * 
 * CONEXIONES SEGÚN DIAGRAMA ELÉCTRICO:
 * - Drivers usan señales diferenciales (PUL+/PUL-, DIR+/DIR-, ENA+/ENA-)
 * - PUL-, DIR-, ENA- normalmente conectados a GND o manejados por el driver
 * - Los pines del Arduino controlan las señales positivas (PUL+, DIR+, ENA+)
 */

// ============================================
// PINES DE CONTROL - EJE Y (STEPPER Y)
// ============================================
const int stepPinY = 2;       // PUL+ para driver Y (D2 - PE4)
const int dirPinY = 3;        // DIR+ para driver Y (D3 - PE5)
const int enablePinY = 4;     // ENA+ para driver Y (D4 - PG5)
const int homePinY = 17;      // Home Y - lsYi (D17) - También funciona como límite inicial/mínimo
const int limitMinY = 17;     // Límite mínimo Y - Mismo que homePinY (lsYi)
const int limitMaxY = 16;     // Límite máximo Y - lsYf (D16)

// ============================================
// PINES DE CONTROL - EJE Z (STEPPER Z)
// ============================================
const int stepPinZ = 5;       // PUL+ para driver Z (D5 - PE3)
const int dirPinZ = 6;        // DIR+ para driver Z (D6 - PH3)
const int enablePinZ = 7;     // ENA+ para driver Z (D7 - PH4)
const int homePinZ = 14;      // Home Z - lsZi (D14) - También funciona como límite inicial/mínimo
const int limitMinZ = 14;     // Límite mínimo Z - Mismo que homePinZ (lsZi)
const int limitMaxZ = 15;     // Límite máximo Z - lsZf (D15)

// ============================================
// PINES DE ENTRADA - SEGURIDAD
// ============================================
const int emergencyPin = 19;   // Paro de emergencia - eStop (D19)

// ============================================
// PINES DE SALIDA - ACCESORIOS
// ============================================
const int lampPin = A1;       // Lámpara interior (A1/D55 - PF1)
const int fanPin = A2;        // Extractor/Ventilador (A2/D56 - PF2)

// Variables de estado
int modo = 1; // 0=Manual, 1=Automatico
bool emergencyStop = false;
long posY = 0;
long posZ = 0;

// Envío periódico de estado a la aplicación
const unsigned long STATUS_INTERVAL_MS = 500;
unsigned long ultimoStatusMs = 0;

// Convención del driver: ENA activo-LOW
// LOW  = motor habilitado (driver activado)
// HIGH = motor deshabilitado (driver desactivado)

// Instancias de motores con AccelStepper (modo DRIVER = señales step/dir)
AccelStepper stepperY(AccelStepper::DRIVER, stepPinY, dirPinY);
AccelStepper stepperZ(AccelStepper::DRIVER, stepPinZ, dirPinZ);

// Parámetros de movimiento predeterminados
const float MAX_SPEED_Y = 2000.0f;      // pasos por segundo
const float MAX_ACCEL_Y = 1500.0f;      // pasos por segundo^2
const float MAX_SPEED_Z = 2000.0f;
const float MAX_ACCEL_Z = 1500.0f;
const unsigned int MIN_PULSE_WIDTH_US = 800; // Duración mínima de pulso STEP (µs) según documentación eléctrica
const unsigned long HOME_TIMEOUT_MS = 20000UL; // Tiempo máximo para encontrar cada home

// --- Calibración del eje Z (medida 2026-08-17) ---
// Método: un solo home y tres movimientos iguales de 1000 pasos, midiendo la
// altura del sustrato sobre el suelo después de cada uno. Las DIFERENCIAS entre
// lecturas dan el recorrido sin depender de dónde esté el cero.
//
//   home -> 275 mm | Z-1000 -> 225 | Z-1000 -> 175 | Z-1000 -> 125
//
// 50 mm por cada 1000 pasos -> 0.05 mm/paso -> 20 pasos/mm (200 pasos = 10 mm).
// Los tres tramos salen idénticos, así que el eje no pierde pasos.
//
// Para recalibrar tras tocar la mecánica, repetir exactamente esa secuencia.
//
// Estos tres valores YA NO son constantes: son los valores de fábrica y a la vez
// el arranque en frío. La pantalla de Configuración (solo administrador) los
// reescribe con CAL_Z_* y los guarda en EEPROM, así que recalibrar ya no obliga
// a recompilar. Ver cargarCalibracionZ() / guardarCalibracionZ() más abajo.
const float PASOS_POR_MM_Z_FABRICA = 20.0f;
const float ALTURA_HOME_MM_FABRICA = 275.0f;
const float ALTURA_MINIMA_MM_FABRICA = 25.0f;

float PASOS_POR_MM_Z = PASOS_POR_MM_Z_FABRICA;
// Altura del sustrato sobre el suelo cuando Z está en home (posZ = 0).
// No se mide con la regla directamente: se DEDUCE de la secuencia de arriba,
// extrapolando el primer tramo hacia atrás (225 + 50 = 275). Medirla a ojo en
// home dio 255 y resultó estar 2 cm baja, lo que descuadraba toda la escala.
float ALTURA_HOME_MM = ALTURA_HOME_MM_FABRICA;
// Altura mínima sobre el suelo a la que se permite llegar. Es el fondo real
// del eje: ninguna altura ni inmersión puede pasar de aquí.
float ALTURA_MINIMA_MM = ALTURA_MINIMA_MM_FABRICA;
// Fondo del eje expresado en pasos, derivado de la calibración de arriba.
// Se recalcula con recalcularLimitesZ() cada vez que cambia la calibración.
long LIMITE_SOFTWARE_Z_ABAJO =
    -(long)((ALTURA_HOME_MM_FABRICA - ALTURA_MINIMA_MM_FABRICA) * PASOS_POR_MM_Z_FABRICA + 0.5f);
// Techo de la receta en pasos: Z nunca sube por encima de este valor mientras
// el proceso automático está activo. 0 = sin techo (comportamiento original).
long techoZReceta = 0;

// Velocidad del viaje inicial hasta dipStartPosition, en microsegundos entre
// flancos: es la unidad interna de moverEjeZVelocidad, no la de la receta, que
// habla en mm/s. Ese tramo es un reposicionamiento en seco, con el sustrato
// fuera de toda solución, así que no tiene por qué ir a la velocidad de emersión
// de la receta: con una emersión lenta (3 mm/s) bajar de home a 70 mm tardaba
// más de un minuto antes de empezar el primer ciclo.
// 250 us = 2000 pasos/s = MAX_SPEED_Z, el mismo tope que usa el jog manual.
const long MICROS_POSICIONAMIENTO_Z = 250;

// --- Persistencia de la calibración en EEPROM ---
// La firma evita leer basura en una placa virgen o tras cambiar el formato:
// si no coincide, se usan los valores de fábrica de arriba.
const uint32_t CAL_Z_FIRMA = 0x5A43414CUL;  // "ZCAL"
const int CAL_Z_EEPROM_ADDR = 0;

struct CalibracionZ {
  uint32_t firma;
  float pasosPorMM;
  float alturaHomeMM;
  float alturaMinimaMM;
};

void recalcularLimitesZ() {
  LIMITE_SOFTWARE_Z_ABAJO =
      -(long)((ALTURA_HOME_MM - ALTURA_MINIMA_MM) * PASOS_POR_MM_Z + 0.5f);
}

// Rangos de cordura. No pretenden ser exactos, solo impedir que un dedazo en la
// pantalla deje la máquina con una escala absurda que se lleve el eje al suelo.
bool calibracionZValida(float ppm, float home, float minima) {
  if (isnan(ppm) || isnan(home) || isnan(minima)) return false;
  if (ppm < 1.0f || ppm > 400.0f) return false;
  if (home < 50.0f || home > 1000.0f) return false;
  if (minima < 0.0f || minima >= home) return false;
  return true;
}

void cargarCalibracionZ() {
  CalibracionZ cal;
  EEPROM.get(CAL_Z_EEPROM_ADDR, cal);

  if (cal.firma == CAL_Z_FIRMA &&
      calibracionZValida(cal.pasosPorMM, cal.alturaHomeMM, cal.alturaMinimaMM)) {
    PASOS_POR_MM_Z = cal.pasosPorMM;
    ALTURA_HOME_MM = cal.alturaHomeMM;
    ALTURA_MINIMA_MM = cal.alturaMinimaMM;
  }

  recalcularLimitesZ();
}

void guardarCalibracionZ() {
  CalibracionZ cal;
  cal.firma = CAL_Z_FIRMA;
  cal.pasosPorMM = PASOS_POR_MM_Z;
  cal.alturaHomeMM = ALTURA_HOME_MM;
  cal.alturaMinimaMM = ALTURA_MINIMA_MM;
  // put() escribe byte a byte con update(), así que solo toca los que cambian:
  // la EEPROM aguanta ~100k escrituras por celda y esto cuelga de un botón.
  EEPROM.put(CAL_Z_EEPROM_ADDR, cal);
}

// Formato fijo para que la app lo parsee sin ambigüedad.
void enviarCalibracionZ() {
  Serial.print("CAL_Z:ppm=");
  Serial.print(PASOS_POR_MM_Z, 4);
  Serial.print(",home=");
  Serial.print(ALTURA_HOME_MM, 2);
  Serial.print(",min=");
  Serial.print(ALTURA_MINIMA_MM, 2);
  Serial.print(",fondo=");
  Serial.print(LIMITE_SOFTWARE_Z_ABAJO);
  Serial.print(",z=");
  Serial.println(posZ);
}

// Lee un campo "clave=valor" de una lista separada por comas.
// Devuelve NAN si la clave no aparece, para poder aplicar solo lo que se envía.
float leerCampoCalibracion(const String &texto, const char *clave) {
  String prefijo = String(clave) + "=";
  int idx = texto.indexOf(prefijo);
  if (idx < 0) return NAN;
  int inicio = idx + prefijo.length();
  int fin = texto.indexOf(',', inicio);
  if (fin < 0) fin = texto.length();
  return texto.substring(inicio, fin).toFloat();
}

// CAL_Z_SET:ppm=20.0,home=275.0,min=25.0  (los tres campos son opcionales)
// Solo aplica en RAM: hay que mandar CAL_Z_SAVE para que sobreviva al reinicio.
// Se valida el conjunto COMPLETO antes de tocar nada, para no dejar la máquina
// con una calibración a medias si uno de los tres valores es absurdo.
void procesarCalibracionZ(String args) {
  args.trim();

  float ppm = leerCampoCalibracion(args, "ppm");
  float home = leerCampoCalibracion(args, "home");
  float minima = leerCampoCalibracion(args, "min");

  if (isnan(ppm)) ppm = PASOS_POR_MM_Z;
  if (isnan(home)) home = ALTURA_HOME_MM;
  if (isnan(minima)) minima = ALTURA_MINIMA_MM;

  if (!calibracionZValida(ppm, home, minima)) {
    Serial.println("CAL_Z_ERROR: Valores fuera de rango");
    return;
  }

  PASOS_POR_MM_Z = ppm;
  ALTURA_HOME_MM = home;
  ALTURA_MINIMA_MM = minima;
  recalcularLimitesZ();

  // La posición actual no se toca: posZ = 0 sigue siendo el home físico. Lo que
  // cambia es a cuántos mm sobre el suelo equivale, y eso se recalcula solo.
  Serial.println("CAL_Z_APLICADA");
  enviarCalibracionZ();
}

// Lleva Z a una altura absoluta sobre el suelo usando el jog manual, que es el
// mismo camino que usa la calibración. Así lo que se verifica es exactamente lo
// que luego se mide.
void moverEjeZaAltura(float alturaMM) {
  long objetivo = alturaMMaPasosZ(alturaMM);
  long delta = objetivo - posZ;

  Serial.print("GOTO_MM: ");
  Serial.print(alturaMM, 1);
  Serial.print(" mm -> Z=");
  Serial.print(objetivo);
  Serial.print(" (delta ");
  Serial.print(delta);
  Serial.println(" pasos)");

  if (delta != 0) {
    moverEjeZ(delta);
  }

  Serial.print("GOTO_MM_ALCANZADO: Z=");
  Serial.print(posZ);
  Serial.print(" -> ");
  Serial.print(pasosZaAlturaMM(posZ), 1);
  Serial.println(" mm");
}

// Convierte una altura sobre el suelo (mm) a coordenada Z en pasos.
// El origen de pasos es el home, que está arriba: posZ = 0 equivale a
// ALTURA_HOME_MM sobre el suelo, y bajar da valores negativos.
long alturaMMaPasosZ(float alturaMM) {
  if (alturaMM < ALTURA_MINIMA_MM) alturaMM = ALTURA_MINIMA_MM;
  if (alturaMM > ALTURA_HOME_MM) alturaMM = ALTURA_HOME_MM;
  return -(long)((ALTURA_HOME_MM - alturaMM) * PASOS_POR_MM_Z + 0.5f);
}

// Convierte una distancia relativa en mm a pasos del eje Z.
long mmAPasosZ(float mm) {
  return (long)(mm * PASOS_POR_MM_Z + (mm >= 0 ? 0.5f : -0.5f));
}

// Convierte una coordenada Z en pasos a su altura sobre el suelo, en mm.
float pasosZaAlturaMM(long pasos) {
  return ALTURA_HOME_MM + (pasos / PASOS_POR_MM_Z);
}

// Botones con rebote (finales de carrera y paro)
ezButton homeSwitchY(homePinY);
ezButton limitMinSwitchY(limitMinY);
ezButton limitMaxSwitchY(limitMaxY);
ezButton homeSwitchZ(homePinZ);
ezButton limitMinSwitchZ(limitMinZ);
ezButton limitMaxSwitchZ(limitMaxZ);
ezButton emergencySwitch(emergencyPin);

// Variables para proceso automático
bool procesoActivo = false;
bool procesoPausado = false;
// Se enciende cuando el operador mueve un eje a mano con la receta pausada
// (el rescate tipico: un switch pauso el proceso y hay que sacar el eje de
// ahi). Con esto, al reanudar no se retoma el tramo que quedo a medias: su
// objetivo se calculo con la posicion vieja y volveria a meter el eje justo
// donde estaba atorado.
bool ejeMovidoAManoEnPausa = false;
int cicloActual = 0;
int ciclosTotales = 0;

// Parámetros de receta
struct RecipeParams {
  int cycles;
  int dippingWait0;
  int dippingWait1;
  int dippingWait2;
  int dippingWait3;
  int transferWait;
  bool exceptDripping1;
  bool exceptDripping2;
  bool exceptDripping3;
  bool exceptDripping4;
  float dipStartPosition;  // Altura máxima de Z sobre el SUELO durante la receta, en mm (0 = no usar)
  float dippingLength;     // Profundidad de cada inmersión, en mm
  // Las tres velocidades van en mm/s, la misma unidad que el operador escribe en
  // la receta y que aparece en la hoja de parámetros. La traducción a la unidad
  // de los motores (microsegundos entre flancos) ocurre en un solo sitio:
  // velocidadMMsAMicros(). El nombre lleva la unidad a propósito: cuando estos
  // campos se llamaban transferSpeed/dipSpeed a secas, cada capa del sistema
  // supuso una unidad distinta y las recetas corrían a la velocidad equivocada.
  float transferSpeedMMs;  // Velocidad de transferencia del eje Y, en mm/s
  float dipSpeedMMs;       // Velocidad de BAJADA del eje Z hacia la solución, en mm/s
  // La emersión va aparte de la inmersión porque en SILAR es la que decide el
  // espesor de la capa que queda adherida: sacar el sustrato despacio deja más
  // solución que sacarlo rápido. Un 0 significa "sube a la misma velocidad con
  // la que bajaste", que es como se comportaba el equipo antes de que este
  // campo existiera, así que las recetas ya guardadas corren igual que siempre.
  float emersionSpeedMMs;  // Velocidad de SUBIDA del eje Z, en mm/s (0 = usar dipSpeedMMs)
  // Posición de cada vaso medida desde el home de Y, en mm. Es un ajuste POR
  // RECETA, encima de la geometría de la máquina: sirve para un montaje en el
  // que los vasos no están igualmente separados, sin tener que recalibrar el
  // banco entero. 0 = usar POS_VASO_MM, la geometría calibrada de la máquina.
  // Como el vaso 1 vive en el home (0 mm) de todas formas, ese 0 no es ambiguo:
  // sale la misma posición por los dos caminos.
  float posVasoMM[4];
  bool fan;
} recipeParams;

// --- Recetas por etapas ---
//
// Una receta por etapas es una sola corrida partida en tramos: 5 ciclos de una
// manera, luego 6 de otra, luego 15 de otra, sin que el operador tenga que
// cambiar de receta a mitad del proceso.
//
// La secuencia vive aqui y no en el PC a proposito. El Arduino ya corre una
// receta entera por su cuenta; si el PC encadenara etapa por etapa, entre una y
// otra habria un home completo, la lampara parpadearia, y un cuelgue del PC o
// un tropiezo del puerto serie dejaria la corrida abandonada a medias. Con la
// lista aqui dentro, PAUSE / RESUME / STOP y el paro de emergencia siguen
// funcionando exactamente igual que con una receta normal.
//
// recipeParams sigue siendo "los parametros en vigor": al entrar en una etapa
// se le copia encima la etapa correspondiente, y todo lo que ya leia de ahi
// (ejecutarInmersion, posicionVasoPasos, los limites) sigue igual sin tocarse.
//
// MAX_ETAPAS son ~56 bytes por etapa contra los 8 KB de SRAM del Mega: 8 etapas
// son menos de medio kilobyte. El limite no es la memoria sino lo que un
// operador puede llenar en un formulario sin equivocarse.
#define MAX_ETAPAS 8
RecipeParams etapas[MAX_ETAPAS];
int totalEtapas = 0;
int etapaActual = 0;
bool ventiladorActivo = false;

// --- Geometría del eje Y ---
//
// Dos cosas independientes que hasta ahora salían de un único par de números
// clavados (4200 pasos <-> 55 mm), y que se tocan por motivos distintos:
//
//   - PASOS_POR_MM_Y es la mecánica de la transmisión (correa, polea,
//     microstepping). Solo cambia si se toca el hardware del eje. De ella
//     depende la traducción de transferSpeed (mm/s) a pasos/s.
//   - POS_VASO_MM son las cuatro posiciones del banco, cada una medida desde el
//     home de Y. Se guardan una por una y no como una separación uniforme,
//     porque los vasos no tienen por qué estar igualmente espaciados: en cuanto
//     uno se reubica, la separación deja de describir el montaje.
//
// Las dos se editan desde Configuración con CAL_Y_* y se guardan en EEPROM,
// igual que la calibración de Z, así que reubicar los vasos ya no obliga a
// recompilar. Los valores de fábrica reproducen exactamente las posiciones que
// el sketch traía clavadas: 0/55/110/165 mm x 76.3636 pasos/mm = 0/4200/8400/12600.
const float PASOS_POR_MM_Y_FABRICA = 4200.0f / 55.0f;  // 76.3636 pasos/mm
const float POS_VASO_MM_FABRICA[4] = { 0.0f, 55.0f, 110.0f, 165.0f };

float PASOS_POR_MM_Y = PASOS_POR_MM_Y_FABRICA;
float POS_VASO_MM[4] = { 0.0f, 55.0f, 110.0f, 165.0f };

// Final de carrera máximo del eje, en pasos desde home. Ninguna posición de vaso
// puede pasar de aquí: con la escala de fábrica son 14027/76.36 = 183.7 mm.
const long LIMITE_FISICO_Y_PASOS = 14027;

// Posiciones Y de cada solución, en pasos desde home. Ya no son constantes: las
// recalcula recalcularPosicionesY() cada vez que cambia la geometría de arriba.
long POS_Y1 = 0;      // Posición Y para solución 1 (Vaso 1)
long POS_Y2 = 4200;   // Posición Y para solución 2 (Vaso 2)
long POS_Y3 = 8400;   // Posición Y para solución 3 (Vaso 3)
long POS_Y4 = 12600;  // Posición Y para solución 4 (Vaso 4)

long posicionVasoAPasos(float mm) {
  return (long)(mm * PASOS_POR_MM_Y + 0.5f);
}

void recalcularPosicionesY() {
  POS_Y1 = posicionVasoAPasos(POS_VASO_MM[0]);
  POS_Y2 = posicionVasoAPasos(POS_VASO_MM[1]);
  POS_Y3 = posicionVasoAPasos(POS_VASO_MM[2]);
  POS_Y4 = posicionVasoAPasos(POS_VASO_MM[3]);
}

// Posición del vaso (0..3) que toca usar en la receta en curso, en pasos.
// La receta puede traer las suyas para un montaje puntual; si no las trae, mandan
// las de la máquina. No avisa ni recorta nada: eso se hace una sola vez al
// recibir la receta (ver parsearParametrosReceta), porque desde aquí el mensaje
// saldría en cada inmersión de cada ciclo.
long posicionVasoPasos(int indice) {
  float mm = recipeParams.posVasoMM[indice];
  if (mm <= 0.0f) {
    const long deLaMaquina[4] = { POS_Y1, POS_Y2, POS_Y3, POS_Y4 };
    return deLaMaquina[indice];
  }
  return posicionVasoAPasos(mm);
}

// Único punto de traducción entre la unidad del operador (mm/s) y la de los
// motores (microsegundos entre flancos). Dos flancos por paso, de ahí el factor
// 2: es la misma convención que deshace moverEjeZVelocidad al calcular pasos/s.
// Devuelve 0 si la velocidad no es utilizable, para que el llamador aplique su
// propio valor por defecto en vez de mover el eje a una velocidad inventada.
long velocidadMMsAMicros(float mmPorSegundo, float pasosPorMM) {
  if (mmPorSegundo <= 0.0f || pasosPorMM <= 0.0f) return 0;
  float pasosPorSegundo = mmPorSegundo * pasosPorMM;
  if (pasosPorSegundo < 1.0f) pasosPorSegundo = 1.0f;
  return (long)(1000000.0f / (2.0f * pasosPorSegundo) + 0.5f);
}

// Velocidad con la que sube el eje Z al sacar el sustrato de la solución.
// Se resuelve aquí y no al parsear la receta para que el 0 guardado siga
// significando "igual que la bajada" aunque después se cambie dipSpeed: es el
// mismo criterio que posicionVasoPasos() con las posiciones de los vasos.
float velocidadEmersionMMs() {
  return recipeParams.emersionSpeedMMs > 0.0f
         ? recipeParams.emersionSpeedMMs
         : recipeParams.dipSpeedMMs;
}

// --- Persistencia de la geometría de Y en EEPROM ---
// Mismo esquema que CalibracionZ: firma propia para no leer basura en una placa
// virgen, y una dirección distinta para no pisar el bloque de Z (16 bytes en 0).
const uint32_t CAL_Y_FIRMA = 0x59434132UL;  // "YCA2"
const int CAL_Y_EEPROM_ADDR = 32;

struct CalibracionY {
  uint32_t firma;
  float pasosPorMM;
  float posVasoMM[4];
};

// Rangos de cordura, con el mismo criterio que calibracionZValida: no pretenden
// ser exactos, solo impedir que un dedazo en la pantalla deje la máquina
// mandando el eje contra el final de carrera.
bool calibracionYValida(float ppm, const float posiciones[4]) {
  if (isnan(ppm)) return false;
  if (ppm < 1.0f || ppm > 400.0f) return false;

  for (int i = 0; i < 4; i++) {
    if (isnan(posiciones[i])) return false;
    if (posiciones[i] < 0.0f) return false;
    // Cada vaso tiene que caber en el eje. Sin esta comprobación, una posición
    // demasiado grande no da error: la receta se va contra el final de carrera
    // en esa transferencia y la inmersión se hace en el sitio equivocado.
    if (posiciones[i] * ppm > (float)LIMITE_FISICO_Y_PASOS) return false;
  }
  return true;
}

void cargarCalibracionY() {
  CalibracionY cal;
  EEPROM.get(CAL_Y_EEPROM_ADDR, cal);

  if (cal.firma == CAL_Y_FIRMA && calibracionYValida(cal.pasosPorMM, cal.posVasoMM)) {
    PASOS_POR_MM_Y = cal.pasosPorMM;
    for (int i = 0; i < 4; i++) POS_VASO_MM[i] = cal.posVasoMM[i];
  }

  recalcularPosicionesY();
}

void guardarCalibracionY() {
  CalibracionY cal;
  cal.firma = CAL_Y_FIRMA;
  cal.pasosPorMM = PASOS_POR_MM_Y;
  for (int i = 0; i < 4; i++) cal.posVasoMM[i] = POS_VASO_MM[i];
  EEPROM.put(CAL_Y_EEPROM_ADDR, cal);
}

// Formato fijo para que la app lo parsee sin ambigüedad. Incluye las cuatro
// posiciones ya calculadas y la velocidad máxima que permite la escala actual,
// que es justo el dato que hacía falta para saber por qué una receta a 39 mm/s
// se recorta: ese tope depende de PASOS_POR_MM_Y.
void enviarCalibracionY() {
  Serial.print("CAL_Y:ppm=");
  Serial.print(PASOS_POR_MM_Y, 4);
  for (int i = 0; i < 4; i++) {
    Serial.print(",v");
    Serial.print(i + 1);
    Serial.print("=");
    Serial.print(POS_VASO_MM[i], 2);
  }
  Serial.print(",p1=");
  Serial.print(POS_Y1);
  Serial.print(",p2=");
  Serial.print(POS_Y2);
  Serial.print(",p3=");
  Serial.print(POS_Y3);
  Serial.print(",p4=");
  Serial.print(POS_Y4);
  Serial.print(",tope=");
  Serial.print(LIMITE_FISICO_Y_PASOS);
  Serial.print(",vmax=");
  Serial.print(MAX_SPEED_Y / PASOS_POR_MM_Y, 2);
  Serial.print(",y=");
  Serial.println(posY);
}

// CAL_Y_SET:ppm=76.3636,v1=0,v2=55,v3=110,v4=165  (todos los campos opcionales)
// Solo aplica en RAM: hay que mandar CAL_Y_SAVE para que sobreviva al reinicio.
// Se valida el conjunto COMPLETO antes de tocar nada, para no dejar el banco con
// media disposición vieja y media nueva si una de las posiciones es absurda.
void procesarCalibracionY(String args) {
  args.trim();

  // Cambiar la geometría a mitad de receta dejaría los vasos repartidos entre
  // la disposición vieja y la nueva, así que se rechaza y no se toca nada.
  if (procesoActivo) {
    Serial.println("CAL_Y_ERROR: No se puede cambiar la geometria con una receta en curso");
    return;
  }

  float ppm = leerCampoCalibracion(args, "ppm");
  if (isnan(ppm)) ppm = PASOS_POR_MM_Y;

  float posiciones[4];
  const char *claves[4] = { "v1", "v2", "v3", "v4" };
  for (int i = 0; i < 4; i++) {
    posiciones[i] = leerCampoCalibracion(args, claves[i]);
    if (isnan(posiciones[i])) posiciones[i] = POS_VASO_MM[i];
  }

  if (!calibracionYValida(ppm, posiciones)) {
    Serial.println("CAL_Y_ERROR: Valores fuera de rango o algun vaso no cabe en el eje");
    return;
  }

  PASOS_POR_MM_Y = ppm;
  for (int i = 0; i < 4; i++) POS_VASO_MM[i] = posiciones[i];
  recalcularPosicionesY();

  // posY no se toca: el cero sigue siendo el home físico. Lo que cambia es
  // dónde quedan los cuatro vasos respecto a ese cero, y eso ya está aplicado.
  Serial.println("CAL_Y_APLICADA");
  enviarCalibracionY();
}

void setup() {
  Serial.begin(9600);

  // Antes que nada: la calibración guardada manda sobre los valores de fábrica,
  // y de ella dependen todos los límites del eje Z.
  cargarCalibracionZ();
  // Lo mismo para Y: de la geometría guardada dependen las cuatro posiciones de
  // los vasos, así que tiene que estar cargada antes de mover nada.
  cargarCalibracionY();

  // Configurar pines Eje Y
  pinMode(dirPinY, OUTPUT);
  pinMode(stepPinY, OUTPUT);
  pinMode(enablePinY, OUTPUT);
  pinMode(homePinY, INPUT_PULLUP);
  pinMode(limitMinY, INPUT_PULLUP);
  pinMode(limitMaxY, INPUT_PULLUP);
  
  // Configurar pines Eje Z
  pinMode(dirPinZ, OUTPUT);
  pinMode(stepPinZ, OUTPUT);
  pinMode(enablePinZ, OUTPUT);
  pinMode(homePinZ, INPUT_PULLUP);
  pinMode(limitMinZ, INPUT_PULLUP);
  pinMode(limitMaxZ, INPUT_PULLUP);
  
  // Paro de emergencia
  pinMode(emergencyPin, INPUT_PULLUP);
  
  // Accesorios - Salidas digitales
  pinMode(lampPin, OUTPUT);
  pinMode(fanPin, OUTPUT);
  
  // Inicializar accesorios apagados
  digitalWrite(lampPin, LOW);
  digitalWrite(fanPin, LOW);
  
  // Habilitar motores: LOW = habilitado (activo-LOW, igual que el código funcional previo)
  digitalWrite(enablePinY, LOW);
  digitalWrite(enablePinZ, LOW);

  stepperY.setMaxSpeed(MAX_SPEED_Y);
  stepperY.setAcceleration(MAX_ACCEL_Y);
  stepperY.setMinPulseWidth(MIN_PULSE_WIDTH_US);
  // Sin setEnablePin ni setPinsInverted: control manual del pin ENA
  stepperY.setCurrentPosition(posY);

  stepperZ.setMaxSpeed(MAX_SPEED_Z);
  stepperZ.setAcceleration(MAX_ACCEL_Z);
  stepperZ.setMinPulseWidth(MIN_PULSE_WIDTH_US);
  stepperZ.setPinsInverted(true, false, false); // Invertir dirección física de Z: Z- baja y Z+ sube
  stepperZ.setCurrentPosition(posZ);

  // Configurar debounce
  homeSwitchY.setDebounceTime(50);
  limitMinSwitchY.setDebounceTime(50);
  limitMaxSwitchY.setDebounceTime(50);
  homeSwitchZ.setDebounceTime(50);
  limitMinSwitchZ.setDebounceTime(50);
  limitMaxSwitchZ.setDebounceTime(50);
  emergencySwitch.setDebounceTime(50);
  
  Serial.println("Sistema SILAR Iniciado");
  Serial.println("Hardware: Arduino Mega 2560 Rev3");
  Serial.println("Documento: MOC-ELEC-001");

  // La aplicacion necesita las constantes de la maquina para mostrarlas
  enviarConfig();
}

void loop() {
  // Actualizar estados de los botones
  homeSwitchY.loop();
  limitMinSwitchY.loop();
  limitMaxSwitchY.loop();
  homeSwitchZ.loop();
  limitMinSwitchZ.loop();
  limitMaxSwitchZ.loop();
  emergencySwitch.loop();

  if (millis() - ultimoStatusMs >= STATUS_INTERVAL_MS) {
    ultimoStatusMs = millis();
    enviarStatus();
  }

  // Verificar paro de emergencia (HIGH = ACTIVADO / ABIERTO / DETENER)
  bool emergenciaActiva = (emergencySwitch.getState() == HIGH);

  if (emergenciaActiva) {
    if (!emergencyStop) {
      emergencyStop = true;
      procesoActivo = false;
      procesoPausado = false;
      stepperY.stop();
      stepperZ.stop();
      digitalWrite(enablePinY, HIGH);  // HIGH = deshabilitado (detiene motores)
      digitalWrite(enablePinZ, HIGH);
      Serial.println("PARO DE EMERGENCIA ACTIVADO");
    }
    return;
  }

  if (emergencyStop) {
      emergencyStop = false;
      digitalWrite(enablePinY, LOW);   // LOW = habilitado (reactiva motores)
      digitalWrite(enablePinZ, LOW);
      Serial.println("Paro de emergencia desactivado");
  }

  stepperY.run();
  stepperZ.run();
  
  // Ejecutar proceso automático si está activo y no está pausado
  if (procesoActivo && !procesoPausado && !emergencyStop && modo == 1) {
    ejecutarProcesoAutomatico();
  }
  
  // Leer comandos del puerto serial
  if (Serial.available() > 0) {
    String comando = Serial.readStringUntil('\n');
    comando.trim();
    
    if (comando == "1") {
      modo = 0;
      procesoActivo = false;
      procesoPausado = false;
      Serial.println("Modo Manual");
    }
    else if (comando == "2") {
      modo = 1;
      Serial.println("Modo Automatico");
    }
    else if (comando == "3") {
      ejecutarHome();
    }
    else if (comando.startsWith("Y")) {
      int pasos = comando.substring(1).toInt();
      moverEjeY(pasos);
    }
    else if (comando.startsWith("Z")) {
      int pasos = comando.substring(1).toInt();
      moverEjeZ(pasos);
    }
    else if (comando.startsWith("START_RECIPE:")) {
      String jsonParams = comando.substring(13); // Extraer JSON después de "START_RECIPE:"
      parsearParametrosReceta(jsonParams);
      usarEtapaUnica();
      iniciarProcesoAutomatico();
    }
    // Receta por etapas: RECIPE_BEGIN, un ADD_STAGE por etapa, y RECIPE_START.
    // Van en lineas sueltas y no en un unico comando gigante porque el buffer
    // serie del Arduino son 64 bytes: cada ADD_STAGE ocupa lo mismo que el
    // START_RECIPE que ya funciona hoy. Cada uno contesta, y el PC espera esa
    // respuesta antes de mandar el siguiente.
    else if (comando == "RECIPE_BEGIN") {
      totalEtapas = 0;
      etapaActual = 0;
      Serial.println("RECETA_ETAPAS_INICIO");
    }
    else if (comando.startsWith("ADD_STAGE:")) {
      if (totalEtapas >= MAX_ETAPAS) {
        Serial.print("ERROR: Maximo de etapas alcanzado (");
        Serial.print(MAX_ETAPAS);
        Serial.println(")");
      } else {
        // Se parsea sobre recipeParams, que aqui hace de borrador, y de ahi se
        // copia a la etapa. Asi el parser y sus defaults son exactamente los
        // mismos que los de una receta normal, sin una segunda copia que
        // mantener.
        parsearParametrosReceta(comando.substring(10));
        etapas[totalEtapas] = recipeParams;
        totalEtapas++;
        Serial.print("ETAPA_AGREGADA: ");
        Serial.print(totalEtapas);
        Serial.print("/");
        Serial.println(MAX_ETAPAS);
      }
    }
    else if (comando == "RECIPE_START") {
      if (totalEtapas == 0) {
        Serial.println("ERROR: No hay etapas cargadas");
      } else {
        cargarEtapa(0);
        iniciarProcesoAutomatico();
      }
    }
    else if (comando == "PAUSE") {
      if (procesoActivo && !procesoPausado) {
        procesoPausado = true;
        Serial.println("PROCESO_PAUSADO");
      }
    }
    else if (comando == "RESUME") {
      if (procesoActivo && procesoPausado) {
        procesoPausado = false;
        Serial.println("PROCESO_REANUDADO");
      }
    }
    else if (comando == "STOP") {
      procesoActivo = false;
      procesoPausado = false;
      cicloActual = 0;
      etapaActual = 0;
      digitalWrite(lampPin, LOW);
      digitalWrite(fanPin, LOW);
      ventiladorActivo = false;
      Serial.println("PROCESO_DETENIDO");
    }
    else if (comando == "LAMP_ON") {
      digitalWrite(lampPin, HIGH);
      Serial.println("LAMPARA_ACTIVADA");
    }
    else if (comando == "LAMP_OFF") {
      digitalWrite(lampPin, LOW);
      Serial.println("LAMPARA_DESACTIVADA");
    }
    else if (comando == "FAN_ON") {
      digitalWrite(fanPin, HIGH);
      Serial.println("VENTILADOR_ACTIVADO");
    }
    else if (comando == "FAN_OFF") {
      digitalWrite(fanPin, LOW);
      Serial.println("VENTILADOR_DESACTIVADO");
    }
    else if (comando == "STATUS") {
      enviarStatus();
    }
    else if (comando == "HW_STATUS") {
      enviarStatusHardware();
    }
    else if (comando == "CONFIG") {
      enviarConfig();
    }
    else if (comando == "STEP_TEST_Y") {
      pruebaStepManual(stepPinY, dirPinY);
    }
    else if (comando == "STEP_TEST_Z") {
      pruebaStepManual(stepPinZ, dirPinZ);
    }
    // --- Calibración del eje Z desde la pantalla de administrador ---
    // CAL_Z? consulta; CAL_Z_SET aplica en RAM (para poder probar antes de
    // fijar); CAL_Z_SAVE persiste en EEPROM; CAL_Z_RESET vuelve a fábrica.
    else if (comando == "CAL_Z?") {
      enviarCalibracionZ();
    }
    else if (comando.startsWith("CAL_Z_SET:")) {
      procesarCalibracionZ(comando.substring(10));
    }
    else if (comando == "CAL_Z_SAVE") {
      guardarCalibracionZ();
      Serial.println("CAL_Z_GUARDADA");
      enviarCalibracionZ();
    }
    else if (comando == "CAL_Z_RESET") {
      PASOS_POR_MM_Z = PASOS_POR_MM_Z_FABRICA;
      ALTURA_HOME_MM = ALTURA_HOME_MM_FABRICA;
      ALTURA_MINIMA_MM = ALTURA_MINIMA_MM_FABRICA;
      recalcularLimitesZ();
      guardarCalibracionZ();
      Serial.println("CAL_Z_RESTAURADA");
      enviarCalibracionZ();
    }
    // --- Geometría del eje Y (separación entre vasos y escala) ---
    // Mismo protocolo de cuatro comandos que Z.
    else if (comando == "CAL_Y?") {
      enviarCalibracionY();
    }
    else if (comando.startsWith("CAL_Y_SET:")) {
      procesarCalibracionY(comando.substring(10));
    }
    else if (comando == "CAL_Y_SAVE") {
      guardarCalibracionY();
      Serial.println("CAL_Y_GUARDADA");
      enviarCalibracionY();
    }
    else if (comando == "CAL_Y_RESET") {
      PASOS_POR_MM_Y = PASOS_POR_MM_Y_FABRICA;
      for (int i = 0; i < 4; i++) POS_VASO_MM[i] = POS_VASO_MM_FABRICA[i];
      recalcularPosicionesY();
      guardarCalibracionY();
      Serial.println("CAL_Y_RESTAURADA");
      enviarCalibracionY();
    }
    // Va a una altura absoluta sobre el suelo, en mm. Es el comando de
    // verificación: se pide 150 y se comprueba con la regla que dé 15.0 cm.
    else if (comando.startsWith("GOTO_MM:")) {
      moverEjeZaAltura(comando.substring(8).toFloat());
    }
    else {
      Serial.print("Error: Comando desconocido: ");
      Serial.println(comando);
    }
  }
}

void parsearParametrosReceta(String json) {
  // Parser simple de JSON para Arduino
  // Formato esperado: {"cycles":5,"dippingWait0":1000,"dippingWait1":2000,...}
  
  // Valores por defecto
  recipeParams.cycles = 1;
  recipeParams.dippingWait0 = 5000;
  recipeParams.dippingWait1 = 5000;
  recipeParams.dippingWait2 = 5000;
  recipeParams.dippingWait3 = 5000;
  recipeParams.transferWait = 2000;
  recipeParams.exceptDripping1 = false;
  recipeParams.exceptDripping2 = false;
  recipeParams.exceptDripping3 = false;
  recipeParams.exceptDripping4 = false;
  recipeParams.dipStartPosition = 0;   // 0 = no posicionar, sin techo
  recipeParams.dippingLength = 30.0f;  // 30 mm de inmersión por defecto
  // Equivalentes exactos a los defaults que tenía el sketch cuando estos campos
  // se expresaban en microsegundos: 1000 us = 500 pasos/s en ambos ejes. Se dejan
  // idénticos a propósito, porque este cambio corrige la unidad, no la velocidad
  // a la que venían corriendo las recetas que no traen el campo.
  recipeParams.transferSpeedMMs = 500.0f / PASOS_POR_MM_Y;  // ~6.5 mm/s
  recipeParams.dipSpeedMMs = 500.0f / PASOS_POR_MM_Z;       // 25 mm/s
  recipeParams.emersionSpeedMMs = 0.0f;                     // 0 = igual que la bajada
  for (int i = 0; i < 4; i++) recipeParams.posVasoMM[i] = 0.0f;  // 0 = geometría de la máquina
  recipeParams.fan = false;
  
  // Extraer valores del JSON (parser simple)
  int idx;
  
  // Cycles
  idx = json.indexOf("\"cycles\":");
  if (idx >= 0) {
    int start = idx + 9;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      recipeParams.cycles = json.substring(start, end).toInt();
    }
  }
  
  // Dipping waits
  idx = json.indexOf("\"dippingWait0\":");
  if (idx >= 0) {
    int start = idx + 15;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
       recipeParams.dippingWait0 = json.substring(start, end).toInt();
    }
  }
  
  idx = json.indexOf("\"dippingWait1\":");
  if (idx >= 0) {
    int start = idx + 15;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
       recipeParams.dippingWait1 = json.substring(start, end).toInt();
    }
  }
  
  idx = json.indexOf("\"dippingWait2\":");
  if (idx >= 0) {
    int start = idx + 15;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
       recipeParams.dippingWait2 = json.substring(start, end).toInt();
    }
  }
  
  idx = json.indexOf("\"dippingWait3\":");
  if (idx >= 0) {
    int start = idx + 15;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
       recipeParams.dippingWait3 = json.substring(start, end).toInt();
    }
  }
  
  // Transfer wait
  idx = json.indexOf("\"transferWait\":");
  if (idx >= 0) {
    int start = idx + 15;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
       recipeParams.transferWait = json.substring(start, end).toInt();
    }
  }
  
  // Except dripping flags
  recipeParams.exceptDripping1 = json.indexOf("\"exceptDripping1\":true") >= 0;
  recipeParams.exceptDripping2 = json.indexOf("\"exceptDripping2\":true") >= 0;
  recipeParams.exceptDripping3 = json.indexOf("\"exceptDripping3\":true") >= 0;
  recipeParams.exceptDripping4 = json.indexOf("\"exceptDripping4\":true") >= 0;
  
  // Dip start position
  idx = json.indexOf("\"dipStartPosition\":");
  if (idx >= 0) {
    int start = idx + 19;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      recipeParams.dipStartPosition = json.substring(start, end).toFloat();
    }
  }
  
  // Dipping length
  idx = json.indexOf("\"dippingLength\":");
  if (idx >= 0) {
    int start = idx + 16;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      recipeParams.dippingLength = json.substring(start, end).toFloat();
    }
  }
  
  // Transfer speed (mm/s). Un valor no positivo deja el default de arriba: antes
  // había un mínimo de 100 aquí, que tenía sentido cuando el campo era
  // microsegundos y hoy sería un mínimo de 100 mm/s, muy por encima del eje.
  // El tope real lo pone MAX_SPEED_Y al mover.
  idx = json.indexOf("\"transferSpeed\":");
  if (idx >= 0) {
    int start = idx + 16;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      float v = json.substring(start, end).toFloat();
      if (v > 0.0f) recipeParams.transferSpeedMMs = v;
    }
  }

  // Dip speed (mm/s). Mismo criterio; el tope lo pone MAX_SPEED_Z.
  idx = json.indexOf("\"dipSpeed\":");
  if (idx >= 0) {
    int start = idx + 11;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      float v = json.substring(start, end).toFloat();
      if (v > 0.0f) recipeParams.dipSpeedMMs = v;
    }
  }

  // Emersion speed (mm/s). Opcional: si no viene, o viene en 0, la subida usa la
  // velocidad de bajada. Eso es lo que mantiene compatibles las recetas viejas.
  idx = json.indexOf("\"emersionSpeed\":");
  if (idx >= 0) {
    int start = idx + 16;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      float v = json.substring(start, end).toFloat();
      if (v > 0.0f) recipeParams.emersionSpeedMMs = v;
    }
  }
  
  // Posición de cada vaso en mm (posY1..posY4). Opcionales: lo que no venga, o
  // venga en 0, se resuelve con la geometría de la máquina al mover. Se leen en
  // bucle porque las cuatro claves miden lo mismo y solo cambia el dígito.
  for (int i = 0; i < 4; i++) {
    String clave = "\"posY";
    clave += (i + 1);
    clave += "\":";
    idx = json.indexOf(clave);
    if (idx >= 0) {
      int start = idx + clave.length();
      int end = json.indexOf(",", start);
      if (end < 0) end = json.indexOf("}", start);
      if (end > start) {
        float v = json.substring(start, end).toFloat();
        if (v > 0.0f) recipeParams.posVasoMM[i] = v;
      }
    }

    // Un vaso más allá del final de carrera no da error por sí solo: el eje se
    // estampa contra el tope en esa transferencia y la inmersión se hace donde
    // no toca. Se recorta aquí, con la receta a la vista, y se avisa una vez.
    float tope = LIMITE_FISICO_Y_PASOS / PASOS_POR_MM_Y;
    if (recipeParams.posVasoMM[i] > tope) {
      Serial.print("ADVERTENCIA: Vaso ");
      Serial.print(i + 1);
      Serial.print(" recortado de ");
      Serial.print(recipeParams.posVasoMM[i], 1);
      Serial.print(" a ");
      Serial.print(tope, 1);
      Serial.println(" mm (final de carrera)");
      recipeParams.posVasoMM[i] = tope;
    }
  }

  // Fan
  recipeParams.fan = json.indexOf("\"fan\":true") >= 0;
  
  Serial.print("PARAMETROS_RECIBIDOS: Ciclos=");
  Serial.print(recipeParams.cycles);
  Serial.print(", Wait0=");
  Serial.print(recipeParams.dippingWait0);
  Serial.print(", Wait1=");
  Serial.print(recipeParams.dippingWait1);
  Serial.print(", Wait2=");
  Serial.print(recipeParams.dippingWait2);
  Serial.print(", Wait3=");
  Serial.print(recipeParams.dippingWait3);
  Serial.print(", DipStart=");
  Serial.print(recipeParams.dipStartPosition, 1);
  Serial.print("mm/");
  Serial.print(alturaMMaPasosZ(recipeParams.dipStartPosition));
  Serial.print("pasos, DipLen=");
  Serial.print(recipeParams.dippingLength, 1);
  Serial.print("mm/");
  Serial.print(mmAPasosZ(recipeParams.dippingLength));
  Serial.print("pasos, DipSpeed=");
  Serial.print(recipeParams.dipSpeedMMs, 2);
  Serial.print("mm/s (");
  Serial.print(velocidadMMsAMicros(recipeParams.dipSpeedMMs, PASOS_POR_MM_Z));
  Serial.print("us), EmersionSpeed=");
  Serial.print(velocidadEmersionMMs(), 2);
  Serial.print("mm/s (");
  Serial.print(velocidadMMsAMicros(velocidadEmersionMMs(), PASOS_POR_MM_Z));
  Serial.print("us), TransferSpeed=");
  Serial.print(recipeParams.transferSpeedMMs, 2);
  Serial.print("mm/s (");
  Serial.print(velocidadMMsAMicros(recipeParams.transferSpeedMMs, PASOS_POR_MM_Y));
  Serial.print("us), Vasos=");
  // Se imprime la posición que se va a usar de verdad, no la que trajo el JSON:
  // así se ve de un vistazo cuáles vienen de la receta y cuáles de la máquina.
  for (int i = 0; i < 4; i++) {
    if (i > 0) Serial.print("/");
    Serial.print(posicionVasoPasos(i) / PASOS_POR_MM_Y, 1);
  }
  Serial.println("mm");
}

void pausarProcesoLimite() {
  if (procesoActivo && !procesoPausado) {
    procesoPausado = true;
    Serial.println("PROCESO_PAUSADO");
  }
}

// El ventilador es un parametro POR ETAPA, asi que puede cambiar al pasar de
// una a otra. Solo se toca el pin cuando el estado cambia de verdad: encadenar
// dos etapas que lo quieren encendido no debe apagarlo un instante en medio.
void aplicarVentilador(bool encendido) {
  if (encendido == ventiladorActivo) return;
  ventiladorActivo = encendido;
  digitalWrite(fanPin, encendido ? HIGH : LOW);
  Serial.println(encendido ? "VENTILADOR_ACTIVADO" : "VENTILADOR_DESACTIVADO");
}

// Lleva Z a la altura inicial de la etapa en vigor y fija el techo de esa etapa.
// Esto NO es un home: es el unico movimiento que ocurre entre una etapa y la
// siguiente, y solo si cambia la altura de partida.
void aplicarPosicionInicialZ() {
  techoZReceta = 0;
  if (recipeParams.dipStartPosition <= 0.0f) return;

  long objetivoZ = alturaMMaPasosZ(recipeParams.dipStartPosition);
  techoZReceta = objetivoZ;

  Serial.print("POSICION_INICIAL: ");
  Serial.print(recipeParams.dipStartPosition, 1);
  Serial.print(" mm sobre el suelo -> Z=");
  Serial.println(objetivoZ);

  long delta = objetivoZ - posZ;
  if (delta != 0) {
    // A velocidad normal, no la de la receta: ver MICROS_POSICIONAMIENTO_Z.
    moverEjeZVelocidad(delta, MICROS_POSICIONAMIENTO_Z);
  }
  Serial.print("POSICION_INICIAL_ALCANZADA: Z=");
  Serial.println(posZ);
}

// Pone la etapa indicada en vigor. A partir de aqui recipeParams es esa etapa.
void cargarEtapa(int indice) {
  if (indice < 0 || indice >= totalEtapas) return;
  etapaActual = indice;
  recipeParams = etapas[indice];
  cicloActual = 0;
  ciclosTotales = recipeParams.cycles;
}

void anunciarEtapa() {
  Serial.print("ETAPA_INICIADA: ");
  Serial.print(etapaActual + 1);
  Serial.print("/");
  Serial.print(totalEtapas);
  Serial.print(" Ciclos=");
  Serial.println(ciclosTotales);
}

// Cierra la etapa en curso y arranca la siguiente sin home y sin pausa.
// Devuelve false cuando ya no queda ninguna, es decir cuando la receta termino.
bool avanzarEtapa() {
  Serial.print("ETAPA_COMPLETADA: ");
  Serial.print(etapaActual + 1);
  Serial.print("/");
  Serial.println(totalEtapas);

  if (etapaActual + 1 >= totalEtapas) return false;

  cargarEtapa(etapaActual + 1);
  aplicarVentilador(recipeParams.fan);
  aplicarPosicionInicialZ();
  anunciarEtapa();
  return true;
}

void finalizarProceso() {
  procesoActivo = false;
  Serial.println("PROCESO_COMPLETADO");

  digitalWrite(lampPin, LOW);
  Serial.println("LAMPARA_DESACTIVADA");
  aplicarVentilador(false);

  // Aquí ya no se hace home. Antes se ejecutaba siempre, y eso dejaba sin
  // efecto la casilla "regresar a home al terminar" de la receta: sin
  // marcarla la máquina volvía igual, y marcándola volvía dos veces. Ahora
  // manda la receta: el servidor lee recipes.return_home_at_end y, al
  // recibir PROCESO_COMPLETADO, manda el HOME solo si está marcada
  // (regresarAHomeSiLaRecetaLoPidio en server.js).
}

// Deja una sola etapa cargada con lo que ya hay en recipeParams. Es el camino
// de la receta normal de toda la vida: una receta sin etapas es una receta de
// una sola etapa, y asi el resto del firmware no necesita distinguirlas.
void usarEtapaUnica() {
  etapas[0] = recipeParams;
  totalEtapas = 1;
  etapaActual = 0;
}

void iniciarProcesoAutomatico() {
  if (modo != 1) {
    Serial.println("ERROR: Debe estar en modo automatico");
    return;
  }
  
  procesoActivo = true;
  procesoPausado = false;
  ejeMovidoAManoEnPausa = false;
  cicloActual = 0;
  ciclosTotales = recipeParams.cycles;
  
  Serial.print("PROCESO_INICIADO: Etapas=");
  Serial.print(totalEtapas);
  Serial.print(", Ciclos=");
  Serial.println(ciclosTotales);
  
  // Activar lámpara interior al iniciar proceso
  digitalWrite(lampPin, HIGH);
  Serial.println("LAMPARA_ACTIVADA");
  
  // Activar ventilador si está configurado
  aplicarVentilador(recipeParams.fan);

  // Posicionar Z en la altura inicial de la receta antes del primer ciclo.
  aplicarPosicionInicialZ();

  // Diagnóstico: estas son EXACTAMENTE las cuatro condiciones que loop() evalúa
  // para llamar a ejecutarProcesoAutomatico(). Si el ciclo no arranca después
  // del posicionamiento, aquí se ve cuál de ellas quedó mal.
  Serial.print("PROCESO_LISTO: activo=");
  Serial.print(procesoActivo);
  Serial.print(" pausado=");
  Serial.print(procesoPausado);
  Serial.print(" emergencia=");
  Serial.print(emergencyStop);
  Serial.print(" modo=");
  Serial.print(modo);
  Serial.print(" ciclo=");
  Serial.print(cicloActual);
  Serial.print("/");
  Serial.println(ciclosTotales);
}

void ejecutarProcesoAutomatico() {
  // Verificar si hay un ciclo pendiente de ejecutar en la etapa en vigor
  if (cicloActual >= ciclosTotales) {
    if (!avanzarEtapa()) finalizarProceso();
    return;
  }
  
  // Ejecutar el ciclo actual
  Serial.print("CICLO_INICIADO: ");
  Serial.print(cicloActual + 1);
  Serial.print("/");
  Serial.println(ciclosTotales);
  
  // Ejecutar inmersiones en cada posición Y
  if (!recipeParams.exceptDripping1) {
    ejecutarInmersion(posicionVasoPasos(0), recipeParams.dippingWait0, 1);
  }
  
  if (!esperarSiPausado()) return;
  
  if (!recipeParams.exceptDripping2) {
    ejecutarInmersion(posicionVasoPasos(1), recipeParams.dippingWait1, 2);
  }
  
  if (!esperarSiPausado()) return;
  
  if (!recipeParams.exceptDripping3) {
    ejecutarInmersion(posicionVasoPasos(2), recipeParams.dippingWait2, 3);
  }
  
  if (!esperarSiPausado()) return;
  
  if (!recipeParams.exceptDripping4) {
    ejecutarInmersion(posicionVasoPasos(3), recipeParams.dippingWait3, 4);
  }
  
  if (!esperarSiPausado()) return;
  
  Serial.print("CICLO_COMPLETADO: ");
  Serial.print(cicloActual + 1);
  Serial.print("/");
  Serial.println(ciclosTotales);
  
  // Incrementar ciclo actual
  cicloActual++;
  
  // Si se completaron todos los ciclos de la etapa, encadenar la siguiente.
  // La lampara no se apaga aqui: solo cuando se acaba la ultima etapa.
  if (cicloActual >= ciclosTotales) {
    if (!avanzarEtapa()) finalizarProceso();
  }
}

void ejecutarInmersion(long posYTarget, int tiempoEspera, int numInmersion) {
  if (!esperarSiPausado()) {
    return;
  }
  
  Serial.print("INMERSION_INICIADA: Y");
  Serial.println(numInmersion);
  
  // Mover a posición Y
  moverEjeYAbsoluto(posYTarget);
  
  if (!esperarSiPausado()) return;
  
  // Esperar tiempo de transferencia
  delay(recipeParams.transferWait);
  
  if (!esperarSiPausado()) return;
  
  long zAntesDeBajar = posZ;
  long bajadaReal = mmAPasosZ(recipeParams.dippingLength);

  // Recortar la profundidad si chocaría con el fondo del eje. moverEjeZVelocidad
  // también lo haría, pero aquí se puede avisar en mm, que es lo que el operador
  // escribió en la receta.
  long margenDisponible = zAntesDeBajar - LIMITE_SOFTWARE_Z_ABAJO;
  if (margenDisponible < 0) margenDisponible = 0;
  if (bajadaReal > margenDisponible) {
    bajadaReal = margenDisponible;
    Serial.print("ADVERTENCIA: Inmersion recortada a ");
    Serial.print(bajadaReal / PASOS_POR_MM_Z, 1);
    Serial.print(" mm de los ");
    Serial.print(recipeParams.dippingLength, 1);
    Serial.println(" mm pedidos (fondo del eje)");
  }

  // Bajar Z para inmersión (Z- baja físicamente con setPinsInverted)
  long microsDip = velocidadMMsAMicros(recipeParams.dipSpeedMMs, PASOS_POR_MM_Z);
  long microsEmersion = velocidadMMsAMicros(velocidadEmersionMMs(), PASOS_POR_MM_Z);
  moverEjeZVelocidad(-bajadaReal, microsDip);
  
  if (!esperarSiPausado()) return;
  
  // Esperar tiempo de inmersión
  // El tiempo se cuenta en reloj de pared a proposito: durante una pausa el
  // sustrato sigue sumergido, asi que ese rato cuenta como inmersion.
  unsigned long tiempoInicio = millis();
  while (millis() - tiempoInicio < tiempoEspera) {
    if (!esperarSiPausado()) {
      return;
    }
    delay(100); // Verificar cada 100ms
  }
  
  if (!esperarSiPausado()) return;
  
  // Subir EXACTAMENTE lo que realmente bajó, leyendo la posición real en vez de
  // la solicitada: si el límite virtual o un switch recortó el descenso, esto
  // evita subir de más y chocar arriba.
  moverEjeZVelocidad(zAntesDeBajar - posZ, microsEmersion);
  
  Serial.print("INMERSION_COMPLETADA: Y");
  Serial.println(numInmersion);
}

void moverEjeYAbsoluto(long posicionObjetivo) {
  long diferencia = posicionObjetivo - posY;
  moverEjeY(diferencia);
}

void verificarComandosDuranteMovimiento() {
  if (Serial.available() > 0) {
    String comando = Serial.readStringUntil('\n');
    comando.trim();
    
    if (comando == "STOP") {
      procesoActivo = false;
      procesoPausado = false;
      digitalWrite(lampPin, LOW);
      digitalWrite(fanPin, LOW);
      Serial.println("PROCESO_DETENIDO");
    }
    else if (comando == "PAUSE") {
      if (procesoActivo && !procesoPausado) {
        procesoPausado = true;
        Serial.println("PROCESO_PAUSADO");
      }
    }
    else if (comando == "RESUME") {
      if (procesoActivo && procesoPausado) {
        procesoPausado = false;
        Serial.println("PROCESO_REANUDADO");
      }
    }
  }
}

// Congela la receta mientras esta pausada, en vez de abandonar el paso a medias.
// Devuelve true si se puede continuar justo donde se quedo, y false si durante
// la espera llego un STOP o un paro de emergencia.
//
// Antes cada paso hacia "return" al ver procesoPausado: la inmersion se
// abandonaba despues de bajar y el ascenso nunca ocurria, asi que cada
// pausa/reanudacion dejaba Z mas abajo que al empezar. Pausando y reanudando
// varias veces seguidas el eje caminaba hasta el switch de fondo, y ahi cada
// RESUME volvia a autopausarse.
bool esperarSiPausado() {
  bool avisado = false;

  while (procesoActivo && procesoPausado && !emergencyStop) {
    homeSwitchY.loop();
    limitMinSwitchY.loop();
    limitMaxSwitchY.loop();
    homeSwitchZ.loop();
    limitMinSwitchZ.loop();
    limitMaxSwitchZ.loop();
    emergencySwitch.loop();

    if (emergencySwitch.getState() == HIGH) {
      emergencyStop = true;
      procesoActivo = false;
      procesoPausado = false;
      stepperY.stop();
      stepperZ.stop();
      digitalWrite(enablePinY, HIGH);
      digitalWrite(enablePinZ, HIGH);
      Serial.println("PARO DE EMERGENCIA ACTIVADO");
      break;
    }

    // loop() no corre mientras esperamos aqui, asi que hay que seguir
    // atendiendo el serial y publicando STATUS a mano: sin esto la PC veria la
    // placa muda y el RESUME nunca llegaria.
    verificarComandosDuranteMovimiento();

    if (!avisado) {
      avisado = true;
      Serial.println("Receta en pausa: el paso en curso queda congelado");
    }

    if (millis() - ultimoStatusMs >= STATUS_INTERVAL_MS) {
      ultimoStatusMs = millis();
      enviarStatus();
    }

    delay(10);
  }

  return procesoActivo && !procesoPausado && !emergencyStop;
}

void moverEjeZVelocidad(long pasos, long velocidadMicrosegundos) {
  if (emergencyStop || (emergencySwitch.getState() == HIGH)) {
    Serial.println("Error: Paro de emergencia activo");
    return;
  }

  if (pasos == 0) return;

  bool direccionPositiva = (pasos > 0);
  long objetivo = posZ + pasos;

  // Si el switch de ese lado ya esta pisado no tiene sentido arrancar: se
  // pausaria a los pocos pasos una y otra vez. Mejor decirlo claro para que el
  // operador sepa que toca rescatar el eje a mano.
  homeSwitchZ.loop();
  limitMaxSwitchZ.loop();
  if (direccionPositiva && homeSwitchZ.getState() == HIGH) {
    Serial.println("ADVERTENCIA: Z ya esta en el switch de arriba, no se puede subir mas");
    pausarProcesoLimite();
    return;
  }
  if (!direccionPositiva && limitMaxSwitchZ.getState() == HIGH) {
    Serial.println("ADVERTENCIA: Z ya esta en el switch de abajo, no se puede bajar mas");
    pausarProcesoLimite();
    return;
  }

  // Límite virtual de seguridad (Software Limit).
  // Ya no es un número mágico: sale de ALTURA_MINIMA_MM y la calibración,
  // declaradas junto a las constantes del eje Z al principio del sketch.
  if (!direccionPositiva && objetivo < LIMITE_SOFTWARE_Z_ABAJO) {
    objetivo = LIMITE_SOFTWARE_Z_ABAJO;
    Serial.println("ADVERTENCIA: Limite virtual de Z alcanzado");
  }

  // Techo de la receta: mientras el proceso automático corre, Z no puede subir
  // por encima de la altura inicial declarada en dipStartPosition.
  // No aplica al homing ni al modo manual, que dejan techoZReceta en 0.
  if (direccionPositiva && procesoActivo && techoZReceta != 0 && objetivo > techoZReceta) {
    objetivo = techoZReceta;
    Serial.println("ADVERTENCIA: Techo de receta alcanzado en Z");
  }

  // Convertir microsegundos entre flancos a pasos/segundo (aproximado)
  long microsClamped = velocidadMicrosegundos <= 0 ? 200 : velocidadMicrosegundos;
  float velocidadTarget = 1000000.0f / (2.0f * microsClamped); // dos flancos por ciclo
  if (velocidadTarget > MAX_SPEED_Z) {
    velocidadTarget = MAX_SPEED_Z;
    Serial.print("ADVERTENCIA: Velocidad Z recortada a ");
    Serial.print(MAX_SPEED_Z / PASOS_POR_MM_Z, 1);
    Serial.println(" mm/s (tope del eje)");
  }
  if (velocidadTarget < 10.0f) velocidadTarget = 10.0f;

  float aceleracion = velocidadTarget * 2.0f;
  if (aceleracion < 100.0f) aceleracion = 100.0f;
  // Techo mecánico del eje. Sin esto, cualquier tramo rápido (el posicionamiento
  // inicial va a MAX_SPEED_Z) pedía 4000 pasos/s^2 contra los 1500 que aguanta
  // Z, y los pasos perdidos descuadran posZ en silencio: la altura en mm deja de
  // corresponder con la real y la inmersión siguiente baja de más.
  if (aceleracion > MAX_ACCEL_Z) aceleracion = MAX_ACCEL_Z;

  float velocidadAnterior = stepperZ.maxSpeed();
  float aceleracionAnterior = stepperZ.acceleration();

  stepperZ.setMaxSpeed(velocidadTarget);
  stepperZ.setAcceleration(aceleracion);
  stepperZ.moveTo(objetivo);

  bool procesoEnCurso = procesoActivo;

  while (stepperZ.distanceToGo() != 0) {
    homeSwitchZ.loop();
    limitMinSwitchZ.loop();
    limitMaxSwitchZ.loop();
    emergencySwitch.loop();

    if (emergencySwitch.getState() == HIGH) {
      emergencyStop = true;
      procesoActivo = false;
      procesoPausado = false;
      stepperY.stop();
      stepperZ.stop();
      digitalWrite(enablePinY, HIGH);  // Deshabilitar motores al instante
      digitalWrite(enablePinZ, HIGH);
      Serial.println("PARO DE EMERGENCIA ACTIVADO");
      break;
    }

    // 2. Escuchar comandos serie (STOP/PAUSE) durante el movimiento
    verificarComandosDuranteMovimiento();

    if (emergencyStop) {
      Serial.println("Movimiento Z interrumpido");
      stepperZ.stop();
      posZ = stepperZ.currentPosition();
      stepperZ.setCurrentPosition(posZ);
      break;
    }

    // Pausa: frenar donde este, esperar, y RETOMAR el mismo objetivo. Antes
    // aqui habia un break y el tramo que faltaba se perdia para siempre, que es
    // lo que dejaba el eje un poco mas abajo despues de cada pausa.
    if (procesoActivo && procesoPausado) {
      stepperZ.stop();
      while (stepperZ.distanceToGo() != 0) {   // frenada suave, sin perder pasos
        homeSwitchZ.loop();
        limitMaxSwitchZ.loop();
        if (direccionPositiva && homeSwitchZ.getState() == HIGH) break;
        if (!direccionPositiva && limitMaxSwitchZ.getState() == HIGH) break;
        stepperZ.run();
      }
      posZ = stepperZ.currentPosition();
      stepperZ.setCurrentPosition(posZ);

      if (!esperarSiPausado()) break;   // llego STOP o paro de emergencia

      if (ejeMovidoAManoEnPausa) {
        Serial.println("AVISO: Z se movio a mano durante la pausa, el tramo pendiente se descarta");
        break;
      }

      stepperZ.setMaxSpeed(velocidadTarget);
      stepperZ.setAcceleration(aceleracion);
      stepperZ.moveTo(objetivo);
      continue;
    }
    if (procesoEnCurso && !procesoActivo) {
      Serial.println("Movimiento Z cancelado");
      stepperZ.stop();
      posZ = stepperZ.currentPosition();
      stepperZ.setCurrentPosition(posZ);
      break;
    }

    // 3. Verificar límites físicos según dirección
    // Subir (Z+) → verificar homeSwitchZ (switch físico en pin 14)
    if (direccionPositiva && homeSwitchZ.getState() == HIGH) {
      Serial.println("Limite Z Home alcanzado");
      stepperZ.stop();
      posZ = stepperZ.currentPosition();
      stepperZ.setCurrentPosition(posZ);
      pausarProcesoLimite();
      break;
    }
    // Bajar (Z-) → verificar limitMaxSwitchZ (switch físico en pin 15)
    if (!direccionPositiva && limitMaxSwitchZ.getState() == HIGH) {
      Serial.println("Limite Z Max alcanzado");
      stepperZ.stop();
      posZ = stepperZ.currentPosition();
      stepperZ.setCurrentPosition(posZ);
      pausarProcesoLimite();
      break;
    }

    stepperZ.run();
  }

  posZ = stepperZ.currentPosition();
  stepperZ.setCurrentPosition(posZ);

  // Restaurar parámetros originales
  stepperZ.setMaxSpeed(velocidadAnterior);
  stepperZ.setAcceleration(aceleracionAnterior);
}

void ejecutarHome() {
  Serial.println("Sending HOME");
  
  if (emergencyStop) {
    Serial.println("Error: Paro de emergencia activo");
    return;
  }

  // El home tiene que poder llegar hasta arriba del todo, sin el techo de receta.
  techoZReceta = 0;

  // Habilitar motores antes de mover
  digitalWrite(enablePinY, LOW);
  digitalWrite(enablePinZ, LOW);

  // --- Home Z ---
  // Mueve Z en la dirección del home (+) hasta que el switch se active (Z+ sube físicamente con setPinsInverted)
  posZ = 0;
  stepperZ.setCurrentPosition(0);
  stepperZ.setMaxSpeed(MAX_SPEED_Z * 0.5); // Velocidad reducida para home
  stepperZ.setAcceleration(MAX_ACCEL_Z);
  stepperZ.moveTo(4000); // Distancia máxima de búsqueda (UP es positivo)
  while (stepperZ.distanceToGo() != 0) {
    emergencySwitch.loop();
    homeSwitchZ.loop();
    if (emergencySwitch.getState() == HIGH || homeSwitchZ.getState() == HIGH) {
      stepperZ.stop();
      break;
    }
    stepperZ.run();
  }
  // Back-off: retroceder para liberar el switch (DOWN es negativo)
  stepperZ.setCurrentPosition(0);
  stepperZ.moveTo(-150); // Alejar del switch (DOWN)
  while (stepperZ.distanceToGo() != 0) {
    stepperZ.run();
  }
  posZ = 0;
  stepperZ.setCurrentPosition(0);
  stepperZ.setMaxSpeed(MAX_SPEED_Z);
  Serial.println("Home Z completado");

  // --- Home Y ---
  // Mueve Y en la dirección del home (-) hasta que el switch se active
  posY = 0;
  stepperY.setCurrentPosition(0);
  stepperY.setMaxSpeed(MAX_SPEED_Y * 0.5); // Velocidad reducida para home
  stepperY.setAcceleration(MAX_ACCEL_Y);
  stepperY.moveTo(-25000); // Distancia máxima de búsqueda (Aumentado porque el eje Y es de 15000+ pasos)
  while (stepperY.distanceToGo() != 0) {
    emergencySwitch.loop();
    homeSwitchY.loop();
    if (emergencySwitch.getState() == HIGH || homeSwitchY.getState() == HIGH) {
      stepperY.stop();
      break;
    }
    stepperY.run();
  }
  // Back-off: retroceder para liberar el switch
  stepperY.setCurrentPosition(0);
  stepperY.moveTo(150); // Alejar del switch
  while (stepperY.distanceToGo() != 0) {
    stepperY.run();
  }
  posY = 0;
  stepperY.setCurrentPosition(0);
  stepperY.setMaxSpeed(MAX_SPEED_Y);
  Serial.println("Home Y completado");

  Serial.println("Secuencia HOME completada");
}

void moverEjeY(long pasos) {
  if (emergencyStop || (emergencySwitch.getState() == HIGH)) {
    Serial.println("Error: Paro de emergencia activo");
    return;
  }
  
  if (pasos == 0) {
    Serial.print("Y: ");
    Serial.println(posY);
    return;
  }
  
  bool direccionPositiva = (pasos > 0);
  long objetivo = posY + pasos;

  // Durante una receta la velocidad de Y la manda transferSpeedMMs, en mm/s. Aquí
  // se pasa a pasos/s directamente, sin dar el rodeo por microsegundos, porque
  // AccelStepper ya trabaja en pasos/s. En manual se usa la velocidad máxima,
  // para que el jog no dependa de la última receta cargada.
  // Esta misma velocidad rige el regreso de Y4 a Y1 entre ciclos: ese tramo no es
  // un movimiento aparte, es la primera inmersión del ciclo siguiente.
  float velocidadY = MAX_SPEED_Y;
  if (procesoActivo) {
    velocidadY = recipeParams.transferSpeedMMs * PASOS_POR_MM_Y;
    if (velocidadY > MAX_SPEED_Y) {
      velocidadY = MAX_SPEED_Y;
      Serial.print("ADVERTENCIA: Velocidad Y recortada a ");
      Serial.print(MAX_SPEED_Y / PASOS_POR_MM_Y, 1);
      Serial.print(" mm/s de los ");
      Serial.print(recipeParams.transferSpeedMMs, 1);
      Serial.println(" mm/s pedidos (tope del eje)");
    }
    if (velocidadY < 10.0f) velocidadY = 10.0f;
  }

  stepperY.setMaxSpeed(velocidadY);
  stepperY.setAcceleration(MAX_ACCEL_Y);

  Serial.print("Moviendo Y: ");
  Serial.print(direccionPositiva ? "+" : "-");
  Serial.println(labs(pasos));

  stepperY.moveTo(objetivo);

  bool procesoEnCurso = procesoActivo;

  while (stepperY.distanceToGo() != 0) {
    homeSwitchY.loop();
    limitMinSwitchY.loop();
    limitMaxSwitchY.loop();
    emergencySwitch.loop();

    // 1. Verificar paro de emergencia físico instantáneamente
    if (emergencySwitch.getState() == HIGH) {
      emergencyStop = true;
      procesoActivo = false;
      procesoPausado = false;
      stepperY.stop();
      stepperZ.stop();
      digitalWrite(enablePinY, HIGH);
      digitalWrite(enablePinZ, HIGH);
      Serial.println("PARO DE EMERGENCIA ACTIVADO");
      break;
    }

    // 2. Escuchar comandos serie (STOP/PAUSE) durante el movimiento
    verificarComandosDuranteMovimiento();

    if (procesoEnCurso && !procesoActivo) {
      Serial.println("Movimiento Y cancelado");
      stepperY.stop();
      break;
    }
    // Mismo criterio que en Z: la pausa congela el tramo y luego lo termina.
    if (procesoActivo && procesoPausado) {
      stepperY.stop();
      while (stepperY.distanceToGo() != 0) {
        homeSwitchY.loop();
        limitMaxSwitchY.loop();
        if (direccionPositiva && limitMaxSwitchY.getState() == HIGH) break;
        if (!direccionPositiva && homeSwitchY.getState() == HIGH) break;
        stepperY.run();
      }

      if (!esperarSiPausado()) break;

      stepperY.setMaxSpeed(velocidadY);
      stepperY.setAcceleration(MAX_ACCEL_Y);
      stepperY.moveTo(objetivo);
      continue;
    }

    // 3. Verificar límites físicos según dirección
    if (direccionPositiva && limitMaxSwitchY.getState() == HIGH) {
      Serial.println("Limite Y Max alcanzado");
      stepperY.stop();
      pausarProcesoLimite();
      break;
    }
    if (!direccionPositiva && homeSwitchY.getState() == HIGH) {
      Serial.println("Limite Y Min alcanzado");
      stepperY.stop();
      pausarProcesoLimite();
      break;
    }

    stepperY.run();
  }

  posY = stepperY.currentPosition();
  stepperY.setCurrentPosition(posY);

  Serial.print("Y: ");
  Serial.println(posY);
}

void moverEjeZ(long pasos) {
  if (emergencyStop || (emergencySwitch.getState() == HIGH)) {
    Serial.println("Error: Paro de emergencia activo");
    return;
  }
  
  if (pasos == 0) {
    Serial.print("Z: ");
    Serial.println(posZ);
    return;
  }
  
  bool direccionPositiva = (pasos > 0);
  long objetivo = posZ + pasos;

  // El jog manual comparte el mismo fondo que el movimiento por receta.
  // Sin esto, un Z-9999 desde el monitor serial se lleva el sustrato al suelo.
  if (!direccionPositiva && objetivo < LIMITE_SOFTWARE_Z_ABAJO) {
    objetivo = LIMITE_SOFTWARE_Z_ABAJO;
    Serial.print("ADVERTENCIA: Limite virtual de Z alcanzado (");
    Serial.print(ALTURA_MINIMA_MM, 1);
    Serial.println(" mm sobre el suelo)");
  }

  stepperZ.setMaxSpeed(MAX_SPEED_Z);
  stepperZ.setAcceleration(MAX_ACCEL_Z);

  // Esta función solo la invoca el comando serial "Z": es jog manual puro, la
  // receta usa moverEjeZVelocidad. Por eso el movimiento se permite aunque haya
  // un proceso pausado: si un límite pausó la receta, mover el eje a mano es
  // justo lo que hace falta para rescatarlo, y bloquearlo dejaba la máquina
  // muerta sin más salida que STOP.
  if (procesoActivo && procesoPausado) {
    ejeMovidoAManoEnPausa = true;
    Serial.println("AVISO: Receta pausada. El jog manual la descuadrara si luego se reanuda con RESUME.");
  }

  Serial.print("Moviendo Z: ");
  Serial.print(direccionPositiva ? "+" : "-");
  Serial.println(labs(pasos));

  stepperZ.moveTo(objetivo);

  bool procesoEnCurso = procesoActivo;

  while (stepperZ.distanceToGo() != 0) {
    homeSwitchZ.loop();
    limitMinSwitchZ.loop();
    limitMaxSwitchZ.loop();
    emergencySwitch.loop();

    // 1. Verificar paro de emergencia físico instantáneamente
    if (emergencySwitch.getState() == HIGH) {
      emergencyStop = true;
      procesoActivo = false;
      procesoPausado = false;
      stepperY.stop();
      stepperZ.stop();
      digitalWrite(enablePinY, HIGH);
      digitalWrite(enablePinZ, HIGH);
      Serial.println("PARO DE EMERGENCIA ACTIVADO");
      break;
    }

    // 2. Escuchar comandos serie (STOP/PAUSE) durante el movimiento
    verificarComandosDuranteMovimiento();

    if (procesoEnCurso && !procesoActivo) {
      Serial.println("Movimiento Z cancelado");
      stepperZ.stop();
      break;
    }
    // NO se corta el movimiento por procesoPausado: ver el aviso de arriba.

    // 3. Verificar límites físicos
    // Subir (Z+) → verificar homeSwitchZ (switch físico en pin 14)
    if (direccionPositiva && homeSwitchZ.getState() == HIGH) {
      Serial.println("Limite Z Home alcanzado");
      stepperZ.stop();
      pausarProcesoLimite();
      break;
    }
    // Bajar (Z-) → verificar limitMaxSwitchZ (switch físico en pin 15)
    if (!direccionPositiva && limitMaxSwitchZ.getState() == HIGH) {
      Serial.println("Limite Z Max alcanzado");
      stepperZ.stop();
      pausarProcesoLimite();
      break;
    }

    stepperZ.run();
  }

  posZ = stepperZ.currentPosition();
  stepperZ.setCurrentPosition(posZ);

  Serial.print("Z: ");
  Serial.println(posZ);
}

void enviarStatus() {
  Serial.print("STATUS:");
  Serial.print("Mode=");
  Serial.print(modo == 0 ? "MANUAL" : "AUTOMATIC");
  Serial.print(",Emergency=");
  Serial.print(emergencyStop ? "1" : "0");
  Serial.print(",ProcessActive=");
  Serial.print(procesoActivo ? "1" : "0");
  Serial.print(",ProcessPaused=");
  Serial.print(procesoPausado ? "1" : "0");
  Serial.print(",Cycle=");
  Serial.print(cicloActual);
  Serial.print("/");
  Serial.print(ciclosTotales);
  Serial.print(",Y=");
  Serial.print(posY);
  Serial.print(",Z=");
  Serial.print(posZ);
  Serial.print(",Zmm=");
  Serial.print(pasosZaAlturaMM(posZ), 1);
  Serial.print(",HomeY=");
  Serial.print(digitalRead(homePinY) == HIGH ? "1" : "0");
  Serial.print(",HomeZ=");
  Serial.print(digitalRead(homePinZ) == HIGH ? "1" : "0");
  Serial.print(",LimitMinY=");
  Serial.print(digitalRead(limitMinY) == HIGH ? "1" : "0");
  Serial.print(",LimitMaxY=");
  Serial.print(digitalRead(limitMaxY) == HIGH ? "1" : "0");
  Serial.print(",LimitMinZ=");
  Serial.print(digitalRead(limitMinZ) == HIGH ? "1" : "0");
  Serial.print(",LimitMaxZ=");
  Serial.print(digitalRead(limitMaxZ) == HIGH ? "1" : "0");
  Serial.print(",Lamp=");
  Serial.print(digitalRead(lampPin) == HIGH ? "1" : "0");
  Serial.print(",Fan=");
  Serial.println(digitalRead(fanPin) == HIGH ? "1" : "0");
}

// Publica la geometria de la maquina (posiciones de vasos y calibracion de los
// dos ejes). Cambia solo al recalibrar, por eso se envia una vez al arrancar y
// cuando el PC la pide con "CONFIG", en lugar de repetirla en cada STATUS.
// Ojo: quien recalibre Y por CAL_Y_* debe releer esto, porque Y1..Y4 se mueven.
void enviarConfig() {
  Serial.print("CONFIG:");
  Serial.print("Y1=");
  Serial.print(POS_Y1);
  Serial.print(",Y2=");
  Serial.print(POS_Y2);
  Serial.print(",Y3=");
  Serial.print(POS_Y3);
  Serial.print(",Y4=");
  Serial.print(POS_Y4);
  Serial.print(",HomeY=0");
  Serial.print(",AlturaHomeMM=");
  Serial.print(ALTURA_HOME_MM, 1);
  Serial.print(",AlturaMinimaMM=");
  Serial.print(ALTURA_MINIMA_MM, 1);
  Serial.print(",PasosPorMMZ=");
  Serial.print(PASOS_POR_MM_Z, 3);
  Serial.print(",PasosPorMMY=");
  Serial.println(PASOS_POR_MM_Y, 3);
}

void pruebaStepManual(int pinStep, int pinDir) {
  Serial.println("STEP_TEST: Iniciando");
  digitalWrite(pinDir, HIGH);
  for (int i = 0; i < 10; i++) {
    digitalWrite(pinStep, HIGH);
    delay(200);
    digitalWrite(pinStep, LOW);
    delay(200);
  }
  digitalWrite(pinDir, LOW);
  for (int i = 0; i < 10; i++) {
    digitalWrite(pinStep, HIGH);
    delay(200);
    digitalWrite(pinStep, LOW);
    delay(200);
  }
  Serial.println("STEP_TEST: Finalizado");
}
void enviarStatusHardware() {
  Serial.print("HW_STATUS:");
  Serial.print("EnableY=");
  Serial.print(digitalRead(enablePinY) == HIGH ? "HIGH" : "LOW");
  Serial.print(",EnableZ=");
  Serial.print(digitalRead(enablePinZ) == HIGH ? "HIGH" : "LOW");
  Serial.print(",DirY=");
  Serial.print(digitalRead(dirPinY) == HIGH ? "HIGH" : "LOW");
  Serial.print(",DirZ=");
  Serial.print(digitalRead(dirPinZ) == HIGH ? "HIGH" : "LOW");
  Serial.print(",StepY=");
  Serial.print(digitalRead(stepPinY) == HIGH ? "HIGH" : "LOW");
  Serial.print(",StepZ=");
  Serial.print(digitalRead(stepPinZ) == HIGH ? "HIGH" : "LOW");
  Serial.print(",LampPin=");
  Serial.print(digitalRead(lampPin) == HIGH ? "HIGH" : "LOW");
  Serial.print(",FanPin=");
  Serial.println(digitalRead(fanPin) == HIGH ? "HIGH" : "LOW");
}
