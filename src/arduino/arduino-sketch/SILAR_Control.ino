#include <AccelStepper.h>
#include <ezButton.h>

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
  long dipStartPosition;  // Posición Z inicial
  long dippingLength;      // Longitud de inmersión en pasos
  long transferSpeed;      // Velocidad de transferencia (pasos/segundo)
  long dipSpeed;           // Velocidad de inmersión (pasos/segundo)
  bool fan;
} recipeParams;

// Posiciones Y para cada solución (en pasos desde home)
// Distribuidos uniformemente de 0 a 12600 (límite máximo físico detectado a 14027 pasos)
const long POS_Y1 = 0;      // Posición Y para solución 1 (Vaso 1)
const long POS_Y2 = 4200;   // Posición Y para solución 2 (Vaso 2)
const long POS_Y3 = 8400;   // Posición Y para solución 3 (Vaso 3)
const long POS_Y4 = 12600;  // Posición Y para solución 4 (Vaso 4)

void setup() {
  Serial.begin(9600);
  
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
  // Usar sentido físico nativo: Z+ baja (soluciones) y Z- sube (home)
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
      iniciarProcesoAutomatico();
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
      // Desactivar accesorios al detener
      digitalWrite(lampPin, LOW);
      digitalWrite(fanPin, LOW);
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
    else if (comando == "STEP_TEST_Y") {
      pruebaStepManual(stepPinY, dirPinY);
    }
    else if (comando == "STEP_TEST_Z") {
      pruebaStepManual(stepPinZ, dirPinZ);
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
  recipeParams.dipStartPosition = 0;
  recipeParams.dippingLength = 10000; // 10000 pasos por defecto
  recipeParams.transferSpeed = 1000;  // microsegundos entre pasos
  recipeParams.dipSpeed = 1000;
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
      recipeParams.dipStartPosition = json.substring(start, end).toInt();
    }
  }
  
  // Dipping length
  idx = json.indexOf("\"dippingLength\":");
  if (idx >= 0) {
    int start = idx + 16;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      recipeParams.dippingLength = json.substring(start, end).toInt();
    }
  }
  
  // Transfer speed
  idx = json.indexOf("\"transferSpeed\":");
  if (idx >= 0) {
    int start = idx + 16;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      recipeParams.transferSpeed = json.substring(start, end).toInt();
      if (recipeParams.transferSpeed < 100) recipeParams.transferSpeed = 100; // Mínimo
    }
  }
  
  // Dip speed
  idx = json.indexOf("\"dipSpeed\":");
  if (idx >= 0) {
    int start = idx + 11;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      recipeParams.dipSpeed = json.substring(start, end).toInt();
      if (recipeParams.dipSpeed < 100) recipeParams.dipSpeed = 100; // Mínimo
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
  Serial.println(recipeParams.dippingWait3);
}

void iniciarProcesoAutomatico() {
  if (modo != 1) {
    Serial.println("ERROR: Debe estar en modo automatico");
    return;
  }
  
  procesoActivo = true;
  procesoPausado = false;
  cicloActual = 0;
  ciclosTotales = recipeParams.cycles;
  
  Serial.print("PROCESO_INICIADO: Ciclos=");
  Serial.println(ciclosTotales);
  
  // Activar lámpara interior al iniciar proceso
  digitalWrite(lampPin, HIGH);
  Serial.println("LAMPARA_ACTIVADA");
  
  // Activar ventilador si está configurado
  if (recipeParams.fan) {
    digitalWrite(fanPin, HIGH);
    Serial.println("VENTILADOR_ACTIVADO");
  }
}

