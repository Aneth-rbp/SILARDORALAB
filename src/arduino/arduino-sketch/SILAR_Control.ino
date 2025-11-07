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
const int dirPinY = 2;        // DIR+ para driver Y (D2 - PE4)
const int stepPinY = 3;       // PUL+ para driver Y (D3 - PE5)
const int enablePinY = 4;     // ENA+ para driver Y (D4 - PG5)
const int homePinY = 9;       // Home Y - LS 1 (D9 - PH6)
const int limitMinY = 10;     // Límite mínimo Y - LS 2 (D10 - PB4)
const int limitMaxY = 11;     // Límite máximo Y - LS 3 (D11 - PB5)

// ============================================
// PINES DE CONTROL - EJE Z (STEPPER Z)
// ============================================
const int dirPinZ = 5;        // DIR+ para driver Z (D5 - PE3)
const int stepPinZ = 6;       // PUL+ para driver Z (D6 - PH3)
const int enablePinZ = 7;     // ENA+ para driver Z (D7 - PH4)
const int homePinZ = 12;      // Home Z - LS 4 (D12 - PB6)
const int limitMinZ = 13;     // Límite mínimo Z - LS 5 (D13 - PB7)
const int limitMaxZ = 8;      // Límite máximo Z - LS 6 (D8 - PH5)

// ============================================
// PINES DE ENTRADA - SEGURIDAD
// ============================================
const int emergencyPin = A0;  // Paro de emergencia (A0/D54 - PF0)

// ============================================
// PINES DE SALIDA - ACCESORIOS
// ============================================
const int lampPin = A1;       // Lámpara interior (A1/D55 - PF1)
const int fanPin = A2;        // Extractor/Ventilador (A2/D56 - PF2)

// Variables de estado
int modo = 0; // 0=Manual, 1=Automatico
bool emergencyStop = false;
long posY = 0;
long posZ = 0;

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
// Estos valores deben calibrarse según el hardware real
const long POS_Y1 = 0;      // Posición Y para solución 1
const long POS_Y2 = 5000;  // Posición Y para solución 2 (ajustar según hardware)
const long POS_Y3 = 10000; // Posición Y para solución 3 (ajustar según hardware)
const long POS_Y4 = 15000; // Posición Y para solución 4 (ajustar según hardware)

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
  
  // Habilitar motores (LOW = habilitado para la mayoría de drivers)
  digitalWrite(enablePinY, LOW);
  digitalWrite(enablePinZ, LOW);
  
  Serial.println("Sistema SILAR Iniciado");
  Serial.println("Hardware: Arduino Mega 2560 Rev3");
  Serial.println("Documento: MOC-ELEC-001");
}

void loop() {
  // Verificar paro de emergencia
  if (digitalRead(emergencyPin) == LOW) {
    if (!emergencyStop) {
      emergencyStop = true;
      procesoActivo = false;
      procesoPausado = false;
      digitalWrite(enablePinY, HIGH);
      digitalWrite(enablePinZ, HIGH);
      Serial.println("PARO DE EMERGENCIA ACTIVADO");
    }
    return;
  } else {
    if (emergencyStop) {
      emergencyStop = false;
      digitalWrite(enablePinY, LOW);
      digitalWrite(enablePinZ, LOW);
      Serial.println("Paro de emergencia desactivado");
    }
  }
  
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
    int start = idx + 14;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      recipeParams.dippingWait0 = json.substring(start, end).toInt();
    }
  }
  
  idx = json.indexOf("\"dippingWait1\":");
  if (idx >= 0) {
    int start = idx + 14;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      recipeParams.dippingWait1 = json.substring(start, end).toInt();
    }
  }
  
  idx = json.indexOf("\"dippingWait2\":");
  if (idx >= 0) {
    int start = idx + 14;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      recipeParams.dippingWait2 = json.substring(start, end).toInt();
    }
  }
  
  idx = json.indexOf("\"dippingWait3\":");
  if (idx >= 0) {
    int start = idx + 14;
    int end = json.indexOf(",", start);
    if (end < 0) end = json.indexOf("}", start);
    if (end > start) {
      recipeParams.dippingWait3 = json.substring(start, end).toInt();
    }
  }
  
  // Transfer wait
  idx = json.indexOf("\"transferWait\":");
  if (idx >= 0) {
    int start = idx + 14;
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
    int start = idx + 15;
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
  
  // Bajar Z para inmersión
  moverEjeZVelocidad(-recipeParams.dippingLength, recipeParams.dipSpeed);
  
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
  
  // Subir Z
  moverEjeZVelocidad(recipeParams.dippingLength, recipeParams.dipSpeed);
  
  Serial.print("INMERSION_COMPLETADA: Y");
  Serial.println(numInmersion);
}

void moverEjeYAbsoluto(long posicionObjetivo) {
  long diferencia = posicionObjetivo - posY;
  moverEjeY(diferencia);
}

