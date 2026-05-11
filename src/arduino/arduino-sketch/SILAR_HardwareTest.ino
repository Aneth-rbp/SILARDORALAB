#include <AccelStepper.h>
#include <ezButton.h>

/*
 * Prueba de Hardware SILAR - Eje Y (Versión Profesional con AccelStepper)
 *
 * Este sketch utiliza la librería AccelStepper (igual que el código real)
 * para asegurar rampas de aceleración y evitar que el motor se trabe por arranques bruscos.
 * Permite cambiar la polaridad del ENABLE por comando para depurar fallas de cableado.
 *
 * Hardware: Arduino Mega 2560 Rev3
 */

// Pines principales del eje Y - Según diagrama MOC-ELEC-001
const int stepPinY = 2;      // PUL+ (D2)
const int dirPinY = 3;       // DIR+ (D3)
const int enablePinY = 4;    // ENA+ (D4)
const int homePinY = 17;     // lsYi - Home/Límite mínimo Y (D17)
const int limitMinY = 17;    // lsYi
const int limitMaxY = 16;    // lsYf - Límite máximo Y (D16)

// Instancia de AccelStepper
AccelStepper stepperY(AccelStepper::DRIVER, stepPinY, dirPinY);

// Entradas con antiprebote
ezButton homeSwitchY(homePinY);
ezButton limitMinSwitchY(limitMinY);
ezButton limitMaxSwitchY(limitMaxY);

// Variables de configuración de depuración
bool enaActiveLevel = LOW;  // Por defecto LOW = Habilitado (Activo-LOW)
long pasosDePrueba = 1000;  // Cantidad de pasos a mover en pruebas FWD/REV
float velocidadMax = 800.0; // Velocidad máxima para la prueba (pasos/seg)
float aceleracion = 500.0;  // Aceleración (pasos/seg^2)

void imprimirEncabezado();
void imprimirEstado();
void moverEje(long pasos);
void actualizarEntradas();
String leerComando();

void setup() {
  Serial.begin(9600);

  pinMode(enablePinY, OUTPUT);
  pinMode(homePinY, INPUT_PULLUP);
  pinMode(limitMinY, INPUT_PULLUP);
  pinMode(limitMaxY, INPUT_PULLUP);

  // Configurar debounce de finales de carrera
  homeSwitchY.setDebounceTime(50);
  limitMinSwitchY.setDebounceTime(50);
  limitMaxSwitchY.setDebounceTime(50);

  // Inicializar AccelStepper
  stepperY.setMaxSpeed(velocidadMax);
  stepperY.setAcceleration(aceleracion);
  
  // Habilitar driver inicialmente según el nivel configurado
  digitalWrite(enablePinY, enaActiveLevel); 

  imprimirEncabezado();
  imprimirEstado();
}

void loop() {
  actualizarEntradas();

  if (Serial.available() > 0) {
    String comando = leerComando();

    if (comando == "FWD") {
      Serial.print("CMD:FWD -> Moviendo +");
      Serial.print(pasosDePrueba);
      Serial.println(" pasos con aceleracion...");
      moverEje(pasosDePrueba);
    } 
    else if (comando == "REV") {
      Serial.print("CMD:REV -> Moviendo -");
      Serial.print(pasosDePrueba);
      Serial.println(" pasos con aceleracion...");
      moverEje(-pasosDePrueba);
    } 
    else if (comando == "SET_LOW") {
      enaActiveLevel = LOW;
      digitalWrite(enablePinY, enaActiveLevel);
      Serial.println("CMD:SET_LOW -> Nivel activo ENA configurado en LOW (Estándar)");
      imprimirEstado();
    } 
    else if (comando == "SET_HIGH") {
      enaActiveLevel = HIGH;
      digitalWrite(enablePinY, enaActiveLevel);
      Serial.println("CMD:SET_HIGH -> Nivel activo ENA configurado en HIGH");
      imprimirEstado();
    } 
    else if (comando == "DISABLE") {
      // Deshabilitar es lo opuesto al nivel activo
      digitalWrite(enablePinY, !enaActiveLevel);
      Serial.println("CMD:DISABLE -> Driver deshabilitado temporalmente");
      imprimirEstado();
    } 
    else if (comando == "ENABLE") {
      // Habilitar es poner el nivel activo
      digitalWrite(enablePinY, enaActiveLevel);
      Serial.println("CMD:ENABLE -> Driver habilitado");
      imprimirEstado();
    } 
    else if (comando == "STATUS") {
      imprimirEstado();
    } 
    else if (comando.startsWith("SPEED:")) {
      float nuevaVel = comando.substring(6).toFloat();
      if (nuevaVel > 10 && nuevaVel <= 2000) {
        velocidadMax = nuevaVel;
        stepperY.setMaxSpeed(velocidadMax);
        Serial.print("CMD:SPEED -> Nueva velocidad maxima: ");
        Serial.println(velocidadMax);
      }
    }
    else {
      Serial.print("CMD:ERROR -> Comando desconocido: ");
      Serial.println(comando);
    }
  }
}

void imprimirEncabezado() {
  Serial.println("=================================================");
  Serial.println("  SILAR - TEST DE HARDWARE MEJORADO (CON ACCEL)");
  Serial.println("=================================================");
  Serial.println("  COMANDOS:");
  Serial.println("    FWD      -> Mover adelante (con rampa suave)");
  Serial.println("    REV      -> Mover atras (con rampa suave)");
  Serial.println("    SET_LOW  -> Cambiar ENA activo a LOW (Estándar)");
  Serial.println("    SET_HIGH -> Cambiar ENA activo a HIGH");
  Serial.println("    ENABLE   -> Activar driver");
  Serial.println("    DISABLE  -> Desactivar driver");
  Serial.println("    STATUS   -> Ver sensores y estado del driver");
  Serial.println("    SPEED:X  -> Cambiar velocidad (ej: SPEED:500)");
  Serial.println("=================================================\n");
}

void imprimirEstado() {
  Serial.print("ESTADO | Pin ENA(4)=");
  Serial.print(digitalRead(enablePinY) == HIGH ? "HIGH(5V)" : "LOW(0V)");
  Serial.print(" | Config ENA Activo=");
  Serial.print(enaActiveLevel == HIGH ? "HIGH" : "LOW");
  Serial.print(" | LS_HOME=");
  Serial.print(homeSwitchY.getState() == HIGH ? "ACTIVO" : "LIBRE");
  Serial.print(" LS_MAX=");
  Serial.println(limitMaxSwitchY.getState() == HIGH ? "ACTIVO" : "LIBRE");
}

void moverEje(long pasos) {
  // Aseguramos que esté habilitado el driver antes de mover
  digitalWrite(enablePinY, enaActiveLevel);
  delay(10); // pequeña pausa para estabilizar driver
  
  stepperY.move(pasos);

  while (stepperY.distanceToGo() != 0) {
    actualizarEntradas();

    // Validar límites según dirección del movimiento
    if (pasos > 0 && limitMaxSwitchY.getState() == HIGH) {
      Serial.println("STOP -> Limite MAX activado físicamente. Deteniendo!");
      stepperY.stop();
      break;
    }
    if (pasos < 0 && homeSwitchY.getState() == HIGH) {
      Serial.println("STOP -> Limite MIN/HOME activado físicamente. Deteniendo!");
      stepperY.stop();
      break;
    }

    stepperY.run();
  }

  // Sincronizar posición actual de la librería
  stepperY.setCurrentPosition(stepperY.currentPosition());
  Serial.println("MOVIMIENTO FINALIZADO");
  imprimirEstado();
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
