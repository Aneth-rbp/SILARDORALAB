# SILAR System - Sistema de Control de Laboratorio

Sistema de control para procesos químicos SILAR (Successive Ionic Layer Adsorption and Reaction) desarrollado por DORA Lab.

## ⚡ Integración Arduino Completa

✅ **Nuevo**: Sistema de control Arduino totalmente integrado con flash automático del firmware.

- 🎮 **Control completo** de motores stepper (ejes Y y Z)
- 🚀 **Flash automático** del firmware desde la aplicación
- 🌐 **API REST + WebSocket** para control en tiempo real
- 📦 **Incluido en el empaquetado** (sin necesidad de Arduino IDE)
- 📚 **Documentación completa** en `src/arduino/`

**→ [Ver Guía de Integración Arduino](./docs/arduino/integration-summary.md)**

## 🚨 Problema de Conexión Solucionado

Si experimentas problemas de conexión entre el frontend y backend, sigue estos pasos:

### 1. Verificar Requisitos Previos

- **Node.js**: Versión 16 o superior
- **XAMPP**: Con MySQL ejecutándose
- **Puerto 3000**: Disponible para el servidor web

### 2. Configuración Inicial

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar base de datos
setup-database.bat

# 3. Iniciar servidor
node server.js
```

### 3. Acceso al Sistema

- **URL**: http://localhost:3000
- **Usuario Admin**: admin / admin123
- **Usuario Normal**: dr.martinez / password123

## 🔧 Soluciones Implementadas

### Problemas de Conexión Resueltos:

1. **CORS Configurado**: Permitir conexiones locales
2. **Socket.IO Mejorado**: Configuración robusta con reconexión automática
3. **Rutas Estáticas**: Servir archivos correctamente
4. **Manejo de Errores**: Mejor feedback al usuario
5. **Configuración de Puerto**: Escuchar en todas las interfaces (0.0.0.0)

### Archivos Modificados:

- `server.js`: Configuración CORS y Socket.IO
- `config/app.config.js`: Variables de entorno
- `src/public/js/silar-app.js`: Manejo de conexiones mejorado
- `setup-database.bat`: Script mejorado de configuración de base de datos

## 📁 Estructura del Proyecto

```
SILARDORALAB/
├── config/
│   └── app.config.js          # Configuración centralizada
├── database/
│   └── schema.sql             # Esquema de base de datos
├── src/
│   ├── arduino/              # 🆕 INTEGRACIÓN ARDUINO
│   │   ├── ArduinoController.js      # Controlador principal
│   │   ├── arduino-sketch/           # Código Arduino (.ino)
│   │   ├── flasher/                  # Sistema de flash automático
│   │   ├── examples/                 # Ejemplos de uso
│   │   ├── README.md                 # Documentación completa
│   │   └── QUICK_START.md           # Inicio rápido
│   ├── public/               # Frontend
│   │   ├── js/
│   │   │   └── screens/
│   │   │       ├── manual.js         # Control manual Arduino
│   │   │       └── process.js        # Control de procesos
│   │   ├── css/
│   │   └── index.html
│   └── utils/                # Utilidades del backend
├── server.js                 # Servidor principal (con API Arduino)
├── setup-database.bat        # Configuración de base de datos
└── ARDUINO_INTEGRATION_SUMMARY.md  # 🆕 Resumen integración
```

## 🚀 Inicio Rápido

### Opción 1: Servidor Web (Recomendado para desarrollo)
```bash
# 1. Configurar base de datos
setup-database.bat

# 2. Flashear Arduino (solo primera vez)
npm run flash-arduino

# 3. Iniciar servidor
node server.js
# O usar: npm run web

# 4. Abrir en navegador
http://localhost:3000
```

### Opción 2: Aplicación Electron (Automático)
```bash
# 1. Configurar base de datos (solo la primera vez)
setup-database.bat

# 2. Iniciar aplicación Electron
npm run dev

