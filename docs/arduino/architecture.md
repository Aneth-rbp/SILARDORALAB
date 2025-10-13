# 🏗️ Arquitectura del Sistema de Integración Arduino

## 📊 Diagrama General

```
┌─────────────────────────────────────────────────────────────────┐
│                    APLICACIÓN SILAR (Node.js/Electron)          │
│                                                                  │
│  ┌──────────────┐    ┌───────────────┐    ┌─────────────────┐ │
│  │   Frontend   │    │  Express API  │    │  Socket.IO      │ │
│  │  (Web UI)    │◄──►│  (REST)       │◄──►│  (WebSocket)    │ │
│  └──────┬───────┘    └───────┬───────┘    └────────┬────────┘ │
│         │                    │                      │           │
│         └────────────────────┼──────────────────────┘           │
│                              │                                  │
│         ┌────────────────────▼────────────────────┐            │
│         │     ArduinoController (Singleton)       │            │
│         │  • Conexión Serial                      │            │
│         │  • Envío de comandos                    │            │
│         │  • Recepción de datos                   │            │
│         │  • Gestión de estado                    │            │
│         │  • Event Emitter                        │            │
│         └────────┬─────────────────┬──────────────┘            │
│                  │                 │                            │
│     ┌────────────▼──────┐    ┌────▼──────────────┐            │
│     │   ResponseParser  │    │  ArduinoFlasher   │            │
│     │  • Parsea datos   │    │  • Flash auto     │            │
│     │  • Valida         │    │  • Verifica FW    │            │
│     └───────────────────┘    │  • Arduino CLI    │            │
│                              └────┬──────────────┘             │
│                                   │                            │
└───────────────────────────────────┼────────────────────────────┘
                                    │
                      ┌─────────────▼──────────────┐
                      │   Comunicación Serial      │
                      │   (USB - 9600 baud)        │
                      └─────────────┬──────────────┘
                                    │
                      ┌─────────────▼──────────────┐
                      │      ARDUINO UNO/MEGA      │
                      │   (SILAR_Control.ino)      │
                      │                            │
                      │  • Control Eje Y           │
                      │  • Control Eje Z           │
                      │  • Sensores HOME           │
                      │  • Límites de carrera      │
                      │  • Paro de emergencia      │
                      └────────────────────────────┘
```

## 🔄 Flujo de Comunicación

### 1. Envío de Comando desde Frontend

```
Usuario hace clic en botón "Mover Y+"
         │
         ▼
┌────────────────────┐
│  Frontend JS       │  socket.emit('arduino-command', {
│  (manual.js)       │    command: 'MOVE_Y',
│                    │    params: { steps: 1000 }
│                    │  });
└────────┬───────────┘
         │ WebSocket
         ▼
┌────────────────────┐
│  Socket Handler    │  Recibe comando
│  (server.js)       │  └─> switch(command)
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ ArduinoController  │  arduino.moveAxisY(1000)
│                    │  └─> sendCommand('Y1000\n')
└────────┬───────────┘
         │ Serial USB
         ▼
┌────────────────────┐
│  Arduino           │  Serial.readStringUntil('\n')
│  SILAR_Control     │  └─> moverEjeY(1000)
│                    │  └─> Serial.println("Y: 1500")
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ ArduinoController  │  Recibe "Y: 1500"
│ ResponseParser     │  └─> Parsea: {type:'position', axis:'Y', position:1500}
└────────┬───────────┘
         │ Event Emitter
         ▼
┌────────────────────┐
│  Socket.IO         │  io.emit('arduino-data', parsed)
└────────┬───────────┘
         │ WebSocket
         ▼
┌────────────────────┐
│  Frontend          │  socket.on('arduino-data')
│                    │  └─> Actualiza UI
└────────────────────┘
```

## 🎯 Flujo de Flash Automático

