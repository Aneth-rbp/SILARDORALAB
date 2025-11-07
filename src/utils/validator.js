/**
 * Sistema de validación centralizado para SILAR
 * Valida datos de entrada antes de procesarlos
 */

const errorHandler = require('./errorHandler');

class Validator {
  constructor() {
    this.validationRules = {
      recipe: {
        name: { required: true, minLength: 1, maxLength: 255 },
        description: { required: false, maxLength: 1000 },
        type: { required: true, enum: ['A', 'B', 'C', 'D'] }
      },
      parameters: {
        duration: { required: false, type: 'number', min: 1, max: 999 },
        temperature: { required: false, type: 'number', min: -50, max: 200 },
        velocityX: { required: false, type: 'number', min: 0, max: 1000 },
        velocityY: { required: false, type: 'number', min: 0, max: 1000 },
        accelX: { required: false, type: 'number', min: 0, max: 100 },
        accelY: { required: false, type: 'number', min: 0, max: 100 },
        humidityOffset: { required: false, type: 'number', min: -50, max: 50 },
        temperatureOffset: { required: false, type: 'number', min: -20, max: 20 }
      },
      user: {
        username: { required: true, minLength: 3, maxLength: 50, pattern: /^[a-zA-Z0-9._-]+$/ },
        password: { required: true, minLength: 4, maxLength: 255 },
        fullName: { required: true, minLength: 2, maxLength: 100 },
        email: { required: false, type: 'email' },
        role: { required: true, enum: ['admin', 'usuario'] }
      }
    };
  }

  /**
   * Valida un campo específico
   */
  validateField(value, rules) {
    const errors = [];

    // Validación requerida
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push('Este campo es obligatorio');
      return errors;
    }

    // Si no es requerido y está vacío, no validar más
    if (!rules.required && (value === undefined || value === null || value === '')) {
      return errors;
    }

    // Validación de tipo
    if (rules.type) {
      switch (rules.type) {
        case 'number':
          if (isNaN(Number(value))) {
            errors.push('Debe ser un número válido');
          }
          break;
        case 'email':
          if (!this.isValidEmail(value)) {
            errors.push('Debe ser un email válido');
          }
          break;
      }
    }

    // Validación de longitud
    if (rules.minLength && value.length < rules.minLength) {
      errors.push(`Mínimo ${rules.minLength} caracteres`);
    }

    if (rules.maxLength && value.length > rules.maxLength) {
      errors.push(`Máximo ${rules.maxLength} caracteres`);
    }

    // Validación de valores numéricos
    if (rules.type === 'number' && !isNaN(Number(value))) {
      const numValue = Number(value);
      
      if (rules.min !== undefined && numValue < rules.min) {
        errors.push(`Mínimo ${rules.min}`);
      }
      
      if (rules.max !== undefined && numValue > rules.max) {
        errors.push(`Máximo ${rules.max}`);
      }
    }

    // Validación de enumeración
    if (rules.enum && !rules.enum.includes(value)) {
      errors.push(`Debe ser uno de: ${rules.enum.join(', ')}`);
    }

    // Validación de patrón
    if (rules.pattern && !rules.pattern.test(value)) {
      errors.push('Formato inválido');
    }

    return errors;
  }

  /**
   * Valida un objeto completo
   */
  validateObject(data, schema) {
    const errors = {};
    let hasErrors = false;

    for (const [field, rules] of Object.entries(schema)) {
      const fieldErrors = this.validateField(data[field], rules);
      if (fieldErrors.length > 0) {
        errors[field] = fieldErrors;
        hasErrors = true;
      }
    }

    return {
      isValid: !hasErrors,
      errors
    };
  }

  /**
   * Valida una receta
   */
  validateRecipe(recipeData) {
    const validation = this.validateObject(recipeData, this.validationRules.recipe);
    
    // No lanzar excepción, solo devolver el objeto de validación
    // El código que llama puede manejar el error según sea necesario
    return validation;
  }

  /**
   * Valida parámetros de receta
   */
  validateParameters(parameters) {
    if (!parameters || typeof parameters !== 'object') {
      return {
        isValid: false,
        errors: { _general: ['Los parámetros deben ser un objeto'] }
      };
    }

    const validation = this.validateObject(parameters, this.validationRules.parameters);
    
    // No lanzar excepción, solo devolver el objeto de validación
    return validation;
  }

  /**
   * Valida datos de usuario
   */
  validateUser(userData) {
    const validation = this.validateObject(userData, this.validationRules.user);
    
    if (!validation.isValid) {
      throw errorHandler.handleValidationError('user', JSON.stringify(validation.errors));
    }

    return validation;
  }

  /**
   * Valida datos de login
   */
  validateLogin(loginData) {
    const loginRules = {
      username: this.validationRules.user.username,
      password: this.validationRules.user.password
    };

    const validation = this.validateObject(loginData, loginRules);
    
    if (!validation.isValid) {
      throw errorHandler.handleValidationError('login', JSON.stringify(validation.errors));
    }

    return validation;
  }

  /**
   * Valida ID numérico
   */
  validateId(id, fieldName = 'id') {
    if (!id || isNaN(Number(id)) || Number(id) <= 0) {
      throw errorHandler.handleValidationError(fieldName, 'ID inválido');
    }
    return Number(id);
  }

  /**
   * Valida email
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Sanitiza datos de entrada
   */
  sanitizeInput(input) {
    if (typeof input === 'string') {
      return input.trim().replace(/[<>]/g, '');
    }
    return input;
  }

  /**
   * Sanitiza objeto completo
   */
  sanitizeObject(obj) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = this.sanitizeInput(value);
    }
    return sanitized;
  }

  /**
   * Middleware para validar requests
   */
  validateRequest(schema) {
    return (req, res, next) => {
      try {
        const data = { ...req.body, ...req.params, ...req.query };
        const validation = this.validateObject(data, schema);
        
        if (!validation.isValid) {
          return res.status(400).json({
            success: false,
            error: {
              type: 'VALIDATION_ERROR',
              message: 'Datos de entrada inválidos',
              details: validation.errors
            }
          });
        }

        // Sanitizar datos
        req.sanitizedData = this.sanitizeObject(data);
        next();
      } catch (error) {
        errorHandler.handleApiError(error, req, res);
      }
    };
  }
}

// Singleton instance
const validator = new Validator();

module.exports = validator;
