#include <ezButton.h>

/*
 * Prueba de Hardware SILAR - Eje Y
 *
 * Este sketch genera pulsos directos sobre el driver del motor Y
 * para validar cableado, señales STEP/DIR/ENA y finales de carrera.
 * Incluye logs detallados que permiten ver en el monitor serie cada
 * transición de hardware.
 *
 * Hardware: Arduino Mega 2560 Rev3
 */

// Pines principales del eje Y - Según diagrama MOC-ELEC-001
// ENA: LOW = habilitado, HIGH = deshabilitado (activo-LOW)
const int stepPinY = 2;      // PUL+ (D2)
const int dirPinY = 3;       // DIR+ (D3)
const int enablePinY = 4;    // ENA+ (D4) - LOW=habilitado, HIGH=deshabilitado
const int homePinY = 17;     // lsYi - Home/Límite mínimo Y (D17)
const int limitMinY = 17;    // lsYi - mismo que homePinY
const int limitMaxY = 16;    // lsYf - Límite máximo Y (D16)

// Configuración de prueba
const unsigned int STEP_PULSE_US = 800;   // Duración de cada flanco HIGH/LOW
const unsigned int PAUSA_CAMBIO_DIR_MS = 500;
const unsigned int PAUSA_ENTRE_BLOQUES_MS = 1000;
const long PASOS_POR_BLOQUE = 800;

// Entradas con antiprebote
ezButton homeSwitchY(homePinY);
ezButton limitMinSwitchY(limitMinY);
ezButton limitMaxSwitchY(limitMaxY);

// Prototipos
void imprimirEncabezado();
void imprimirEstadoHardware(const char* origen);
void generarPasos(bool sentidoPositivo, long cantidadPasos);
bool verificarLimites(bool sentidoPositivo);
void actualizarEntradas();
String leerComando();

void setup() {
  Serial.begin(9600);

  pinMode(stepPinY, OUTPUT);
  pinMode(dirPinY, OUTPUT);
  pinMode(enablePinY, OUTPUT);

  pinMode(homePinY, INPUT_PULLUP);
  pinMode(limitMinY, INPUT_PULLUP);
  pinMode(limitMaxY, INPUT_PULLUP);

  // Configurar debounce
  homeSwitchY.setDebounceTime(40);
  limitMinSwitchY.setDebounceTime(40);
  limitMaxSwitchY.setDebounceTime(40);

  // Habilitar driver: LOW = habilitado para este driver (activo-LOW)
  digitalWrite(enablePinY, LOW);
  digitalWrite(dirPinY, LOW);
  digitalWrite(stepPinY, LOW);

  imprimirEncabezado();
  imprimirEstadoHardware("SETUP");
}

void loop() {
  actualizarEntradas();

  if (Serial.available() > 0) {
    String comando = leerComando();

    if (comando == "FWD") {
      Serial.println("CMD:FWD -> Iniciando bloque en sentido positivo");
      generarPasos(true, PASOS_POR_BLOQUE);
      Serial.println("CMD:FWD -> Bloque finalizado");
    } else if (comando == "REV") {
      Serial.println("CMD:REV -> Iniciando bloque en sentido negativo");
      generarPasos(false, PASOS_POR_BLOQUE);
      Serial.println("CMD:REV -> Bloque finalizado");
    } else if (comando == "AUTO") {
      Serial.println("CMD:AUTO -> Ejecutando bloque FWD y REV");
      generarPasos(true, PASOS_POR_BLOQUE);
      delay(PAUSA_ENTRE_BLOQUES_MS);
      generarPasos(false, PASOS_POR_BLOQUE);
      Serial.println("CMD:AUTO -> Secuencia completada");
    } else if (comando == "DISABLE") {
      digitalWrite(enablePinY, HIGH);  // HIGH = deshabilitado
      Serial.println("CMD:DISABLE -> Driver deshabilitado (ENA=HIGH)");
      imprimirEstadoHardware("DISABLE");
    } else if (comando == "ENABLE") {
      digitalWrite(enablePinY, LOW);   // LOW = habilitado
      Serial.println("CMD:ENABLE -> Driver habilitado (ENA=LOW)");
      imprimirEstadoHardware("ENABLE");
    } else if (comando == "STATUS") {
      imprimirEstadoHardware("STATUS");
    } else {
      Serial.print("CMD:ERROR -> Comando desconocido: ");
      Serial.println(comando);
    }
  }
}