```
Usuario hace clic "Flashear Arduino"
         │
         ▼
┌────────────────────────┐
│  Frontend              │  POST /api/arduino/flash
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│  API Handler           │  flashArduino(req, res)
│  (server.js)           │  └─> getFlasherInstance()
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│  ArduinoFlasher        │
│  ┌──────────────────┐  │
│  │ 1. checkArduinoCli│  │  ¿Arduino CLI instalado?
│  │    Si no → instala│  │
│  └──────────┬─────────  │
│  │          │         │
│  │ 2. detectArduino │  │  Detecta puerto COM
│  │    └─> COM3      │  │
│  │          │         │
│  │ 3. verifyFirmware│  │  ¿Ya tiene el FW correcto?
│  │    └─> No        │  │
│  │          │         │
│  │ 4. compileSketch │  │  arduino-cli compile
│  │    └─> ✓ OK      │  │
│  │          │         │
│  │ 5. uploadSketch  │  │  arduino-cli upload
│  │    └─> ✓ OK      │  │
│  │          │         │
│  │ 6. verifyFirmware│  │  Verificar que funcionó
│  │    └─> ✓ OK      │  │
│  └──────────┬─────────  │
└─────────────┼───────────┘
              │
              ▼
┌─────────────────────────┐
│  Arduino                │  Tiene el firmware correcto
│  "Sistema SILAR Iniciado"│
└─────────────────────────┘
              │
              ▼
┌─────────────────────────┐
│  API Response           │  { success: true, ... }
└─────────────────────────┘
```

## 📦 Componentes del Sistema

### ArduinoController.js

```javascript
class ArduinoController extends EventEmitter {
  • connect(port, baudRate)
  • disconnect()
  • sendCommand(command)
  
  Comandos específicos:
  • setModeManual()
  • setModeAutomatic()
  • executeHome()
  • moveAxisY(steps)
  • moveAxisZ(steps)
  • emergencyStop()
  
  Estado:
  • currentState { mode, axisY, axisZ, emergency }
  • getState()
  
  Eventos:
  • 'connected'
  • 'disconnected'
  • 'data' (parsed)
  • 'state-changed'
  • 'error'
}
```

### ResponseParser.js

```javascript
class ResponseParser {
  static parse(line) {
    // "Modo Manual" → {type:'mode', mode:'MANUAL'}
    // "Y: 1500" → {type:'position', axis:'Y', position:1500}
    // "Home Y encontrado" → {type:'home', axis:'Y', complete:true}
    // "Limite Y alcanzado" → {type:'limit', axis:'Y'}
    // "PARO DE EMERGENCIA" → {type:'emergency', active:true}
  }
}
```

### ArduinoFlasher.js

```javascript
class ArduinoFlasher {
  • flashArduino(port, boardType)
  • checkArduinoCli()
  • installArduinoCli()
  • detectArduino()
  • compileSketch()
  • uploadSketch()
  • verifyFirmware()
  • getFlashSystemInfo()
}
```

## 🔌 Protocolo Serial

### Comandos PC → Arduino

| Comando | Envío | Arduino Recibe | Acción |
|---------|-------|----------------|--------|
| Modo Manual | `"1\n"` | `comando == "1"` | `modo = 0` |
| Modo Automático | `"2\n"` | `comando == "2"` | `modo = 1` |
| HOME | `"3\n"` | `comando == "3"` | `ejecutarHome()` |
| Mover Y | `"Y1000\n"` | `comando.startsWith("Y")` | `moverEjeY(1000)` |
| Mover Z | `"Z500\n"` | `comando.startsWith("Z")` | `moverEjeZ(500)` |

### Respuestas Arduino → PC

| Respuesta | Parser | Resultado |
|-----------|--------|-----------|
| `"Modo Manual"` | `parseMode()` | `{type:'mode', mode:'MANUAL'}` |
| `"Buscando Home Y"` | `parseHome()` | `{type:'home', axis:'Y', status:'searching'}` |
| `"Home Y encontrado"` | `parseHome()` | `{type:'home', axis:'Y', complete:true}` |
| `"Y: 1500"` | `parsePosition()` | `{type:'position', axis:'Y', position:1500}` |
| `"Limite Y alcanzado"` | `parseLimit()` | `{type:'limit', axis:'Y'}` |

## 🌐 Endpoints API REST

```
GET  /api/arduino/ports
     → Lista puertos disponibles
     ← { success: true, ports: [...] }

POST /api/arduino/connect
     → { port: "COM3", baudRate: 9600 }
     ← { success: true, state: {...} }

POST /api/arduino/command
     → { command: "HOME" }
     → { command: "MOVE_Y", params: { steps: 1000 } }
     ← { success: true, result: {...} }

POST /api/arduino/flash
     → { port: "COM3", boardType: "arduino:avr:uno" }
     ← { success: true, result: {...} }

GET  /api/arduino/flash/info
     ← { arduinoCliInstalled, arduinoDetected, ... }

GET  /api/arduino/flash/verify?port=COM3
     ← { hasCorrectFirmware: true }
```