void ejecutarProcesoAutomatico() {
  // Verificar si hay un ciclo pendiente de ejecutar
  if (cicloActual >= ciclosTotales) {
    // Proceso completado
    procesoActivo = false;
    Serial.println("PROCESO_COMPLETADO");
    
    // Desactivar accesorios
    digitalWrite(lampPin, LOW);
    Serial.println("LAMPARA_DESACTIVADA");
    
    if (recipeParams.fan) {
      digitalWrite(fanPin, LOW);
      Serial.println("VENTILADOR_DESACTIVADO");
    }
    return;
  }
  
  // Ejecutar el ciclo actual
  Serial.print("CICLO_INICIADO: ");
  Serial.print(cicloActual + 1);
  Serial.print("/");
  Serial.println(ciclosTotales);
  
  // Ejecutar inmersiones en cada posición Y
  if (!recipeParams.exceptDripping1) {
    ejecutarInmersion(POS_Y1, recipeParams.dippingWait0, 1);
  }
  
  if (!procesoActivo || procesoPausado || emergencyStop) return;
  
  if (!recipeParams.exceptDripping2) {
    ejecutarInmersion(POS_Y2, recipeParams.dippingWait1, 2);
  }
  
  if (!procesoActivo || procesoPausado || emergencyStop) return;
  
  if (!recipeParams.exceptDripping3) {
    ejecutarInmersion(POS_Y3, recipeParams.dippingWait2, 3);
  }
  
  if (!procesoActivo || procesoPausado || emergencyStop) return;
  
  if (!recipeParams.exceptDripping4) {
    ejecutarInmersion(POS_Y4, recipeParams.dippingWait3, 4);
  }
  
  if (!procesoActivo || procesoPausado || emergencyStop) return;
  
  Serial.print("CICLO_COMPLETADO: ");
  Serial.print(cicloActual + 1);
  Serial.print("/");
  Serial.println(ciclosTotales);
  
  // Incrementar ciclo actual
  cicloActual++;
  
  // Si se completaron todos los ciclos, finalizar proceso
  if (cicloActual >= ciclosTotales) {
    procesoActivo = false;
    Serial.println("PROCESO_COMPLETADO");
    
    // Desactivar accesorios
    digitalWrite(lampPin, LOW);
    Serial.println("LAMPARA_DESACTIVADA");
    
    if (recipeParams.fan) {
      digitalWrite(fanPin, LOW);
      Serial.println("VENTILADOR_DESACTIVADO");
    }

    // Regresar a Home automáticamente al finalizar la receta exitosamente
    Serial.println("PROCESO_FINALIZADO: Regresando a Home automaticamente...");
    ejecutarHome();
  }
}

