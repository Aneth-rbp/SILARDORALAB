# Módulo de Integración Arduino - Sistema SILAR

## Descripción

Este módulo proporciona una capa de comunicación robusta entre el sistema SILAR (Node.js/Electron) y el Arduino que controla los motores stepper del sistema.

## Arquitectura

```
src/arduino/
├── ArduinoController.js    # Controlador principal (Singleton)
├── commands.js              # Definiciones de comandos y respuestas
├── parser.js                # Parser de respuestas del Arduino
├── arduino-sketch/          # Código Arduino original (NO MODIFICAR)
│   └── SILAR_Control.ino
└── README.md               # Esta documentación
```

## Características

- ✅ **Comunicación Serial Bidireccional**: Envío de comandos y recepción de respuestas
- ✅ **Detección Automática de Puerto**: Busca y conecta automáticamente al Arduino
- ✅ **Reconexión Automática**: Detecta desconexiones y reconecta automáticamente
- ✅ **Patrón Singleton**: Una única instancia para evitar conflictos
- ✅ **Event Emitters**: Sistema de eventos para respuestas en tiempo real
- ✅ **Estado Sincronizado**: Mantiene el estado actual del Arduino
- ✅ **Parser Robusto**: Interpreta todas las respuestas del Arduino
- ✅ **Logging Completo**: Todos los eventos quedan registrados

## Protocolo de Comunicación

### Comandos del PC al Arduino

| Comando | Descripción | Ejemplo |
|---------|-------------|---------|
| `1` | Cambiar a modo Manual | `1\n` |
| `2` | Cambiar a modo Automático | `2\n` |
| `3` | Ejecutar secuencia HOME | `3\n` |
| `Y<pasos>` | Mover eje Y | `Y1000\n` (1000 pasos adelante)<br>`Y-500\n` (500 pasos atrás) |
| `Z<pasos>` | Mover eje Z | `Z500\n` (500 pasos adelante)<br>`Z-200\n` (200 pasos atrás) |

### Respuestas del Arduino al PC

| Mensaje | Significado |
|---------|-------------|
| `Modo Manual` | Confirmación de cambio a modo manual |
| `Modo Automatico` | Confirmación de cambio a modo automático |
| `Buscando Home Y` | Iniciando búsqueda de home en eje Y |
| `Home Y encontrado` | Home del eje Y encontrado |
| `Buscando Home Z` | Iniciando búsqueda de home en eje Z |
| `Home Z encontrado` | Home del eje Z encontrado |
| `Secuencia HOME completada` | Proceso HOME finalizado |
| `Y: <posición>` | Posición actual del eje Y |
| `Z: <posición>` | Posición actual del eje Z |
| `Limite Y alcanzado` | Se alcanzó un límite en el eje Y |
| `Limite Z alcanzado` | Se alcanzó un límite en el eje Z |
| `PARO DE EMERGENCIA ACTIVADO` | Paro de emergencia presionado |
| `Paro de emergencia desactivado` | Paro de emergencia liberado |

## Uso en el Código

### 1. Obtener la Instancia del Controlador

```javascript
const { getInstance } = require('./arduino/ArduinoController');
const arduinoController = getInstance();
```

### 2. Conectar con el Arduino

```javascript
// Conexión automática (detecta el puerto)
await arduinoController.connect();

// O especificar puerto manualmente
await arduinoController.connect('COM3'); // Windows
await arduinoController.connect('/dev/ttyUSB0'); // Linux
await arduinoController.connect('/dev/cu.usbserial-1410'); // macOS
```

### 3. Escuchar Eventos

```javascript
// Conectado
arduinoController.on('connected', (data) => {
    console.log('Arduino conectado en:', data.port);
});

// Datos recibidos (parseados)
arduinoController.on('data', (parsed) => {
    console.log('Respuesta:', parsed);
    // { type: 'mode', mode: 'MANUAL', message: '...', timestamp: '...' }
});

// Estado cambiado
arduinoController.on('state-changed', (state) => {
    console.log('Nuevo estado:', state);
});

// Error
arduinoController.on('error', (error) => {
    console.error('Error:', error);
});

// Desconectado
arduinoController.on('disconnected', () => {
    console.log('Arduino desconectado');
});
```

### 4. Enviar Comandos

```javascript
// Comandos básicos
await arduinoController.setModeManual();
await arduinoController.setModeAutomatic();
await arduinoController.executeHome();

// Movimiento de ejes
await arduinoController.moveAxisY(1000);  // 1000 pasos adelante
await arduinoController.moveAxisY(-500);  // 500 pasos atrás
await arduinoController.moveAxisZ(200);

// Emergencia
await arduinoController.emergencyStop();

// Comando genérico
await arduinoController.sendCommand('Y1000');
```

### 5. Obtener Estado Actual

```javascript
const state = arduinoController.getState();
console.log(state);
/*
{
    mode: 'MANUAL',
    axisY: {
        position: 1500,
        moving: false,
        atHome: false,
        atLimit: false
    },
    axisZ: {
        position: 0,
        moving: false,
        atHome: true,
        atLimit: false
    },
    emergencyStop: false,
    lastUpdate: Date,
    isConnected: true,
    port: 'COM3'
}
*/
```