## 🔧 Eventos WebSocket

```javascript
// Cliente → Servidor
socket.emit('arduino-command', { command, params })

// Servidor → Cliente
socket.on('arduino-data', (parsed) => ...)
socket.on('arduino-state', (state) => ...)
socket.on('arduino-connected', (info) => ...)
socket.on('arduino-disconnected', () => ...)
socket.on('arduino-error', (error) => ...)
socket.on('arduino-command-result', (result) => ...)
```

## 🎨 Integración Frontend

```
┌─────────────────────────────────────────────┐
│  Control Manual Screen (manual.js)          │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  Estado: Conectado | Modo: MANUAL     │ │
│  │  Y: 1500 | Z: 500                     │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌──────────┐  ┌──────────┐                │
│  │  Modo    │  │  Modo    │                │
│  │  Manual  │  │Automático│                │
│  └────┬─────┘  └────┬─────┘                │
│       │             │                        │
│       └──socket.emit('arduino-command')     │
│                                              │
│  ┌──────────┐                               │
│  │   HOME   │─┐                             │
│  └──────────┘ │                             │
│               └──socket.emit('HOME')        │
│                                              │
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐           │
│  │ Y+ │  │ Y- │  │ Z+ │  │ Z- │           │
│  └─┬──┘  └─┬──┘  └─┬──┘  └─┬──┘           │
│    └───socket.emit('MOVE_Y', {steps})      │
│                                              │
│  socket.on('arduino-data') → Update UI      │
│  socket.on('arduino-state') → Update badges │
└─────────────────────────────────────────────┘
```

## 📊 Estado del Sistema

```javascript
currentState = {
  mode: 'MANUAL' | 'AUTOMATIC' | 'UNKNOWN',
  
  axisY: {
    position: 1500,        // Pasos desde HOME
    moving: false,         // ¿Está en movimiento?
    atHome: false,         // ¿En posición HOME?
    atLimit: false         // ¿En límite de carrera?
  },
  
  axisZ: {
    position: 500,
    moving: false,
    atHome: false,
    atLimit: false
  },
  
  emergencyStop: false,    // ¿Paro activado?
  lastUpdate: Date,        // Última actualización
  isConnected: true,       // ¿Conectado?
  port: 'COM3'            // Puerto usado
}
```

## 🔄 Ciclo de Vida

```
1. Aplicación inicia
   └─> server.js: new SilarWebServer()
       └─> ArduinoController.getInstance()
           └─> Intenta conectar automáticamente

2. Usuario abre frontend
   └─> Socket.IO connect
       └─> Recibe estado actual: 'arduino-state'

3. Usuario hace clic en botón
   └─> socket.emit('arduino-command')
       └─> Server recibe comando
           └─> ArduinoController.sendCommand()
               └─> Arduino recibe y ejecuta
                   └─> Arduino responde
                       └─> Parser interpreta
                           └─> Event 'data' emitido
                               └─> WebSocket broadcast
                                   └─> Frontend actualiza UI

4. Arduino se desconecta
   └─> Event 'disconnected'
       └─> WebSocket broadcast
           └─> Frontend muestra "Desconectado"
       └─> Intenta reconectar cada 10s

5. Aplicación cierra
   └─> arduino.disconnect()
       └─> Puerto serial cerrado
```

## 🎯 Resumen

- **Arquitectura Modular**: Cada componente tiene una responsabilidad clara
- **Singleton Pattern**: Una sola instancia del controlador
- **Event-Driven**: Comunicación asíncrona mediante eventos
- **Real-Time**: WebSocket para actualizaciones instantáneas
- **Auto-Recuperación**: Reconexión automática si se pierde conexión
- **Validación**: Datos parseados y validados en cada paso
- **Logging**: Todos los eventos registrados para debugging
- **Escalable**: Fácil añadir nuevos comandos o funcionalidades

---

*Sistema diseñado con las mejores prácticas de arquitectura de software*