void ejecutarInmersion(long posYTarget, int tiempoEspera, int numInmersion) {
  if (!procesoActivo || procesoPausado || emergencyStop) {
    return;
  }
  
  Serial.print("INMERSION_INICIADA: Y");
  Serial.println(numInmersion);
  
  // Mover a posición Y
  moverEjeYAbsoluto(posYTarget);
  
  if (!procesoActivo || procesoPausado || emergencyStop) return;
  
  // Esperar tiempo de transferencia
  delay(recipeParams.transferWait);
  
  if (!procesoActivo || procesoPausado || emergencyStop) return;
  
  // Bajar Z para inmersión (Z+ baja físicamente)
  moverEjeZVelocidad(recipeParams.dippingLength, recipeParams.dipSpeed);
  
  if (!procesoActivo || procesoPausado || emergencyStop) return;
  
  // Esperar tiempo de inmersión
  unsigned long tiempoInicio = millis();
  while (millis() - tiempoInicio < tiempoEspera) {
    if (!procesoActivo || procesoPausado || emergencyStop) {
      return;
    }
    delay(100); // Verificar cada 100ms
  }
  
  if (!procesoActivo || procesoPausado || emergencyStop) return;
  
  // Subir Z (Z- sube físicamente)
  moverEjeZVelocidad(-recipeParams.dippingLength, recipeParams.dipSpeed);
  
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

void moverEjeZVelocidad(long pasos, long velocidadMicrosegundos) {
  if (emergencyStop || (emergencySwitch.getState() == HIGH)) {
    Serial.println("Error: Paro de emergencia activo");
    return;
  }

  if (pasos == 0) return;

  bool direccionPositiva = (pasos > 0);
  long objetivo = posZ + pasos;

  // Convertir microsegundos entre flancos a pasos/segundo (aproximado)
  long microsClamped = velocidadMicrosegundos <= 0 ? 200 : velocidadMicrosegundos;
  float velocidadTarget = 1000000.0f / (2.0f * microsClamped); // dos flancos por ciclo
  if (velocidadTarget > MAX_SPEED_Z) velocidadTarget = MAX_SPEED_Z;
  if (velocidadTarget < 10.0f) velocidadTarget = 10.0f;

  float aceleracion = velocidadTarget * 2.0f;
  if (aceleracion < 100.0f) aceleracion = 100.0f;

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

    if (emergencyStop || (procesoActivo && procesoPausado)) {
      Serial.println("Movimiento Z interrumpido");
      stepperZ.stop();
      posZ = stepperZ.currentPosition();
      stepperZ.setCurrentPosition(posZ);
      break;
    }
    if (procesoEnCurso && !procesoActivo) {
      Serial.println("Movimiento Z cancelado");
      stepperZ.stop();
      posZ = stepperZ.currentPosition();
      stepperZ.setCurrentPosition(posZ);
      break;
    }

    // 3. Verificar límites físicos según dirección
    // Subir (Z-) → verificar homeSwitchZ (switch físico en pin 14)
    if (!direccionPositiva && homeSwitchZ.getState() == HIGH) {
      Serial.println("Limite Z Home alcanzado");
      stepperZ.stop();
      posZ = stepperZ.currentPosition();
      stepperZ.setCurrentPosition(posZ);
      break;
    }
    // Bajar (Z+) → AccelStepper para en el objetivo exacto (no hay switch inferior físico)

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
  
  // Habilitar motores antes de mover
  digitalWrite(enablePinY, LOW);
  digitalWrite(enablePinZ, LOW);

  // --- Home Z ---
  // Mueve Z en la dirección del home (-) hasta que el switch se active (Z- sube físicamente)
  posZ = 0;
  stepperZ.setCurrentPosition(0);
  stepperZ.setMaxSpeed(MAX_SPEED_Z * 0.5); // Velocidad reducida para home
  stepperZ.setAcceleration(MAX_ACCEL_Z);
  stepperZ.moveTo(-4000); // Distancia máxima de búsqueda (UP es negativo)
  while (stepperZ.distanceToGo() != 0) {
    emergencySwitch.loop();
    homeSwitchZ.loop();
    if (emergencySwitch.getState() == HIGH || homeSwitchZ.getState() == HIGH) {
      stepperZ.stop();
      break;
    }
    stepperZ.run();
  }
  // Back-off: retroceder para liberar el switch (DOWN es positivo)
  stepperZ.setCurrentPosition(0);
  stepperZ.moveTo(150); // Alejar del switch (DOWN)
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

  stepperY.setMaxSpeed(MAX_SPEED_Y);
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
    if (procesoActivo && procesoPausado) {
      Serial.println("Movimiento Y pausado");
      stepperY.stop();
      break;
    }

    // 3. Verificar límites físicos según dirección
    if (direccionPositiva && limitMaxSwitchY.getState() == HIGH) {
      Serial.println("Limite Y Max alcanzado");
      stepperY.stop();
      break;
    }
    if (!direccionPositiva && homeSwitchY.getState() == HIGH) {
      Serial.println("Limite Y Min alcanzado");
      stepperY.stop();
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

  stepperZ.setMaxSpeed(MAX_SPEED_Z);
  stepperZ.setAcceleration(MAX_ACCEL_Z);

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
    if (procesoActivo && procesoPausado) {
      Serial.println("Movimiento Z pausado");
      stepperZ.stop();
      break;
    }

    // 3. Verificar límites físicos
    // Subir (Z-) → verificar homeSwitchZ (switch físico en pin 14)
    if (!direccionPositiva && homeSwitchZ.getState() == HIGH) {
      Serial.println("Limite Z Home alcanzado");
      stepperZ.stop();
      break;
    }
    // Bajar (Z+) → AccelStepper para en el objetivo exacto (no hay switch inferior físico)

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
