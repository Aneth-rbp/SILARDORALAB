/**
 * Configuración centralizada del sistema SILAR
 * Todas las configuraciones del sistema se manejan desde aquí
 */

const path = require('path');
const fs = require('fs');
const pkg = require('../package.json');

/**
 * Overrides de la instalación local.
 *
 * Permite corregir la conexión a MySQL o el puerto del Arduino en un equipo
 * remoto editando un JSON, sin recompilar ni publicar una versión nueva. Vive
 * en la carpeta de datos del usuario, así que sobrevive a las actualizaciones:
 *
 *   %APPDATA%\SILAR System\silar-config.json
 *
 *   { "database": { "password": "loQueSea" }, "arduino": { "port": "COM3" } }
 */
function loadLocalOverrides() {
  if (!process.env.USER_DATA_PATH) {
    return {};
  }

  const file = path.join(process.env.USER_DATA_PATH, 'silar-config.json');

  try {
    if (!fs.existsSync(file)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`No se pudo leer ${file}: ${error.message}`);
    return {};
  }
}

const localOverrides = loadLocalOverrides();

module.exports = {
  // Configuración de la aplicación
  app: {
    name: pkg.build?.productName || pkg.name || 'SILAR System',
    version: pkg.version || '2.1.1',
    description: pkg.description || 'Sistema de control SILAR para laboratorio local',
    author: pkg.author || 'DORA Lab',
    port: process.env.PORT || 3001,
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    baseUrl: process.env.BASE_URL || 'http://localhost:3001'
  },

  // Configuración de la base de datos
  //
  // Los valores por defecto son los de XAMPP, que es lo que corre en el equipo
  // del laboratorio: MariaDB en 3306 con root sin contraseña. Para desarrollo
  // con MySQL en Docker hay que exportar DB_PASSWORD (y DB_PORT si aplica), o
  // dejarlo en silar-config.json. Un default distinto a XAMPP deja al equipo de
  // MTY sin base de datos.
  database: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME || 'silar_db',
    charset: 'utf8mb4',
    timezone: 'local',
    connectionLimit: 10,
    acquireTimeout: 60000,
    timeout: 60000,
    ...localOverrides.database
  },

  // Configuración de Arduino
  arduino: {
    baudRate: 9600,
    autoConnect: true,
    timeout: 5000,
    retryAttempts: 3,
    retryDelay: 1000,
    port: process.env.ARDUINO_PORT || null,
    ...localOverrides.arduino
  },

  // Configuración de seguridad
  security: {
    sessionTimeout: 24 * 60 * 60 * 1000, // 24 horas
    tokenExpiration: 8 * 60 * 60 * 1000, // 8 horas
    maxLoginAttempts: 5,
    lockoutDuration: 15 * 60 * 1000, // 15 minutos
    passwordMinLength: 6,
    corsOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000', 'file://']
  },

  // Configuración de archivos
  paths: {
    public: path.join(__dirname, '..', 'src', 'public'),
    database: path.join(__dirname, '..', 'database'),
    logs: process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'logs') : path.join(__dirname, '..', 'logs'),
    uploads: process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'uploads') : path.join(__dirname, '..', 'uploads'),
    backups: process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'backups') : path.join(__dirname, '..', 'backups')
  },

  // Configuración de logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: 'silar-system.log',
    maxSize: '10m',
    maxFiles: 5,
    console: true
  },

  // Configuración de procesos
  process: {
    maxDuration: 180, // minutos
    autoBackup: true,
    backupInterval: 24 * 60 * 60 * 1000, // 24 horas
    dataRetention: 30 * 24 * 60 * 60 * 1000 // 30 días
  },

  // Configuración de la interfaz
  ui: {
    theme: 'light',
    language: 'es',
    autoRefresh: true,
    refreshInterval: 5000, // 5 segundos
    showAdvancedControls: false,
    touchMode: true
  },

  // Configuración de desarrollo
  development: {
    debug: process.env.NODE_ENV === 'development',
    demoMode: process.env.DEMO_MODE === 'true',
    mockArduino: process.env.MOCK_ARDUINO === 'true',
    hotReload: true
  },

  // Configuración de Socket.IO
  socket: {
    cors: {
      origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'file://'],
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  }
};