### 6. Listar Puertos Disponibles

```javascript
const { ArduinoController } = require('./arduino/ArduinoController');
const ports = await ArduinoController.listAvailablePorts();
console.log(ports);
/*
[
    {
        path: 'COM3',
        manufacturer: 'Arduino LLC',
        serialNumber: '1234567890',
        vendorId: '2341',
        productId: '0043'
    }
]
*/
```

## Integración con Express/Socket.IO

```javascript
// En server.js
const { getInstance } = require('./src/arduino/ArduinoController');

class SilarWebServer {
    constructor() {
        this.arduinoController = getInstance();
        // ... resto del código
    }

    async initialize() {
        // Conectar Arduino
        try {
            await this.arduinoController.connect();
            
            // Reenviar eventos del Arduino a los clientes WebSocket
            this.arduinoController.on('data', (parsed) => {
                this.io.emit('arduino-data', parsed);
            });
            
            this.arduinoController.on('state-changed', (state) => {
                this.io.emit('arduino-state', state);
            });
            
        } catch (error) {
            logger.error('Error conectando Arduino:', error);
        }
        
        // ... resto de la inicialización
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            // Enviar estado actual al conectar
            socket.emit('arduino-state', this.arduinoController.getState());
            
            // Manejar comandos desde el cliente
            socket.on('arduino-command', async (data) => {
                try {
                    const { command, params } = data;
                    
                    switch(command) {
                        case 'MODE_MANUAL':
                            await this.arduinoController.setModeManual();
                            break;
                        case 'MODE_AUTOMATIC':
                            await this.arduinoController.setModeAutomatic();
                            break;
                        case 'HOME':
                            await this.arduinoController.executeHome();
                            break;
                        case 'MOVE_Y':
                            await this.arduinoController.moveAxisY(params.steps);
                            break;
                        case 'MOVE_Z':
                            await this.arduinoController.moveAxisZ(params.steps);
                            break;
                        case 'STOP':
                            await this.arduinoController.emergencyStop();
                            break;
                    }
                } catch (error) {
                    socket.emit('arduino-error', { error: error.message });
                }
            });
        });
    }
}
```

## Integración con Frontend

```javascript
// En el frontend (proceso.js, manual.js, etc.)
const socket = io();

// Recibir estado del Arduino
socket.on('arduino-state', (state) => {
    updateUI(state);
});

// Recibir datos parseados
socket.on('arduino-data', (parsed) => {
    console.log('Arduino:', parsed);
    if (parsed.type === 'home' && parsed.complete) {
        alert('HOME completado');
    }
});

// Enviar comandos
function startHome() {
    socket.emit('arduino-command', {
        command: 'HOME'
    });
}

function moveY(steps) {
    socket.emit('arduino-command', {
        command: 'MOVE_Y',
        params: { steps: steps }
    });
}
```

## Configuración del Arduino

### Hardware
- Baudrate: 9600
- Data bits: 8
- Parity: None
- Stop bits: 1

### Pines Configurados
- **Eje Y**: DIR=2, STEP=3, ENABLE=4, HOME=9, LIMIT_MIN=10, LIMIT_MAX=11
- **Eje Z**: DIR=5, STEP=6, ENABLE=7, HOME=12, LIMIT_MIN=13, LIMIT_MAX=8
- **Emergencia**: PIN=14

## Manejo de Errores

El controlador maneja varios tipos de errores:

1. **Error de Conexión**: No se encuentra el Arduino
2. **Timeout**: No responde en el tiempo esperado
3. **Límite Alcanzado**: Se alcanza un límite físico
4. **Paro de Emergencia**: Se activa el botón de emergencia
5. **Comando Inválido**: Comando no reconocido

Todos los errores se emiten mediante el evento `error` y se registran en el log.

## Logging

Todos los eventos se registran automáticamente:
- Conexión/desconexión
- Comandos enviados
- Respuestas recibidas
- Errores
- Cambios de estado

Los logs se almacenan en `logs/silar-system.log`.

## Pruebas

Para probar la comunicación sin el Arduino físico, se puede usar un emulador serial o simplemente manejar el error de conexión:

```javascript
try {
    await arduinoController.connect();
} catch (error) {
    console.log('Arduino no disponible, continuando en modo simulación');
    // La aplicación sigue funcionando sin Arduino
}
```

## Notas Importantes

1. **NO MODIFICAR** el código del Arduino (`SILAR_Control.ino`) sin coordinación
2. El controlador usa un patrón Singleton - siempre usar `getInstance()`
3. La reconexión automática está habilitada por defecto
4. Los eventos son asíncronos - usar `async/await` o Promises
5. El estado se actualiza automáticamente con cada respuesta del Arduino

## Soporte

Para preguntas o problemas, revisar:
1. Los logs en `logs/silar-system.log`
2. La consola del navegador (F12)
3. El monitor serial del Arduino (para debugging directo)

## Próximas Mejoras

- [ ] Persistencia de estado en base de datos
- [ ] Modo simulación sin Arduino físico
- [ ] Interfaz de calibración de límites
- [ ] Grabación de secuencias de movimiento
- [ ] Perfis de velocidad/aceleración configurables