void imprimirEncabezado() {
  Serial.println("===============================");
  Serial.println("  SILAR - PRUEBA DE HARDWARE");
  Serial.println("  COMANDOS:");
  Serial.println("    FWD      -> Bloque de pasos en sentido +");
  Serial.println("    REV      -> Bloque de pasos en sentido -");
  Serial.println("    AUTO     -> FWD seguido de REV");
  Serial.println("    ENABLE   -> Habilitar driver");
  Serial.println("    DISABLE  -> Deshabilitar driver");
  Serial.println("    STATUS   -> Leer estado actual");
  Serial.println("===============================\n");
}

void imprimirEstadoHardware(const char* origen) {
  Serial.print("HW:");
  Serial.print(origen);
  Serial.print(" | ENA=");
  Serial.print(digitalRead(enablePinY) == HIGH ? "HIGH" : "LOW");
  Serial.print(" DIR=");
  Serial.print(digitalRead(dirPinY) == HIGH ? "HIGH" : "LOW");
  Serial.print(" STEP=");
  Serial.print(digitalRead(stepPinY) == HIGH ? "HIGH" : "LOW");
  Serial.print(" | LS_HOME=");
  Serial.print(homeSwitchY.getState() == LOW ? "ACTIVO" : "LIBRE");
  Serial.print(" LS_MIN=");
  Serial.print(limitMinSwitchY.getState() == LOW ? "ACTIVO" : "LIBRE");
  Serial.print(" LS_MAX=");
  Serial.println(limitMaxSwitchY.getState() == LOW ? "ACTIVO" : "LIBRE");
}

void generarPasos(bool sentidoPositivo, long cantidadPasos) {
  // LOW = habilitado. Si está HIGH (deshabilitado), lo habilitamos.
  if (digitalRead(enablePinY) == HIGH) {
    Serial.println("WARN -> Driver deshabilitado, habilitando automaticamente");
    digitalWrite(enablePinY, LOW);
    delay(10);
  }

  digitalWrite(dirPinY, sentidoPositivo ? HIGH : LOW);
  imprimirEstadoHardware(sentidoPositivo ? "DIR=POS" : "DIR=NEG");
  delay(PAUSA_CAMBIO_DIR_MS);

  Serial.print("PASOS -> Sentido ");
  Serial.print(sentidoPositivo ? "+" : "-");
  Serial.print(" | Cantidad=");
  Serial.println(cantidadPasos);

  for (long i = 0; i < cantidadPasos; i++) {
    if (verificarLimites(sentidoPositivo)) {
      Serial.print("STOP -> Limite ");
      Serial.println(sentidoPositivo ? "MAX activado" : "MIN o HOME activado");
      break;
    }

    digitalWrite(stepPinY, HIGH);
    delayMicroseconds(STEP_PULSE_US);
    digitalWrite(stepPinY, LOW);
    delayMicroseconds(STEP_PULSE_US);

    if ((i + 1) % 100 == 0) {
      Serial.print("PROGRESO -> Pasos ejecutados: ");
      Serial.println(i + 1);
      imprimirEstadoHardware("PROG");
    }
  }

  imprimirEstadoHardware("BLOQUE_FIN");
}

bool verificarLimites(bool sentidoPositivo) {
  actualizarEntradas();

  if (sentidoPositivo) {
    return limitMaxSwitchY.getState() == LOW;
  }

  // Sentido negativo: se detiene con home o límite mínimo
  return (homeSwitchY.getState() == LOW) || (limitMinSwitchY.getState() == LOW);
}

void actualizarEntradas() {
  homeSwitchY.loop();
  limitMinSwitchY.loop();
  limitMaxSwitchY.loop();
}

String leerComando() {
  String comando = Serial.readStringUntil('\n');
  comando.trim();
  comando.toUpperCase();
  return comando;
}

