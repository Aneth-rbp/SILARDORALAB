# SILAR System v2.0

Sistema de control SILAR (Successive Ionic Layer Adsorption and Reaction) para laboratorio local.

## 🎯 Propósito

SILAR System es una aplicación de escritorio diseñada para controlar y monitorear procesos de síntesis de películas delgadas en laboratorio. El sistema permite gestionar recetas, ejecutar procesos automatizados y monitorear variables en tiempo real.

## 🏗️ Arquitectura

```
silar-system/
├── config/                 # Configuración centralizada
│   └── app.config.js
├── src/                    # Código fuente
│   ├── main.js            # Aplicación Electron principal
│   ├── server.js          # Servidor web para desarrollo
│   ├── utils/             # Utilidades del sistema
│   │   ├── logger.js      # Sistema de logging
│   │   ├── errorHandler.js # Manejo de errores
│   │   └── validator.js    # Validación de datos
│   └── public/            # Interfaz de usuario
│       ├── index.html
│       ├── login.html
│       ├── css/
│       ├── js/
│       └── assets/
├── database/              # Esquemas y scripts de BD
│   └── schema.sql
├── logs/                  # Archivos de log
├── backups/              # Respaldos automáticos
└── package.json
```

## 🚀 Instalación

### Requisitos Previos

- **Node.js** 18.x o superior
- **MySQL** 8.0 o superior (XAMPP recomendado)
- **Windows** 10/11 (desarrollado para Windows)

### Instalación Rápida

1. **Clonar el repositorio**
   ```bash
   git clone <repository-url>
   cd silar-system
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Configurar base de datos**
   ```bash
   npm run setup-db
   ```

4. **Iniciar aplicación**
   ```bash
   # Modo Electron (recomendado)
   npm start
   
   # Modo web (desarrollo)
   npm run web
   ```

## 📋 Scripts Disponibles

| Comando | Descripción |
|---------|-------------|
| `npm start` | Inicia la aplicación Electron |
| `npm run dev` | Modo desarrollo con hot reload |
| `npm run web` | Inicia servidor web para desarrollo |
| `npm run build` | Construye aplicación para distribución |
| `npm run setup-db` | Configura la base de datos |
| `npm run update-db` | Actualiza esquema de base de datos |
| `npm run lint` | Ejecuta linter de código |

## 🔧 Configuración

### Base de Datos

La configuración de la base de datos se encuentra en `config/app.config.js`:

```javascript
database: {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'silar_db'
}
```

### Arduino

Configuración para comunicación con Arduino:

```javascript
arduino: {
  baudRate: 9600,
  autoConnect: true,
  timeout: 5000
}
```

## 👥 Usuarios por Defecto

| Usuario | Contraseña | Rol | Descripción |
|---------|------------|-----|-------------|
| `admin` | `admin123` | Admin | Administrador del sistema |
| `dr.martinez` | `password123` | Usuario | Investigador |
| `dr.garcia` | `password123` | Usuario | Investigador |
| `operador1` | `password123` | Usuario | Operador de laboratorio |

## 🔐 Seguridad

- **Autenticación**: Sistema de tokens simples (base64)
- **Autorización**: Control de permisos por rol
- **Validación**: Validación de entrada en todos los endpoints
- **Logging**: Registro de todas las operaciones críticas
- **Sanitización**: Limpieza de datos de entrada

## 📊 Funcionalidades Principales

### Gestión de Recetas
- ✅ Crear, editar y eliminar recetas
- ✅ Parámetros normalizados en tabla separada
- ✅ Control de permisos por usuario
- ✅ Validación de datos en tiempo real

### Control de Procesos
- ✅ Ejecutar recetas automáticamente
- ✅ Monitoreo en tiempo real
- ✅ Control de parámetros de Arduino
- ✅ Registro de historial de procesos

### Monitoreo
- ✅ Variables del sistema en tiempo real
- ✅ Gráficos de tendencias
- ✅ Alertas y notificaciones
- ✅ Exportación de datos

### Sistema
- ✅ Configuración centralizada
- ✅ Logging profesional
- ✅ Manejo de errores robusto
- ✅ Respaldos automáticos

## 🛠️ Desarrollo

### Estructura de Código

El proyecto sigue principios de **Clean Architecture**:

- **Separación de responsabilidades**
- **Inyección de dependencias**
- **Configuración centralizada**
- **Manejo de errores consistente**

### Logging

El sistema utiliza logging profesional con niveles:

```javascript
logger.info('Operación exitosa');
logger.warn('Advertencia del sistema');
logger.error('Error crítico');
logger.debug('Información de debug');
```

### Manejo de Errores

Errores clasificados y manejados consistentemente:

- **VALIDATION_ERROR**: Datos de entrada inválidos
- **AUTHENTICATION_ERROR**: Problemas de autenticación
- **AUTHORIZATION_ERROR**: Problemas de permisos
- **DATABASE_ERROR**: Errores de base de datos
- **ARDUINO_ERROR**: Problemas de comunicación con Arduino

## 🔄 Base de Datos

### Esquema Normalizado

```sql
-- Tabla principal de recetas
recipes (id, name, description, type, created_by_user_id, ...)

-- Tabla de parámetros (normalizada)
recipe_parameters (recipe_id, duration, temperature, velocity_x, ...)

-- Tabla de usuarios
users (id, username, password, full_name, role, ...)

-- Tabla de procesos
processes (id, recipe_id, status, start_time, end_time, ...)
```

### Migración

Para actualizar la base de datos existente:

```bash
npm run update-db
```

## 🚨 Solución de Problemas

### Error de Conexión a Base de Datos

```bash
# Verificar que MySQL esté ejecutándose
# En XAMPP: Iniciar servicio MySQL
# Verificar credenciales en config/app.config.js
```

### Error de Puerto en Uso

```bash
# Terminar procesos en puerto 3000
taskkill /F /IM node.exe
# O cambiar puerto en config/app.config.js
```

### Error de Arduino

- Verificar conexión USB
- Verificar drivers de Arduino
- Revisar logs en `logs/silar-system.log`

## 📝 Logs

Los logs se almacenan en `logs/silar-system.log` con rotación automática:

- **Nivel**: Configurable (error, warn, info, debug)
- **Rotación**: 10MB máximo por archivo
- **Retención**: 5 archivos máximo

## 🔄 Respaldos

El sistema realiza respaldos automáticos:

- **Frecuencia**: Cada 24 horas
- **Ubicación**: `backups/`
- **Retención**: 30 días
- **Formato**: SQL dump

## 📈 Monitoreo

### Variables del Sistema

- **Temperatura**: Control de temperatura del proceso
- **Humedad**: Monitoreo de humedad ambiental
- **Velocidad**: Control de motores X e Y
- **Aceleración**: Control de aceleración de motores
- **Offset**: Compensaciones de calibración

### Alertas

- Temperatura fuera de rango
- Error de comunicación con Arduino
- Proceso completado exitosamente
- Error en ejecución de receta

## 🤝 Contribución

1. Fork el proyecto
2. Crear rama de feature (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver `LICENSE` para más detalles.

## 👨‍💻 Autor

**DORA Lab** - [doralab@example.com](mailto:doralab@example.com)

## 🙏 Agradecimientos

- Equipo de investigación SILAR
- Departamento de Ingeniería
- Laboratorio de Control y Automatización

---

**Versión**: 2.0.0  
**Última actualización**: Septiembre 2025  
**Compatibilidad**: Windows 10/11, Node.js 18+
