# 🌐 API Reference - Arduino SILAR

Documentación completa de la API REST y WebSocket para control del Arduino.

## 📋 Tabla de Contenidos

- [API REST](#api-rest)
  - [Gestión de Puertos](#gestión-de-puertos)
  - [Conexión](#conexión)
  - [Estado](#estado)
  - [Comandos](#comandos)
  - [Flash](#flash)
- [WebSocket Events](#websocket-events)
- [Node.js API](#nodejs-api)
- [Ejemplos](#ejemplos)
- [Errores Comunes](#errores-comunes)

## 🌐 API REST

Base URL: `http://localhost:3000/api/arduino`

### Gestión de Puertos

#### GET `/api/arduino/ports`

Lista todos los puertos seriales disponibles.

**Request:**
```bash
curl http://localhost:3000/api/arduino/ports
```

**Response:**
```json
{
  "success": true,
  "ports": [
    {
      "path": "COM3",
      "manufacturer": "Arduino LLC",
      "serialNumber": "95735343336351F0C121",
      "vendorId": "2341",
      "productId": "0043"
    }
  ]
}
```

### Conexión

#### POST `/api/arduino/connect`

Conecta con el Arduino en un puerto específico.

**Request:**
```bash
curl -X POST http://localhost:3000/api/arduino/connect \
  -H "Content-Type: application/json" \
  -d '{
    "port": "COM3",
    "baudRate": 9600
  }'
```

**Parameters:**
- `port` (string, optional): Puerto serial. Si no se especifica, detecta automáticamente.
- `baudRate` (number, optional): Velocidad de comunicación. Default: 9600.

**Response:**
```json
{
  "success": true,
  "message": "Arduino conectado exitosamente",
  "state": {
    "mode": "UNKNOWN",
    "axisY": { "position": 0, "moving": false, "atHome": false, "atLimit": false },
    "axisZ": { "position": 0, "moving": false, "atHome": false, "atLimit": false },
    "emergencyStop": false,
    "isConnected": true,
    "port": "COM3"
  }
}
```

#### POST `/api/arduino/disconnect`

Desconecta del Arduino.

**Request:**
```bash
curl -X POST http://localhost:3000/api/arduino/disconnect
```

**Response:**
```json
{
  "success": true,
  "message": "Arduino desconectado"
}
```

### Estado

#### GET `/api/arduino/state`

Obtiene el estado actual del Arduino.

**Request:**
```bash
curl http://localhost:3000/api/arduino/state
```

**Response:**
```json
{
  "success": true,
  "state": {
    "mode": "MANUAL",
    "axisY": {
      "position": 1500,
      "moving": false,
      "atHome": false,
      "atLimit": false
    },
    "axisZ": {
      "position": 500,
      "moving": false,
      "atHome": true,
      "atLimit": false
    },
    "emergencyStop": false,
    "lastUpdate": "2024-10-12T18:30:45.123Z",
    "isConnected": true,
    "port": "COM3"
  }
}
```

### Comandos

#### POST `/api/arduino/command`

Envía un comando al Arduino.

**Modo Manual:**
```bash
curl -X POST http://localhost:3000/api/arduino/command \
  -H "Content-Type: application/json" \
  -d '{"command": "MODE_MANUAL"}'
```

**Modo Automático:**
```bash
curl -X POST http://localhost:3000/api/arduino/command \
  -H "Content-Type: application/json" \
  -d '{"command": "MODE_AUTOMATIC"}'
```

**HOME:**
```bash
curl -X POST http://localhost:3000/api/arduino/command \
  -H "Content-Type: application/json" \
  -d '{"command": "HOME"}'
```

**Mover Eje Y:**
```bash
curl -X POST http://localhost:3000/api/arduino/command \
  -H "Content-Type: application/json" \
  -d '{
    "command": "MOVE_Y",
    "params": {"steps": 1000}
  }'
```

**Mover Eje Z:**
```bash
curl -X POST http://localhost:3000/api/arduino/command \
  -H "Content-Type: application/json" \
  -d '{
    "command": "MOVE_Z",
    "params": {"steps": -500}
  }'
```

**Paro de Emergencia:**
```bash
curl -X POST http://localhost:3000/api/arduino/command \
  -H "Content-Type: application/json" \
  -d '{"command": "STOP"}'
```

**Comandos Disponibles:**

| Comando | Parámetros | Descripción |
|---------|------------|-------------|
| `MODE_MANUAL` | - | Cambiar a modo manual |
| `MODE_AUTOMATIC` | - | Cambiar a modo automático |
| `HOME` | - | Ejecutar secuencia HOME |
| `MOVE_Y` | `steps` (number) | Mover eje Y (+ adelante, - atrás) |
| `MOVE_Z` | `steps` (number) | Mover eje Z (+ arriba, - abajo) |
| `STOP` | - | Paro de emergencia |

**Response:**
```json
{
  "success": true,
  "message": "Comando ejecutado",
  "result": {
    "success": true,
    "command": "Y1000"
  }
}
```

### Flash

#### GET `/api/arduino/flash/info`

Obtiene información del sistema de flash.

**Request:**
```bash
curl http://localhost:3000/api/arduino/flash/info
```

**Response:**
```json
{
  "success": true,
  "flashSystem": {
    "arduinoCliInstalled": true,
    "arduinoCliPath": "C:\\Users\\...\\Arduino-CLI\\arduino-cli.exe",
    "arduinoDetected": true,
    "arduinoInfo": {
      "port": "COM3",
      "type": "uno",
      "name": "Arduino Uno"
    },
    "sketchPath": "C:\\...\\src\\arduino\\arduino-sketch",
    "sketchExists": true
  }
}
```

#### POST `/api/arduino/flash`

Flashea el firmware del Arduino automáticamente.

**Request:**
```bash
curl -X POST http://localhost:3000/api/arduino/flash \
  -H "Content-Type: application/json" \
  -d '{
    "port": "COM3",
    "boardType": "arduino:avr:uno"
  }'
```

**Parameters:**
- `port` (string, optional): Puerto. Si no se especifica, detecta automáticamente.
- `boardType` (string, optional): Tipo de board. Default: `arduino:avr:uno`.

**Response:**
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

#### GET `/api/arduino/flash/verify?port=COM3`

Verifica si el Arduino tiene el firmware correcto.

**Request:**
```bash
curl "http://localhost:3000/api/arduino/flash/verify?port=COM3"
```

**Response:**
```json
{
  "success": true,
  "hasCorrectFirmware": true,
  "message": "El Arduino tiene el firmware correcto"
}
```

## 🔌 WebSocket Events

Conéctate a Socket.IO para recibir actualizaciones en tiempo real.

**Conexión:**
```javascript
const socket = io('http://localhost:3000');
```

### Enviar Comando

```javascript
socket.emit('arduino-command', {
  command: 'MOVE_Y',
  params: { steps: 1000 }
});
```

### Recibir Eventos

#### `arduino-state`

Estado completo del Arduino (se envía al conectar y cada vez que cambia).

```javascript
socket.on('arduino-state', (state) => {
  console.log('Estado:', state);
  // {
  //   mode: 'MANUAL',
  //   axisY: { position: 1500, ... },
  //   axisZ: { position: 500, ... },
  //   emergencyStop: false,
  //   isConnected: true,
  //   port: 'COM3'
  // }
});
```

#### `arduino-data`

Datos parseados recibidos del Arduino.

```javascript
socket.on('arduino-data', (parsed) => {
  console.log('Datos:', parsed);
  
  switch(parsed.type) {
    case 'mode':
      // { type: 'mode', mode: 'MANUAL', message: '...', timestamp: '...' }
      break;
    case 'position':
      // { type: 'position', axis: 'Y', position: 1500, ... }
      break;
    case 'home':
      // { type: 'home', axis: 'Y', complete: true, ... }
      break;
    case 'limit':
      // { type: 'limit', axis: 'Y', limit: 'MIN', ... }
      break;
    case 'emergency':
      // { type: 'emergency', active: true, ... }
      break;
  }
});
```

#### `arduino-connected`

Arduino conectado exitosamente.

```javascript
socket.on('arduino-connected', (data) => {
  console.log('Conectado en:', data.port);
});
```

#### `arduino-disconnected`

Arduino desconectado.

```javascript
socket.on('arduino-disconnected', () => {
  console.log('Arduino desconectado');
});
```

#### `arduino-error`

Error del Arduino.

```javascript
socket.on('arduino-error', (error) => {
  console.error('Error:', error.error || error.message);
});
```

#### `arduino-command-result`

Resultado de un comando enviado.

```javascript
socket.on('arduino-command-result', (result) => {
  console.log('Comando completado:', result);
});
```

## 💻 Node.js API

Para uso directo desde Node.js:

```javascript
const { getInstance } = require('./src/arduino/ArduinoController');

async function example() {
  const arduino = getInstance();
  
  // Conectar
  await arduino.connect('COM3');
  
  // Escuchar eventos
  arduino.on('data', (parsed) => {
    console.log('Arduino:', parsed);
  });
  
  arduino.on('state-changed', (state) => {
    console.log('Nuevo estado:', state);
  });
  
  // Enviar comandos
  await arduino.setModeManual();
  await arduino.executeHome();
  await arduino.moveAxisY(1000);
  await arduino.moveAxisZ(500);
  
  // Obtener estado
  const state = arduino.getState();
  console.log('Estado actual:', state);
  
  // Desconectar
  await arduino.disconnect();
}

example();
```

## 📚 Ejemplos

### Ejemplo Completo (Frontend)

```html
<!DOCTYPE html>
<html>
<head>
  <script src="/socket.io/socket.io.js"></script>
</head>
<body>
  <button id="connect">Conectar</button>
  <button id="home">HOME</button>
  <button id="moveY">Mover Y+</button>
  <div id="status"></div>
  
  <script>
    const socket = io();
    const status = document.getElementById('status');
    
    // Escuchar estado
    socket.on('arduino-state', (state) => {
      status.innerHTML = `
        Conectado: ${state.isConnected}<br>
        Modo: ${state.mode}<br>
        Y: ${state.axisY.position}<br>
        Z: ${state.axisZ.position}
      `;
    });
    
    // Escuchar datos
    socket.on('arduino-data', (data) => {
      console.log('Arduino:', data);
      if (data.type === 'home' && data.complete) {
        alert('HOME completado!');
      }
    });
    
    // Conectar
    document.getElementById('connect').onclick = async () => {
      const response = await fetch('/api/arduino/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();
      console.log(result);
    };
    
    // HOME
    document.getElementById('home').onclick = () => {
      socket.emit('arduino-command', { command: 'HOME' });
    };
    
    // Mover Y
    document.getElementById('moveY').onclick = () => {
      socket.emit('arduino-command', {
        command: 'MOVE_Y',
        params: { steps: 1000 }
      });
    };
  </script>
</body>
</html>
```

### Ejemplo: Secuencia Automática

```javascript
async function executeSequence() {
  const socket = io();
  
  const sequence = [
    { command: 'MODE_AUTOMATIC' },
    { command: 'HOME' },
    { command: 'MOVE_Y', params: { steps: 1000 }, wait: 3000 },
    { command: 'MOVE_Z', params: { steps: 500 }, wait: 2000 },
    { command: 'MOVE_Y', params: { steps: -500 }, wait: 2000 },
    { command: 'MOVE_Z', params: { steps: -500 }, wait: 2000 },
    { command: 'HOME' }
  ];
  
  for (const step of sequence) {
    console.log('Ejecutando:', step.command);
    socket.emit('arduino-command', step);
    
    if (step.wait) {
      await new Promise(resolve => setTimeout(resolve, step.wait));
    }
  }
  
  console.log('Secuencia completada');
}
```

## ❌ Errores Comunes

### Error 401: Unauthorized

Algunos endpoints requieren autenticación. Incluye el token en el header:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/arduino/ports
```

### Error 400: Bad Request

- **Comando desconocido**: Verifica que el comando sea válido
- **Parámetros faltantes**: `MOVE_Y` y `MOVE_Z` requieren `params.steps`

```json
{
  "success": false,
  "error": "Parámetro steps requerido para MOVE_Y"
}
```

### Error 500: Internal Server Error

- **Arduino no conectado**: Conecta primero con `/api/arduino/connect`
- **Puerto en uso**: Cierra otros programas que usen el puerto serial
- **Arduino no responde**: Verifica el cable USB y el firmware

### WebSocket no conecta

```javascript
// Verificar que Socket.IO esté cargado
if (typeof io === 'undefined') {
  console.error('Socket.IO no está cargado');
}

// Manejar errores de conexión
socket.on('connect_error', (error) => {
  console.error('Error de conexión:', error);
});
```

## 📞 Soporte

- **Logs**: `logs/silar-system.log`
- **Estado del sistema**: `GET /api/system/status`
- **Documentación completa**: [docs/arduino/README.md](../arduino/README.md)

---

*API Version 2.0.0 - Sistema SILAR - DORA Lab*


