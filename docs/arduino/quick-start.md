# Guía de Inicio Rápido - Integración Arduino

## 🚀 Puesta en Marcha

### 1. Instalar Dependencias

El paquete `serialport` ya está incluido en el `package.json`. Si es necesario reinstalar:

```bash
npm install
```

**Nota para Windows**: La instalación de `serialport` requiere herramientas de compilación de C++. Si encuentras errores:

```bash
npm install --global windows-build-tools
```

### 2. Cargar el Sketch en Arduino

1. Abre Arduino IDE
2. Carga el archivo `src/arduino/arduino-sketch/SILAR_Control.ino`
3. Selecciona tu placa Arduino (Tools → Board)
4. Selecciona el puerto COM correcto (Tools → Port)
5. Sube el sketch (Ctrl+U o botón Upload)

### 3. Verificar Conexión

#### Opción A: Desde el Terminal

```bash
# Ejecutar prueba de integración
node src/arduino/examples/integration-test.js
```

#### Opción B: Desde la Aplicación Web

1. Inicia el servidor:
```bash
npm run web
```

2. Accede a `http://localhost:3000`
3. Ve a la pantalla de "Control Manual"
4. Verifica el estado de conexión en la parte superior

### 4. Conectar Manualmente (si no se conecta automáticamente)

#### Desde el Frontend:

```javascript
// En la consola del navegador (F12)
fetch('/api/arduino/ports')
  .then(r => r.json())
  .then(console.log);

// Luego conectar al puerto correcto
fetch('/api/arduino/connect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ port: 'COM3', baudRate: 9600 })
}).then(r => r.json()).then(console.log);
```

#### Desde Node.js:

```javascript
const { getInstance } = require('./src/arduino/ArduinoController');

async function connect() {
  const arduino = getInstance();
  await arduino.connect('COM3'); // Cambia COM3 por tu puerto
  console.log('Conectado!');
}

connect();
```

## 🔧 Comandos Básicos

### Desde la Interfaz Web (Control Manual)

1. **Cambiar Modo**: Haz clic en "Modo Manual" o "Modo Automático"
2. **HOME**: Haz clic en "Ejecutar HOME"
3. **Mover Ejes**: Usa los botones Y+, Y-, Z+, Z-
4. **Emergencia**: Botón rojo "PARO DE EMERGENCIA"

### Desde Socket.IO (Frontend)

```javascript
// Modo Manual
socket.emit('arduino-command', { command: 'MODE_MANUAL' });

// Modo Automático
socket.emit('arduino-command', { command: 'MODE_AUTOMATIC' });

// HOME
socket.emit('arduino-command', { command: 'HOME' });

// Mover Eje Y
socket.emit('arduino-command', { 
  command: 'MOVE_Y',
  params: { steps: 1000 }
});

// Mover Eje Z
socket.emit('arduino-command', {
  command: 'MOVE_Z',
  params: { steps: 500 }
});
```

### Desde API REST

```bash
# Ver puertos disponibles
curl http://localhost:3000/api/arduino/ports

# Conectar
curl -X POST http://localhost:3000/api/arduino/connect \
  -H "Content-Type: application/json" \
  -d '{"port": "COM3", "baudRate": 9600}'

# Ver estado
curl http://localhost:3000/api/arduino/state

# Enviar comando
curl -X POST http://localhost:3000/api/arduino/command \
  -H "Content-Type: application/json" \
  -d '{"command": "HOME"}'

# Mover eje
curl -X POST http://localhost:3000/api/arduino/command \
  -H "Content-Type: application/json" \
  -d '{"command": "MOVE_Y", "params": {"steps": 1000}}'
```

## 📊 Monitorear Estado en Tiempo Real

### Desde el Frontend

```javascript
// Escuchar cambios de estado
socket.on('arduino-state', (state) => {
  console.log('Estado:', state);
  console.log('Modo:', state.mode);
  console.log('Posición Y:', state.axisY.position);
  console.log('Posición Z:', state.axisZ.position);
});

// Escuchar datos en bruto
socket.on('arduino-data', (data) => {
  console.log('Dato recibido:', data);
});

// Escuchar errores
socket.on('arduino-error', (error) => {
  console.error('Error:', error);
});
```

### Desde Node.js

