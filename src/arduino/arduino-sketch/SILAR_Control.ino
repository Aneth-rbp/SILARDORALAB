/*
 * CÓDIGO ORIGINAL DE ARDUINO - NO MODIFICAR
 * Este es el código de Arduino que viene de la documentación
 * Se mantiene aquí como referencia y backup
 * 
 * Sistema de Control SILAR - Motores Stepper   
 * Control de ejes Y y Z con límites y home
 */

// Pines Eje Y
const int dirPinY = 2;
const int stepPinY = 3;
const int enablePinY = 4;
const int homePinY = 9;
const int limitMinY = 10;
const int limitMaxY = 11;

// Pines Eje Z
const int dirPinZ = 5;
const int stepPinZ = 6;
const int enablePinZ = 7;
const int homePinZ = 12;
const int limitMinZ = 13;
const int limitMaxZ = 8;

// Paro de emergencia
const int emergencyPin = 14;

// Variables de estado
int modo = 0; // 0=Manual, 1=Automatico
bool emergencyStop = false;
long posY = 0;
long posZ = 0;

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
  
  // Habilitar motores
  digitalWrite(enablePinY, LOW);
  digitalWrite(enablePinZ, LOW);
  
  Serial.println("Sistema SILAR Iniciado");
}

void loop() {
  // Verificar paro de emergencia
  if (digitalRead(emergencyPin) == LOW) {
    if (!emergencyStop) {
      emergencyStop = true;
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
  
  // Leer comandos del puerto serial
  if (Serial.available() > 0) {
    String comando = Serial.readStringUntil('\n');
    comando.trim();
    
    if (comando == "1") {
      modo = 0;
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
    else if (comando == "STATUS") {
      Serial.print("STATUS:");
      Serial.print("Mode=");
      Serial.print(modo == 0 ? "MANUAL" : "AUTOMATIC");
      Serial.print(",Emergency=");
      Serial.print(emergencyStop ? "1" : "0");
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
      Serial.println(digitalRead(limitMaxZ) == LOW ? "1" : "0");
    }
    else {
      Serial.print("Error: Comando desconocido: ");
      Serial.println(comando);
    }
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


