/**
 * Sistema de manejo de errores centralizado para SILAR
 * Proporciona manejo consistente de errores en toda la aplicación
 */

const logger = require('./logger');

class ErrorHandler {
  constructor() {
    this.errorTypes = {
      VALIDATION: 'VALIDATION_ERROR',
      AUTHENTICATION: 'AUTHENTICATION_ERROR',
      AUTHORIZATION: 'AUTHORIZATION_ERROR',
      DATABASE: 'DATABASE_ERROR',
      ARDUINO: 'ARDUINO_ERROR',
      NETWORK: 'NETWORK_ERROR',
      SYSTEM: 'SYSTEM_ERROR',
      UNKNOWN: 'UNKNOWN_ERROR'
    };
  }

  /**
   * Clasifica el tipo de error basado en el mensaje o código
   */
  classifyError(error) {
    if (error.code) {
      switch (error.code) {
        case 'ER_ACCESS_DENIED_ERROR':
        case 'ER_BAD_DB_ERROR':
        case 'ER_NO_SUCH_TABLE':
          return this.errorTypes.DATABASE;
        case 'ENOTFOUND':
        case 'ECONNREFUSED':
          return this.errorTypes.NETWORK;
        case 'EACCES':
        case 'EPERM':
          return this.errorTypes.AUTHORIZATION;
        default:
          return this.errorTypes.UNKNOWN;
      }
    }

    if (error.message) {
      const message = error.message.toLowerCase();
      if (message.includes('validation') || message.includes('invalid')) {
        return this.errorTypes.VALIDATION;
      }
      if (message.includes('authentication') || message.includes('unauthorized')) {
        return this.errorTypes.AUTHENTICATION;
      }
      if (message.includes('permission') || message.includes('forbidden')) {
        return this.errorTypes.AUTHORIZATION;
      }
      if (message.includes('database') || message.includes('mysql')) {
        return this.errorTypes.DATABASE;
      }
      if (message.includes('arduino') || message.includes('serial')) {
        return this.errorTypes.ARDUINO;
      }
    }

    return this.errorTypes.UNKNOWN;
  }

  /**
   * Maneja errores de la aplicación
   */
  handleError(error, context = {}) {
    const errorType = this.classifyError(error);
    const errorInfo = {
      type: errorType,
      message: error.message || 'Error desconocido',
      stack: error.stack,
      context,
      timestamp: new Date().toISOString()
    };

    // Log del error
    logger.error(`Error ${errorType}: ${error.message}`, errorInfo);

    // Retorna respuesta estructurada
    return {
      success: false,
      error: {
        type: errorType,
        message: this.getUserFriendlyMessage(errorType, error.message),
        code: error.code || null,
        timestamp: errorInfo.timestamp
      }
    };
  }

  /**
   * Obtiene mensajes amigables para el usuario
   */
  getUserFriendlyMessage(errorType, originalMessage) {
    const messages = {
      [this.errorTypes.VALIDATION]: 'Los datos proporcionados no son válidos',
      [this.errorTypes.AUTHENTICATION]: 'Credenciales incorrectas',
      [this.errorTypes.AUTHORIZATION]: 'No tiene permisos para realizar esta acción',
      [this.errorTypes.DATABASE]: 'Error de conexión con la base de datos',
      [this.errorTypes.ARDUINO]: 'Error de comunicación con Arduino',
      [this.errorTypes.NETWORK]: 'Error de conexión de red',
      [this.errorTypes.SYSTEM]: 'Error interno del sistema',
      [this.errorTypes.UNKNOWN]: 'Ha ocurrido un error inesperado'
    };

    return messages[errorType] || originalMessage;
  }

  /**
   * Maneja errores de API específicos
   */
  handleApiError(error, req, res) {
    const errorResponse = this.handleError(error, {
      method: req.method,
      url: req.url,
      userId: req.user?.id,
      ip: req.ip
    });

    // Determinar código de estado HTTP
    let statusCode = 500;
    switch (errorResponse.error.type) {
      case this.errorTypes.VALIDATION:
        statusCode = 400;
        break;
      case this.errorTypes.AUTHENTICATION:
        statusCode = 401;
        break;
      case this.errorTypes.AUTHORIZATION:
        statusCode = 403;
        break;
      case this.errorTypes.DATABASE:
        statusCode = 503;
        break;
      case this.errorTypes.NETWORK:
        statusCode = 503;
        break;
      default:
        statusCode = 500;
    }

    res.status(statusCode).json(errorResponse);
  }

  /**
   * Maneja errores de base de datos
   */
  handleDatabaseError(error, operation) {
    logger.databaseError(error);
    
    return this.handleError(error, {
      operation,
      component: 'database'
    });
  }

  /**
   * Maneja errores de Arduino
   */
  handleArduinoError(error, operation) {
    logger.error(`Error de Arduino en ${operation}`, error);
    
    return this.handleError(error, {
      operation,
      component: 'arduino'
    });
  }

  /**
   * Maneja errores de validación
   */
  handleValidationError(field, message) {
    const error = new Error(`Validación fallida: ${field} - ${message}`);
    error.type = this.errorTypes.VALIDATION;
    error.field = field;
    
    return this.handleError(error, {
      field,
      component: 'validation'
    });
  }

  /**
   * Middleware para Express
   */
  middleware() {
    return (error, req, res, next) => {
      this.handleApiError(error, req, res);
    };
  }

  /**
   * Wrapper para funciones async
   */
  asyncWrapper(fn) {
    return async (req, res, next) => {
      try {
        await fn(req, res, next);
      } catch (error) {
        this.handleApiError(error, req, res);
      }
    };
  }
}

// Singleton instance
const errorHandler = new ErrorHandler();

module.exports = errorHandler;
