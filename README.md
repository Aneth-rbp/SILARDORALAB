# SILAR System - Sistema de Control de Laboratorio

Sistema de control para procesos químicos SILAR (Successive Ionic Layer Adsorption and Reaction) desarrollado por DORA Lab.

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
│   ├── public/               # Frontend
│   │   ├── js/
│   │   ├── css/
│   │   └── index.html
│   └── utils/                # Utilidades del backend
├── server.js                 # Servidor principal
└── setup-database.bat        # Configuración de base de datos
```

## 🚀 Inicio Rápido

### Opción 1: Servidor Web (Recomendado para desarrollo)
```bash
# 1. Configurar base de datos
setup-database.bat

# 2. Iniciar servidor
node server.js

# 3. Abrir en navegador
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

- 🟢 **Arduino**: Conectado al hardware
- 🟢 **MySQL**: Base de datos activa
- 🟢 **WebSocket**: Comunicación en tiempo real

## 🛠️ Modo Desarrollo

El sistema incluye un modo demo para desarrollo sin hardware:

```bash
set DEMO_MODE=true
set MOCK_ARDUINO=true
node server.js
```

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