```javascript
const { getInstance } = require('./src/arduino/ArduinoController');
const arduino = getInstance();

arduino.on('connected', () => {
  console.log('Arduino conectado');
});

arduino.on('state-changed', (state) => {
  console.log('Estado actualizado:', state);
});

arduino.on('data', (parsed) => {
  console.log('Datos:', parsed);
});

await arduino.connect();
```

## 🔍 Solución de Problemas

### Arduino no se detecta

1. **Verificar conexión física**: Cable USB bien conectado
2. **Drivers**: Asegúrate de tener los drivers CH340/FTDI instalados
3. **Otros programas**: Cierra Arduino IDE o cualquier monitor serial
4. **Permisos** (Linux/Mac): 
   ```bash
   sudo usermod -a -G dialout $USER  # Linux
   sudo dtruss -f <puerto>            # Mac
   ```

### Error "Cannot open port"

- El puerto está en uso por otra aplicación
- Cierra todos los monitores seriales
- Reinicia la aplicación
- En Windows, verifica el puerto correcto en "Administrador de Dispositivos"

### No recibo respuestas del Arduino

1. Verifica que el sketch esté cargado correctamente
2. Abre el Monitor Serial de Arduino IDE y verifica que responda
3. Baudrate debe ser 9600
4. Revisa los logs: `logs/silar-system.log`

### Comandos no funcionan

1. Verifica que estés en el modo correcto (Manual/Automático)
2. Revisa que no haya paro de emergencia activado
3. Verifica límites de carrera
4. Mira la consola del navegador (F12) para ver errores

## 📱 Ejemplo Completo

```javascript
// ejemplo-completo.js
const { getInstance } = require('./src/arduino/ArduinoController');

async function ejemploCompleto() {
  const arduino = getInstance();
  
  // 1. Conectar
  console.log('Conectando...');
  await arduino.connect();
  
  // 2. Escuchar eventos
  arduino.on('data', (data) => {
    console.log('→', data.message);
  });
  
  // 3. Configurar modo manual
  console.log('\nConfigurando modo manual...');
  await arduino.setModeManual();
  await delay(1000);
  
  // 4. Ejecutar HOME
  console.log('\nEjecutando HOME...');
  await arduino.executeHome();
  await delay(10000); // Esperar que termine
  
  // 5. Mover ejes
  console.log('\nMoviendo Eje Y...');
  await arduino.moveAxisY(1000);
  await delay(3000);
  
  console.log('\nMoviendo Eje Z...');
  await arduino.moveAxisZ(500);
  await delay(3000);
  
  // 6. Ver estado final
  const state = arduino.getState();
  console.log('\nEstado final:', {
    modo: state.mode,
    posY: state.axisY.position,
    posZ: state.axisZ.position
  });
  
  // 7. Desconectar
  await arduino.disconnect();
  console.log('\n✓ Completado!');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Ejecutar
ejemploCompleto().catch(console.error);
```

## 🎯 Próximos Pasos

1. ✅ Arduino conectado
2. ✅ Comandos básicos funcionando
3. ⚡ Integrar con recetas del sistema
4. ⚡ Crear secuencias automáticas
5. ⚡ Añadir configuración de velocidad/aceleración
6. ⚡ Implementar modo simulación (sin Arduino físico)

## 📚 Documentación Adicional

- **README.md**: Documentación completa del módulo
- **examples/basic-usage.js**: Ejemplos de uso
- **examples/integration-test.js**: Tests de integración
- **commands.js**: Todos los comandos disponibles
- **parser.js**: Cómo se interpretan las respuestas

## 💡 Tips

- **Desarrollo sin Arduino**: La aplicación funcionará sin Arduino conectado, solo mostrará advertencias
- **Logs**: Todos los eventos se guardan en `logs/silar-system.log`
- **Reconexión**: Si se desconecta, intenta reconectar automáticamente cada 10 segundos
- **Seguridad**: Siempre prueba con movimientos pequeños primero
- **Límites**: El Arduino tiene límites de carrera por seguridad

## 🆘 Soporte

Si tienes problemas:
1. Revisa `logs/silar-system.log`
2. Ejecuta `node src/arduino/examples/integration-test.js`
3. Verifica la conexión con Arduino IDE Monitor Serial
4. Consulta la documentación completa en `README.md`

