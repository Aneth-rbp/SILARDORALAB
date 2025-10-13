# 📐 Mejores Prácticas - Sistema SILAR

Guía de convenciones y mejores prácticas para el desarrollo en el proyecto SILAR.

## 📋 Tabla de Contenidos

- [Estructura de Código](#estructura-de-código)
- [Convenciones de Nombres](#convenciones-de-nombres)
- [Manejo de Errores](#manejo-de-errores)
- [Logging](#logging)
- [Seguridad](#seguridad)
- [Testing](#testing)
- [Documentación](#documentación)
- [Git](#git)

## 🏗️ Estructura de Código

### Backend (Node.js)

```javascript
// ✅ Bueno: Organización clara
class MyController {
  constructor() {
    this.state = null;
    this.init();
  }
  
  init() {
    this.setupListeners();
  }
  
  async fetchData() {
    try {
      // Implementación
    } catch (error) {
      logger.error('Error en fetchData:', error);
      throw error;
    }
  }
}

// ❌ Malo: Todo mezclado
function doEverything() {
  // 500 líneas de código...
}
```

### Frontend (JavaScript)

```javascript
// ✅ Bueno: Patrón de clase con responsabilidad única
class DashboardScreen {
  constructor(app) {
    this.app = app;
    this.data = null;
    this.init();
  }
  
  init() {
    this.bindEvents();
    this.loadData();
  }
  
  bindEvents() {
    // Eventos del DOM
  }
  
  async loadData() {
    // Carga de datos
  }
  
  updateUI() {
    // Actualización de interfaz
  }
  
  static getTemplate() {
    // Template HTML
  }
}

// ❌ Malo: Funciones sueltas sin organización
function dashboard1() { }
function dashboard2() { }
function dashboard3() { }
```

## 📝 Convenciones de Nombres

### Variables y Funciones

```javascript
// ✅ Bueno: camelCase descriptivo
const arduinoController = getInstance();
const userFullName = 'John Doe';
const isConnected = true;

async function fetchUserData(userId) { }
function calculateTotalSteps(steps) { }

// ❌ Malo: Abreviaturas, no descriptivo
const ac = getInstance();
const ufn = 'John';
const c = true;

function fetch(id) { }
function calc(s) { }
```

### Clases

```javascript
// ✅ Bueno: PascalCase
class ArduinoController { }
class RecipeManager { }
class UserAuthenticator { }

// ❌ Malo
class arduino_controller { }
class recipemanager { }
```

### Constantes

```javascript
// ✅ Bueno: SCREAMING_SNAKE_CASE
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 5000;
const ARDUINO_BAUDRATE = 9600;

// ❌ Malo
const maxretries = 3;
const timeout = 5000;
```

### Archivos

```javascript
// ✅ Bueno
ArduinoController.js
responseParser.js
user-service.js

// ❌ Malo
arduino.js
parser.js
service.js
```

## ⚠️ Manejo de Errores

### Try-Catch Apropiado

```javascript
// ✅ Bueno: Manejo específico de errores
async function connectArduino(port) {
  try {
    await arduino.connect(port);
    logger.info('Arduino conectado', { port });
  } catch (error) {
    if (error.message.includes('ENOENT')) {
      logger.error('Puerto no encontrado:', port);
      throw new Error(`Puerto ${port} no está disponible`);
    } else if (error.message.includes('Access denied')) {
      logger.error('Acceso denegado al puerto:', port);
      throw new Error('Cierra otros programas que usen el puerto');
    } else {
      logger.error('Error desconocido conectando Arduino:', error);
      throw error;
    }
  }
}

// ❌ Malo: Silenciar errores
async function connectArduino(port) {
  try {
    await arduino.connect(port);
  } catch (error) {
    // Ignorar error
  }
}
```

### Validación de Entrada

```javascript
// ✅ Bueno: Validar antes de usar
function moveAxis(steps) {
  if (typeof steps !== 'number') {
    throw new TypeError('steps debe ser un número');
  }
  
  if (steps === 0) {
    throw new Error('steps no puede ser cero');
  }
  
  if (Math.abs(steps) > 10000) {
    throw new RangeError('steps fuera de rango (-10000 a 10000)');
  }
  
  // Proceder con el movimiento
}

// ❌ Malo: Asumir entrada válida
function moveAxis(steps) {
  arduino.moveAxisY(steps); // Puede fallar
}
```

## 📊 Logging

### Niveles de Log

```javascript
// ✅ Bueno: Usar el nivel apropiado
logger.debug('Datos recibidos:', data); // Desarrollo
logger.info('Usuario conectado:', userId); // Info general
logger.warn('Reconectando en 10s...'); // Advertencias
logger.error('Error conectando:', error); // Errores
```

### Contexto en Logs

```javascript
// ✅ Bueno: Incluir contexto útil
logger.info('Comando Arduino ejecutado', {
  command: 'MOVE_Y',
  params: { steps: 1000 },
  userId: req.user.id,
  timestamp: new Date().toISOString()
});

// ❌ Malo: Log sin contexto
logger.info('Comando ejecutado');
```

### No Loggear Información Sensible

```javascript
// ✅ Bueno
logger.info('Usuario autenticado', { userId: user.id });

// ❌ Malo: Exponer información sensible
logger.info('Usuario autenticado', {
  userId: user.id,
  password: user.password, // ¡NUNCA!
  token: user.token // ¡NUNCA!
});
```

## 🔒 Seguridad

### Validación de Entrada

```javascript
// ✅ Bueno: Validar y sanitizar
app.post('/api/arduino/command', async (req, res) => {
  const { command, params } = req.body;
  
  // Validar comando
  const validCommands = ['MODE_MANUAL', 'MODE_AUTOMATIC', 'HOME', 'MOVE_Y', 'MOVE_Z', 'STOP'];
  if (!validCommands.includes(command)) {
    return res.status(400).json({
      error: 'Comando inválido'
    });
  }
  
  // Validar parámetros
  if (command.startsWith('MOVE_') && typeof params?.steps !== 'number') {
    return res.status(400).json({
      error: 'Parámetro steps requerido'
    });
  }
  
  // Proceder...
});

// ❌ Malo: Ejecutar sin validar
app.post('/api/arduino/command', async (req, res) => {
  await arduino.sendCommand(req.body.command);
});
```

### Autenticación

```javascript
// ✅ Bueno: Middleware de autenticación
app.get('/api/recipes', authenticateToken, async (req, res) => {
  // req.user está disponible
});

// ❌ Malo: Sin autenticación
app.get('/api/recipes', async (req, res) => {
  // Cualquiera puede acceder
});
```

## 🧪 Testing

### Tests Unitarios

```javascript
// ✅ Bueno: Test claro y específico
describe('ResponseParser', () => {
  it('debería parsear respuesta de modo correctamente', () => {
    const result = ResponseParser.parse('Modo Manual');
    
    expect(result.type).toBe('mode');
    expect(result.mode).toBe('MANUAL');
    expect(result).toHaveProperty('timestamp');
  });
  
  it('debería retornar null para línea vacía', () => {
    const result = ResponseParser.parse('');
    expect(result).toBeNull();
  });
});

// ❌ Malo: Test ambiguo
test('parser works', () => {
  const result = parser.parse('something');
  expect(result).toBeTruthy();
});
```

### Tests de Integración

```javascript
// ✅ Bueno: Test end-to-end
describe('Arduino API Integration', () => {
  beforeAll(async () => {
    // Setup
    await server.start();
  });
  
  afterAll(async () => {
    // Cleanup
    await server.stop();
  });
  
  it('debería conectar y enviar comando', async () => {
    const response = await request(app)
      .post('/api/arduino/connect')
      .send({ port: 'COM3' });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    
    const cmdResponse = await request(app)
      .post('/api/arduino/command')
      .send({ command: 'HOME' });
    
    expect(cmdResponse.status).toBe(200);
  });
});
```

## 📖 Documentación

### Comentarios en Código

```javascript
// ✅ Bueno: JSDoc descriptivo
/**
 * Mueve el eje Y la cantidad de pasos especificada
 * @param {number} steps - Pasos a mover (+ adelante, - atrás)
 * @returns {Promise<Object>} Resultado del comando
 * @throws {TypeError} Si steps no es un número
 * @throws {RangeError} Si steps está fuera de rango
 */
async function moveAxisY(steps) {
  // Implementación
}

// ❌ Malo: Sin documentación o comentario inútil
// Mueve Y
function moveAxisY(steps) { }
```

### README de Módulos

```markdown
# Módulo Arduino

## Descripción
Este módulo proporciona...

## Uso
\`\`\`javascript
const arduino = getInstance();
await arduino.connect();
\`\`\`

## API
- `connect(port)` - Conecta...
- `disconnect()` - Desconecta...
```

## 🔄 Git

### Mensajes de Commit

```bash
# ✅ Bueno: Descriptivo y específico
git commit -m "feat: agregar sistema de flash automático de Arduino"
git commit -m "fix: corregir reconexión automática en ArduinoController"
git commit -m "docs: actualizar guía de inicio rápido"
git commit -m "refactor: reorganizar estructura de documentación"

# ❌ Malo: Vago o poco descriptivo
git commit -m "cambios"
git commit -m "fix"
git commit -m "actualizar"
```

### Convenciones

- `feat:` Nueva funcionalidad
- `fix:` Corrección de bug
- `docs:` Cambios en documentación
- `refactor:` Refactorización de código
- `test:` Agregar o modificar tests
- `chore:` Tareas de mantenimiento

### Branches

```bash
# ✅ Bueno
feature/arduino-integration
fix/reconnection-bug
docs/api-reference

# ❌ Malo
branch1
new-feature
fix
```

## 🎯 Checklist Pre-Commit

Antes de hacer commit, verificar:

- [ ] El código compila sin errores
- [ ] Los tests pasan
- [ ] Se agregó documentación si es necesario
- [ ] Se siguen las convenciones de nombres
- [ ] Los logs son apropiados
- [ ] No hay información sensible
- [ ] El mensaje de commit es descriptivo

## 📚 Recursos

- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
- [Clean Code JavaScript](https://github.com/ryanmcdermott/clean-code-javascript)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

---

*Mantener estas prácticas ayuda a que el código sea mantenible, escalable y profesional*