# 3. La aplicación se abrirá automáticamente
# Credenciales: admin / 1234
```

### Opción 3: Empaquetar para distribución
```bash
# 1. Empaquetar aplicación
npm run build

# 2. Instalar desde dist/SILAR System Setup.exe
```

## 🔍 Diagnóstico de Problemas

### Si el frontend no se conecta:

1. **Verificar puerto**: http://localhost:3000
2. **Revisar logs**: `logs/silar-system.log`
3. **Comprobar MySQL**: Ejecutar `setup-database.bat`
4. **Verificar dependencias**: `npm install`

### Indicadores de Estado:

- 🟢 **Arduino**: Conectado al hardware (ver en Control Manual)
- 🟢 **MySQL**: Base de datos activa
- 🟢 **WebSocket**: Comunicación en tiempo real

### Arduino no conecta:

1. **Flashear el Arduino**: `npm run flash-arduino`
2. **Verificar puerto USB**: Revisar en Administrador de Dispositivos
3. **Cerrar Arduino IDE**: Si está abierto, cerrarlo
4. **Ver logs**: `logs/silar-system.log`
5. **Documentación completa**: Ver `src/arduino/README.md`

## 🛠️ Comandos Disponibles

```bash
# Servidor web
npm run web              # Iniciar servidor Express

# Arduino
npm run flash-arduino    # Flashear firmware en Arduino
npm run arduino-test     # Probar conexión Arduino
npm run arduino-cli-install  # Instalar Arduino CLI manualmente

# Base de datos
npm run setup-db         # Configurar base de datos
npm run update-db        # Actualizar esquema

# Electron
npm run dev              # Desarrollo con Electron
npm run build            # Empaquetar aplicación

# Otros
npm run lint             # Linter
npm test                 # Tests
```

## 🎮 Control del Arduino

El sistema incluye control completo del Arduino:

### Desde la Interfaz Web:
1. Ve a **Control Manual** en el menú
2. Verifica el estado de conexión
3. Usa los botones para controlar los ejes

### Desde la API REST:
```bash
# Listar puertos disponibles
curl http://localhost:3000/api/arduino/ports

# Conectar Arduino
curl -X POST http://localhost:3000/api/arduino/connect \
  -H "Content-Type: application/json" \
  -d '{"port": "COM3"}'

# Ejecutar HOME
curl -X POST http://localhost:3000/api/arduino/command \
  -H "Content-Type: application/json" \
  -d '{"command": "HOME"}'

# Mover eje Y
curl -X POST http://localhost:3000/api/arduino/command \
  -H "Content-Type: application/json" \
  -d '{"command": "MOVE_Y", "params": {"steps": 1000}}'
```

### Documentación Arduino:
- **📚 Índice de Documentación**: [docs/README.md](./docs/README.md)
- **Resumen ejecutivo**: [docs/arduino/integration-summary.md](./docs/arduino/integration-summary.md)
- **Guía rápida**: [docs/arduino/quick-start.md](./docs/arduino/quick-start.md)
- **Documentación completa**: [docs/arduino/README.md](./docs/arduino/README.md)
- **Arquitectura**: [docs/arduino/architecture.md](./docs/arduino/architecture.md)
- **API Reference**: [docs/api/arduino-api.md](./docs/api/arduino-api.md)

## 📝 Logs y Debugging

- **Logs del servidor**: `logs/silar-system.log`
- **Console del navegador**: F12 → Console
- **Estado del sistema**: Indicadores en la interfaz

## 🔒 Seguridad

- Autenticación por token
- Validación de entrada
- Logs de auditoría
- CORS configurado para entorno local

## 📞 Soporte

Para problemas adicionales:

1. Revisar logs en `logs/silar-system.log`
2. Verificar estado de MySQL con `setup-database.bat`
3. Comprobar puerto 3000 disponible
4. Reiniciar XAMPP si es necesario

---

**DORA Lab** - Sistema SILAR v2.0.0
