/**
 * Configuración centralizada del sistema SILAR
 * Todas las configuraciones del sistema se manejan desde aquí
 */

const path = require('path');

module.exports = {
  // Configuración de la aplicación
  app: {
    name: 'SILAR System',
    version: '2.0.0',
    description: 'Sistema de control SILAR para laboratorio local',
    author: 'DORA Lab',
    port: 3000,
    environment: process.env.NODE_ENV || 'development'
  },

  // Configuración de la base de datos
  database: {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'silar_db',
    charset: 'utf8mb4',
    timezone: 'local'
  },

  // Configuración de Arduino
  arduino: {
    baudRate: 9600,
    autoConnect: true,
    timeout: 5000,
    retryAttempts: 3,
    retryDelay: 1000
  },

  // Configuración de seguridad
  security: {
    sessionTimeout: 24 * 60 * 60 * 1000, // 24 horas
    tokenExpiration: 8 * 60 * 60 * 1000, // 8 horas
    maxLoginAttempts: 5,
    lockoutDuration: 15 * 60 * 1000, // 15 minutos
    passwordMinLength: 6
  },

  // Configuración de archivos
  paths: {
    public: path.join(__dirname, '..', 'src', 'public'),
    database: path.join(__dirname, '..', 'database'),
    logs: path.join(__dirname, '..', 'logs'),
    uploads: path.join(__dirname, '..', 'uploads'),
    backups: path.join(__dirname, '..', 'backups')
  },

  // Configuración de logging
  logging: {
    level: 'info',
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
    demoMode: false,
    mockArduino: true,
    hotReload: true
  }
};
