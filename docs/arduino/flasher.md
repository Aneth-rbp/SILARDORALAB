# Sistema de Flash Automático - Arduino SILAR

## 🎯 Descripción

Este sistema permite **flashear automáticamente el firmware de Arduino** desde la aplicación, sin necesidad de Arduino IDE. El código del Arduino se incluye en el empaquetado y se puede instalar automáticamente.

## ✨ Características

- ✅ **Flash Automático**: Instala el firmware con un clic
- ✅ **Detección Automática**: Detecta el Arduino conectado
- ✅ **Verificación de Firmware**: Verifica si ya tiene el firmware correcto
- ✅ **Arduino CLI Integrado**: Descarga e instala arduino-cli automáticamente
- ✅ **Soporte Multi-Board**: Funciona con Uno, Mega, Nano, etc.
- ✅ **API REST + CLI**: Flashear desde la web o línea de comandos

## 📦 Dependencias

El sistema descarga e instala automáticamente:
- **Arduino CLI**: Herramienta oficial de Arduino para compilar y flashear

No necesitas tener Arduino IDE instalado.

## 🚀 Uso

### Opción 1: Desde la Interfaz Web

```javascript
// Verificar estado del sistema de flash
fetch('/api/arduino/flash/info')
  .then(r => r.json())
  .then(console.log);

// Flashear Arduino (detecta automáticamente)
fetch('/api/arduino/flash', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
}).then(r => r.json()).then(console.log);

// Flashear en puerto específico
fetch('/api/arduino/flash', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    port: 'COM3',
    boardType: 'arduino:avr:uno'
  })
}).then(r => r.json()).then(console.log);
```

### Opción 2: Desde Línea de Comandos

```bash
# Flash automático (detecta puerto y board)
node src/arduino/flasher/flash-arduino.js

# Especificar puerto
node src/arduino/flasher/flash-arduino.js COM3

# Especificar puerto y tipo de board
node src/arduino/flasher/flash-arduino.js COM3 arduino:avr:mega
```

### Opción 3: Desde Node.js

```javascript
const { getInstance } = require('./src/arduino/flasher/ArduinoFlasher');

async function flashMyArduino() {
  const flasher = getInstance();
  
  // Flash automático
  const result = await flasher.flashArduino();
  
  if (result.success) {
    console.log('✓ Flasheado exitosamente');
    console.log('Puerto:', result.port);
    console.log('Board:', result.boardType);
  }
}

flashMyArduino();
```

## 📋 Tipos de Board Soportados

| Board | FQBN |
|-------|------|
| Arduino Uno | `arduino:avr:uno` |
| Arduino Mega 2560 | `arduino:avr:mega` |
| Arduino Nano | `arduino:avr:nano` |
| Arduino Leonardo | `arduino:avr:leonardo` |
| Arduino Micro | `arduino:avr:micro` |

## 🔄 Proceso de Flash

El sistema ejecuta estos pasos automáticamente:

1. **Verificar Arduino CLI**
   - Si no está instalado, lo descarga e instala automáticamente
   - Inicializa los cores necesarios

2. **Detectar Arduino**
   - Escanea puertos USB
   - Identifica el tipo de board

3. **Verificar Firmware Actual**
   - Se conecta al Arduino
   - Verifica si ya tiene el firmware correcto
   - Si ya lo tiene, termina aquí ✓

4. **Compilar Sketch**
   - Compila `SILAR_Control.ino`
   - Genera el archivo `.hex`

5. **Flashear Arduino**
   - Sube el firmware al Arduino
   - Espera que reinicie

6. **Verificar Instalación**
   - Se reconecta al Arduino
   - Verifica que responda correctamente

## 🛠️ API REST

### GET `/api/arduino/flash/info`

Obtiene información del sistema de flash.

**Respuesta:**
```json
{
  "success": true,
  "flashSystem": {
    "arduinoCliInstalled": true,
    "arduinoCliPath": "C:\\Users\\...\\arduino-cli.exe",
    "arduinoDetected": true,
    "arduinoInfo": {
      "port": "COM3",
      "type": "uno",
      "name": "Arduino Uno"
    },
    "sketchPath": "C:\\...\\arduino-sketch",
    "sketchExists": true
  }
}
```

### POST `/api/arduino/flash`

Flashea el Arduino.

**Body:**
```json
{
  "port": "COM3",              // Opcional, detecta automáticamente
  "boardType": "arduino:avr:uno"  // Opcional, default: uno
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Firmware instalado exitosamente",
  "result": {
    "success": true,
    "alreadyInstalled": false,
    "port": "COM3",
    "boardType": "arduino:avr:uno",
    "verified": true
  }
}
```