void moverEjeZVelocidad(long pasos, long velocidadMicrosegundos) {
  if (emergencyStop) {
    Serial.println("Error: Paro de emergencia activo");
    return;
  }
  
  if (pasos == 0) return;
  
  bool direccion = (pasos > 0);
  if (!direccion) {
    pasos = -pasos;
  }
  
  digitalWrite(dirPinZ, direccion ? HIGH : LOW);
  
  for (long i = 0; i < pasos; i++) {
    if (emergencyStop || !procesoActivo || procesoPausado) {
      Serial.println("Movimiento Z interrumpido");
      return;
    }
    
    // Verificar límites
    if (digitalRead(limitMinZ) == LOW && !direccion) {
      Serial.println("Limite Z Min alcanzado");
      return;
    }
    if (digitalRead(limitMaxZ) == LOW && direccion) {
      Serial.println("Limite Z Max alcanzado");
      return;
    }
    
    // Ejecutar paso
    digitalWrite(stepPinZ, HIGH);
    delayMicroseconds(velocidadMicrosegundos);
    digitalWrite(stepPinZ, LOW);
    delayMicroseconds(velocidadMicrosegundos);
    
    // Actualizar posición
    posZ += direccion ? 1 : -1;
  }
}

void ejecutarHome() {
  Serial.println("Iniciando secuencia HOME");
  
  // Home Eje Y
  Serial.println("Buscando Home Y");
  digitalWrite(dirPinY, LOW); // Dirección hacia home
  while (digitalRead(homePinY) == HIGH) {
    if (emergencyStop) return;
    digitalWrite(stepPinY, HIGH);
    delayMicroseconds(1000);
    digitalWrite(stepPinY, LOW);
    delayMicroseconds(1000);
  }
  posY = 0;
  Serial.println("Home Y encontrado");
  
  // Home Eje Z
  Serial.println("Buscando Home Z");
  digitalWrite(dirPinZ, LOW);
  while (digitalRead(homePinZ) == HIGH) {
    if (emergencyStop) return;
    digitalWrite(stepPinZ, HIGH);
    delayMicroseconds(1000);
    digitalWrite(stepPinZ, LOW);
    delayMicroseconds(1000);
  }
  posZ = 0;
  Serial.println("Home Z encontrado");
  
  Serial.println("Secuencia HOME completada");
}

void moverEjeY(long pasos) {
  if (emergencyStop) {
    Serial.println("Error: Paro de emergencia activo");
    return;
  }
  
  if (pasos == 0) {
    Serial.println("Y: 0");
    return;
  }
  
  bool direccion = (pasos > 0);
  if (!direccion) {
    pasos = -pasos;
  }
  
  digitalWrite(dirPinY, direccion ? HIGH : LOW);
  Serial.print("Moviendo Y: ");
  Serial.print(direccion ? "+" : "-");
  Serial.println(pasos);
  
  for (long i = 0; i < pasos; i++) {
    if (emergencyStop) {
      Serial.println("Movimiento Y interrumpido: Paro de emergencia");
      return;
    }
    
    // Verificar límites antes de mover
    if (digitalRead(limitMinY) == LOW) {
      Serial.println("Limite Y Min alcanzado");
      return;
    }
    if (digitalRead(limitMaxY) == LOW) {
      Serial.println("Limite Y Max alcanzado");
      return;
    }
    
    // Ejecutar paso
    digitalWrite(stepPinY, HIGH);
    delayMicroseconds(1000);
    digitalWrite(stepPinY, LOW);
    delayMicroseconds(1000);
    
    // Actualizar posición
    posY += direccion ? 1 : -1;
  }
  
  Serial.print("Y: ");
  Serial.println(posY);
}

void moverEjeZ(long pasos) {
  if (emergencyStop) {
    Serial.println("Error: Paro de emergencia activo");
    return;
  }
  
  if (pasos == 0) {
    Serial.println("Z: 0");
    return;
  }
  
  bool direccion = (pasos > 0);
  if (!direccion) {
    pasos = -pasos;
  }
  
  digitalWrite(dirPinZ, direccion ? HIGH : LOW);
  Serial.print("Moviendo Z: ");
  Serial.print(direccion ? "+" : "-");
  Serial.println(pasos);
  
  for (long i = 0; i < pasos; i++) {
    if (emergencyStop) {
      Serial.println("Movimiento Z interrumpido: Paro de emergencia");
      return;
    }
    
    // Verificar límites antes de mover
    if (digitalRead(limitMinZ) == LOW) {
      Serial.println("Limite Z Min alcanzado");
      return;
    }
    if (digitalRead(limitMaxZ) == LOW) {
      Serial.println("Limite Z Max alcanzado");
      return;
    }
    
    // Ejecutar paso
    digitalWrite(stepPinZ, HIGH);
    delayMicroseconds(1000);
    digitalWrite(stepPinZ, LOW);
    delayMicroseconds(1000);
    
    // Actualizar posición
    posZ += direccion ? 1 : -1;
  }
  
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
  Serial.print(digitalRead(homePinY) == LOW ? "1" : "0");
  Serial.print(",HomeZ=");
  Serial.print(digitalRead(homePinZ) == LOW ? "1" : "0");
  Serial.print(",LimitMinY=");
  Serial.print(digitalRead(limitMinY) == LOW ? "1" : "0");
  Serial.print(",LimitMaxY=");
  Serial.print(digitalRead(limitMaxY) == LOW ? "1" : "0");
  Serial.print(",LimitMinZ=");
  Serial.print(digitalRead(limitMinZ) == LOW ? "1" : "0");
  Serial.print(",LimitMaxZ=");
  Serial.print(digitalRead(limitMaxZ) == LOW ? "1" : "0");
  Serial.print(",Lamp=");
  Serial.print(digitalRead(lampPin) == HIGH ? "1" : "0");
  Serial.print(",Fan=");
  Serial.println(digitalRead(fanPin) == HIGH ? "1" : "0");
}
