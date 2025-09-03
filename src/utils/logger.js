/**
 * Sistema de logging centralizado para SILAR
 * Maneja logs de consola y archivo con rotación automática
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config/app.config');

class Logger {
  constructor() {
    this.logLevels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    
    this.currentLevel = this.logLevels[config.logging.level] || this.logLevels.info;
    this.logFile = path.join(config.paths.logs, config.logging.file);
    
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (data) {
      return `${formattedMessage} ${JSON.stringify(data)}`;
    }
    
    return formattedMessage;
  }

  writeToFile(message) {
    try {
      fs.appendFileSync(this.logFile, message + '\n');
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }

  log(level, message, data = null) {
    if (this.logLevels[level] <= this.currentLevel) {
      const formattedMessage = this.formatMessage(level, message, data);
      
      // Console output
      if (config.logging.console) {
        const colors = {
          error: '\x1b[31m', // Red
          warn: '\x1b[33m',  // Yellow
          info: '\x1b[36m',  // Cyan
          debug: '\x1b[35m'  // Magenta
        };
        
        const reset = '\x1b[0m';
        console.log(`${colors[level] || ''}${formattedMessage}${reset}`);
      }
      
      // File output
      this.writeToFile(formattedMessage);
    }
  }

  error(message, data = null) {
    this.log('error', message, data);
  }

  warn(message, data = null) {
    this.log('warn', message, data);
  }

  info(message, data = null) {
    this.log('info', message, data);
  }

  debug(message, data = null) {
    this.log('debug', message, data);
  }

  // Métodos específicos para el sistema SILAR
  systemStart() {
    this.info('SILAR System iniciado', {
      version: config.app.version,
      environment: config.app.environment,
      timestamp: new Date().toISOString()
    });
  }

  userLogin(userId, username) {
    this.info('Usuario conectado', { userId, username });
  }

  userLogout(userId, username) {
    this.info('Usuario desconectado', { userId, username });
  }

  recipeCreated(recipeId, recipeName, userId) {
    this.info('Receta creada', { recipeId, recipeName, userId });
  }

  recipeUpdated(recipeId, recipeName, userId) {
    this.info('Receta actualizada', { recipeId, recipeName, userId });
  }

  recipeDeleted(recipeId, recipeName, userId) {
    this.info('Receta eliminada', { recipeId, recipeName, userId });
  }

  processStarted(processId, recipeId, userId) {
    this.info('Proceso iniciado', { processId, recipeId, userId });
  }

  processCompleted(processId, duration) {
    this.info('Proceso completado', { processId, duration });
  }

  arduinoConnected(port) {
    this.info('Arduino conectado', { port });
  }

  arduinoDisconnected(port) {
    this.warn('Arduino desconectado', { port });
  }

  databaseConnected() {
    this.info('Base de datos conectada');
  }

  databaseError(error) {
    this.error('Error de base de datos', { error: error.message });
  }

  apiRequest(method, endpoint, userId = null) {
    this.debug('API Request', { method, endpoint, userId });
  }

  apiError(method, endpoint, error, userId = null) {
    this.error('API Error', { method, endpoint, error: error.message, userId });
  }
}

// Singleton instance
const logger = new Logger();

module.exports = logger;