### GET `/api/arduino/flash/verify?port=COM3`

Verifica si el Arduino tiene el firmware correcto.

**Respuesta:**
```json
{
  "success": true,
  "hasCorrectFirmware": true,
  "message": "El Arduino tiene el firmware correcto"
}
```

## 🎨 Integrar en el Frontend

```javascript
// En tu pantalla de configuración o setup

class SetupScreen {
  async checkAndFlashArduino() {
    try {
      // 1. Verificar sistema
      const info = await fetch('/api/arduino/flash/info')
        .then(r => r.json());
      
      if (!info.flashSystem.arduinoDetected) {
        alert('No se detectó ningún Arduino. Conecta uno e intenta de nuevo.');
        return;
      }
      
      // 2. Verificar firmware
      const port = info.flashSystem.arduinoInfo.port;
      const verify = await fetch(`/api/arduino/flash/verify?port=${port}`)
        .then(r => r.json());
      
      if (verify.hasCorrectFirmware) {
        alert('✓ El Arduino ya tiene el firmware correcto');
        return;
      }
      
      // 3. Flashear
      if (confirm('El Arduino necesita ser flasheado. ¿Continuar?')) {
        this.showLoading('Flasheando Arduino...');
        
        const result = await fetch('/api/arduino/flash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port })
        }).then(r => r.json());
        
        this.hideLoading();
        
        if (result.success) {
          alert('✓ Arduino flasheado exitosamente');
          // Conectar automáticamente
          this.connectArduino(port);
        }
      }
      
    } catch (error) {
      alert('Error: ' + error.message);
    }
  }
}
```

## 📦 En el Empaquetado

Cuando empaquetes la aplicación con `electron-builder` o similar:

1. ✅ El sketch de Arduino se incluye automáticamente
2. ✅ Arduino CLI se descarga la primera vez que se necesita
3. ✅ Todo funciona offline después de la primera vez
4. ✅ Los usuarios finales no necesitan Arduino IDE

## 🔍 Solución de Problemas

### Arduino CLI no se instala

**Manual:**
1. Descarga desde: https://arduino.github.io/arduino-cli/
2. Extrae en: `%LOCALAPPDATA%\Arduino-CLI\`
3. Añade al PATH o especifica la ruta

**O ejecuta:**
```bash
.\src\arduino\flasher\install-arduino-cli.bat
```

### Error: "Cannot access port"

- Cierra Arduino IDE si está abierto
- Cierra el Monitor Serial
- Verifica que nadie más use el puerto

### Error: "Board not found"

Intenta especificar el tipo de board manualmente:
```bash
node src/arduino/flasher/flash-arduino.js COM3 arduino:avr:mega
```

### Firmware no se verifica después de flash

Es normal, algunos Arduinos tardan más en reiniciar. El firmware está instalado correctamente aunque la verificación falle.

## 💡 Tips

1. **Primera vez**: Puede tardar 2-3 minutos (descarga Arduino CLI + cores)
2. **Siguientes veces**: < 30 segundos
3. **Sin conexión**: Funciona offline después de la primera instalación
4. **Múltiples Arduinos**: Flashea uno a la vez
5. **Desarrollo**: El Arduino puede estar conectado mientras desarrollas

## 🚀 Workflow Recomendado

### Para el Usuario Final:

```
1. Usuario abre la aplicación por primera vez
2. Sistema detecta: "Arduino sin firmware o incorrecto"
3. Muestra diálogo: "¿Instalar firmware de Arduino?"
4. Click en "Sí"
5. Sistema flashea automáticamente
6. ✓ Listo para usar
```

### Para Desarrollo:

```bash
# Una sola vez al configurar
node src/arduino/flasher/flash-arduino.js

# Luego trabajar normalmente
npm run dev
```

## 📝 Archivos Importantes

```
src/arduino/flasher/
├── ArduinoFlasher.js        # Clase principal
├── flash-arduino.js         # CLI tool
├── install-arduino-cli.bat  # Instalador Windows
└── README.md                # Esta documentación

src/arduino/arduino-sketch/
└── SILAR_Control.ino        # Firmware del Arduino
```

## 🔗 Links Útiles

- [Arduino CLI Docs](https://arduino.github.io/arduino-cli/)
- [Board FQBN List](https://github.com/arduino/arduino-cli/blob/master/docs/platform-specification.md)
- [SerialPort Node.js](https://serialport.io/)

