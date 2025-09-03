/**
 * Servidor web para desarrollo de SILAR System
 * Proporciona API REST y WebSocket para la interfaz web
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const path = require('path');

// Importar utilidades del sistema
const config = require('./config/app.config');
const logger = require('./src/utils/logger');
const errorHandler = require('./src/utils/errorHandler');
const validator = require('./src/utils/validator');

class SilarWebServer {
  constructor() {
    this.server = null;
    this.io = null;
    this.dbConnection = null;
    this.setupExpress();
  }

  // Middleware de autenticación
  async authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Token de acceso requerido' 
      });
    }

    try {
      // Decodificar token simple (en producción usar JWT)
      const decoded = Buffer.from(token, 'base64').toString('ascii');
      const [userId, timestamp] = decoded.split(':');
      
      // Obtener información completa del usuario
      const [rows] = await this.dbConnection.execute(
        'SELECT id, username, full_name, role FROM users WHERE id = ? AND is_active = 1',
        [parseInt(userId)]
      );

      if (rows.length === 0) {
        return res.status(403).json({ 
          success: false, 
          message: 'Usuario no válido' 
        });
      }

      req.user = rows[0];
      logger.apiRequest(req.method, req.url, req.user.id);
      next();
    } catch (error) {
      logger.apiError(req.method, req.url, error, null);
      return res.status(403).json({ 
        success: false, 
        message: 'Token inválido' 
      });
    }
  }

  setupExpress() {
    const app = express();
    this.server = http.createServer(app);
    this.io = socketIo(this.server);

    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'src', 'public')));

    // Middleware de logging
    app.use((req, res, next) => {
      logger.debug(`${req.method} ${req.url}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });

    // Rutas API
    app.post('/api/auth/login', this.loginUser.bind(this));
    app.get('/api/recipes', this.authenticateToken.bind(this), this.getRecipes.bind(this));
    app.post('/api/recipes', this.authenticateToken.bind(this), this.saveRecipe.bind(this));
    app.put('/api/recipes/:id', this.authenticateToken.bind(this), this.updateRecipe.bind(this));
    app.delete('/api/recipes/:id', this.authenticateToken.bind(this), this.deleteRecipe.bind(this));
    app.get('/api/system/status', this.getSystemStatus.bind(this));
    app.post('/api/process/start', this.startProcess.bind(this));
    app.post('/api/process/stop', this.stopProcess.bind(this));

    // Middleware de manejo de errores
    app.use(errorHandler.middleware());

    this.server.listen(config.app.port, () => {
      logger.info(`Servidor web ejecutándose en puerto ${config.app.port}`);
    });

    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.info('Cliente WebSocket conectado', { socketId: socket.id });
      
      socket.on('arduino-command', (data) => {
        logger.info('Comando Arduino recibido', { command: data, socketId: socket.id });
      });

      socket.on('disconnect', () => {
        logger.info('Cliente WebSocket desconectado', { socketId: socket.id });
      });
    });
  }

  async initDatabase() {
    try {
      this.dbConnection = await mysql.createConnection({
        host: config.database.host,
        user: config.database.user,
        password: config.database.password,
        database: config.database.database,
        charset: config.database.charset,
        timezone: config.database.timezone
      });
      logger.databaseConnected();
    } catch (error) {
      logger.databaseError(error);
      throw error;
    }
  }

  async loginUser(req, res) {
    try {
      const { username, password } = req.body;
      
      // Validar datos de entrada
      const loginValidation = validator.validateLogin({ username, password });
      if (!loginValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Datos de login inválidos',
          errors: loginValidation.errors
        });
      }

      // Buscar usuario en la base de datos
      const [rows] = await this.dbConnection.execute(
        'SELECT id, username, password, full_name, role, email, is_active FROM users WHERE username = ? AND is_active = 1',
        [username]
      );

      if (rows.length === 0) {
        logger.warn('Intento de login fallido', { username, reason: 'Usuario no encontrado' });
        return res.status(401).json({ 
          success: false, 
          message: 'Usuario no encontrado' 
        });
      }

      const user = rows[0];
      
      // Verificar contraseña (MD5 simple para demo)
      const crypto = require('crypto');
      const hashedPassword = crypto.createHash('md5').update(password).digest('hex');
      
      if (user.password !== hashedPassword) {
        logger.warn('Intento de login fallido', { username, reason: 'Contraseña incorrecta' });
        return res.status(401).json({ 
          success: false, 
          message: 'Contraseña incorrecta' 
        });
      }

      // Actualizar último login
      await this.dbConnection.execute(
        'UPDATE users SET last_login = NOW() WHERE id = ?',
        [user.id]
      );

      // Generar token simple (en producción usar JWT)
      const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');

      logger.userLogin(user.id, user.username);

      res.json({
        success: true,
        message: 'Login exitoso',
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
          email: user.email
        },
        token: token
      });

    } catch (error) {
      logger.apiError('POST', '/api/auth/login', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error interno del servidor' 
      });
    }
  }

  async getRecipes(req, res) {
    try {
      let query;
      let params = [];

      if (req.user.role === 'admin') {
        // Admin puede ver todas las recetas
        query = `
          SELECT r.*, u.full_name as created_by_name, u.role as creator_role,
                 rp.duration, rp.temperature, rp.velocity_x, rp.velocity_y,
                 rp.accel_x, rp.accel_y, rp.humidity_offset, rp.temperature_offset
          FROM recipes r 
          LEFT JOIN users u ON r.created_by_user_id = u.id 
          LEFT JOIN recipe_parameters rp ON r.id = rp.recipe_id
          WHERE r.is_active = 1
          ORDER BY r.created_at DESC
        `;
      } else {
        // Usuario normal solo ve sus propias recetas
        query = `
          SELECT r.*, u.full_name as created_by_name, u.role as creator_role,
                 rp.duration, rp.temperature, rp.velocity_x, rp.velocity_y,
                 rp.accel_x, rp.accel_y, rp.humidity_offset, rp.temperature_offset
          FROM recipes r 
          LEFT JOIN users u ON r.created_by_user_id = u.id 
          LEFT JOIN recipe_parameters rp ON r.id = rp.recipe_id
          WHERE r.is_active = 1 AND r.created_by_user_id = ?
          ORDER BY r.created_at DESC
        `;
        params = [req.user.id];
      }

      const [rows] = await this.dbConnection.execute(query, params);
      
      logger.info(`Recetas obtenidas: ${rows.length}`, { userId: req.user.id, role: req.user.role });
      
      // Formatear la respuesta para mantener compatibilidad con el frontend
      const formattedRows = rows.map(row => ({
        ...row,
        parameters: {
          duration: row.duration || 0,
          temperature: row.temperature || 0,
          velocityX: row.velocity_x || 0,
          velocityY: row.velocity_y || 0,
          accelX: row.accel_x || 0,
          accelY: row.accel_y || 0,
          humidityOffset: row.humidity_offset || 0,
          temperatureOffset: row.temperature_offset || 0
        }
      }));
      
      res.json(formattedRows);
    } catch (error) {
      logger.apiError('GET', '/api/recipes', error, req.user?.id);
      res.status(500).json({ error: error.message });
    }
  }

  async saveRecipe(req, res) {
    try {
      const { name, description, type, parameters } = req.body;
      
      // Validar datos de receta
      const recipeValidation = validator.validateRecipe({ name, description, type });
      if (!recipeValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Datos de receta inválidos',
          errors: recipeValidation.errors
        });
      }

      // Validar parámetros si se proporcionan
      if (parameters) {
        const paramsValidation = validator.validateParameters(parameters);
        if (!paramsValidation.isValid) {
          return res.status(400).json({
            success: false,
            message: 'Parámetros de receta inválidos',
            errors: paramsValidation.errors
          });
        }
      }
      
      // Iniciar transacción
      await this.dbConnection.beginTransaction();
      
      try {
        // Insertar receta
        const [result] = await this.dbConnection.execute(
          'INSERT INTO recipes (name, description, type, created_by_user_id, created_at) VALUES (?, ?, ?, ?, NOW())',
          [
            name, 
            description || 'Receta creada por usuario', 
            type || 'A', 
            req.user.id 
          ]
        );
        
        const recipeId = result.insertId;
        
        // Insertar parámetros
        await this.dbConnection.execute(
          `INSERT INTO recipe_parameters 
           (recipe_id, duration, temperature, velocity_x, velocity_y, accel_x, accel_y, humidity_offset, temperature_offset) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            recipeId,
            parameters?.duration || 0,
            parameters?.temperature || 0,
            parameters?.velocityX || 0,
            parameters?.velocityY || 0,
            parameters?.accelX || 0,
            parameters?.accelY || 0,
            parameters?.humidityOffset || 0,
            parameters?.temperatureOffset || 0
          ]
        );
        
        // Confirmar transacción
        await this.dbConnection.commit();
        
        logger.recipeCreated(recipeId, name, req.user.id);
        
        res.json({ 
          success: true, 
          message: 'Receta guardada correctamente',
          recipeId: recipeId 
        });
      } catch (error) {
        // Revertir transacción en caso de error
        await this.dbConnection.rollback();
        throw error;
      }
    } catch (error) {
      logger.apiError('POST', '/api/recipes', error, req.user?.id);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  async updateRecipe(req, res) {
    try {
      const { id } = req.params;
      const { name, description, type, parameters } = req.body;
      
      // Validar ID
      const recipeId = validator.validateId(id, 'recipeId');
      
      // Validar datos de receta
      const recipeValidation = validator.validateRecipe({ name, description, type });
      if (!recipeValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Datos de receta inválidos',
          errors: recipeValidation.errors
        });
      }

      // Verificar que la receta existe
      const [existingRecipe] = await this.dbConnection.execute(
        'SELECT * FROM recipes WHERE id = ? AND is_active = 1',
        [recipeId]
      );
      
      if (existingRecipe.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'Receta no encontrada' 
        });
      }
      
      const recipe = existingRecipe[0];
      
      // Verificar permisos (admin o creador de la receta)
      if (recipe.created_by_user_id !== req.user.id && req.user.role !== 'admin') {
        logger.warn('Intento de edición no autorizada', {
          userId: req.user.id,
          recipeId: recipeId,
          recipeOwner: recipe.created_by_user_id
        });
        return res.status(403).json({ 
          success: false, 
          message: 'No tiene permisos para editar esta receta' 
        });
      }
      
      // Iniciar transacción
      await this.dbConnection.beginTransaction();
      
      try {
        // Actualizar la receta
        await this.dbConnection.execute(
          'UPDATE recipes SET name = ?, description = ?, type = ?, updated_at = NOW() WHERE id = ?',
          [
            name, 
            description || recipe.description, 
            type || recipe.type, 
            recipeId 
          ]
        );
        
        // Actualizar o insertar parámetros
        await this.dbConnection.execute(
          `INSERT INTO recipe_parameters 
           (recipe_id, duration, temperature, velocity_x, velocity_y, accel_x, accel_y, humidity_offset, temperature_offset) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
           duration = VALUES(duration),
           temperature = VALUES(temperature),
           velocity_x = VALUES(velocity_x),
           velocity_y = VALUES(velocity_y),
           accel_x = VALUES(accel_x),
           accel_y = VALUES(accel_y),
           humidity_offset = VALUES(humidity_offset),
           temperature_offset = VALUES(temperature_offset),
           updated_at = NOW()`,
          [
            recipeId,
            parameters?.duration || 0,
            parameters?.temperature || 0,
            parameters?.velocityX || 0,
            parameters?.velocityY || 0,
            parameters?.accelX || 0,
            parameters?.accelY || 0,
            parameters?.humidityOffset || 0,
            parameters?.temperatureOffset || 0
          ]
        );
        
        // Confirmar transacción
        await this.dbConnection.commit();
        
        logger.recipeUpdated(recipeId, name, req.user.id);
        
        res.json({ 
          success: true, 
          message: 'Receta actualizada correctamente',
          updatedRecipe: {
            id: recipeId,
            name,
            description: description || recipe.description,
            type: type || recipe.type,
            parameters,
            updated_at: new Date().toISOString()
          }
        });
      } catch (error) {
        // Revertir transacción en caso de error
        await this.dbConnection.rollback();
        throw error;
      }
    } catch (error) {
      logger.apiError('PUT', `/api/recipes/${req.params.id}`, error, req.user?.id);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  async deleteRecipe(req, res) {
    try {
      const { id } = req.params;
      
      // Validar ID
      const recipeId = validator.validateId(id, 'recipeId');
      
      // Verificar que la receta existe
      const [existingRecipe] = await this.dbConnection.execute(
        'SELECT * FROM recipes WHERE id = ? AND is_active = 1',
        [recipeId]
      );
      
      if (existingRecipe.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'Receta no encontrada' 
        });
      }
      
      const recipe = existingRecipe[0];
      
      // Verificar permisos (admin o creador de la receta)
      if (recipe.created_by_user_id !== req.user.id && req.user.role !== 'admin') {
        logger.warn('Intento de eliminación no autorizada', {
          userId: req.user.id,
          recipeId: recipeId,
          recipeOwner: recipe.created_by_user_id
        });
        return res.status(403).json({ 
          success: false, 
          message: 'No tiene permisos para eliminar esta receta' 
        });
      }
      
      // Eliminar la receta (soft delete)
      await this.dbConnection.execute(
        'UPDATE recipes SET is_active = 0, deleted_at = NOW() WHERE id = ?',
        [recipeId]
      );
      
      logger.recipeDeleted(recipeId, recipe.name, req.user.id);
      
      res.json({ 
        success: true, 
        message: 'Receta eliminada correctamente' 
      });
    } catch (error) {
      logger.apiError('DELETE', `/api/recipes/${req.params.id}`, error, req.user?.id);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  async getSystemStatus(req, res) {
    res.json({
      arduino: false,
      database: this.dbConnection ? true : false,
      timestamp: new Date().toISOString()
    });
  }

  async startProcess(req, res) {
    try {
      const { recipeId } = req.body;
      
      if (!recipeId) {
        return res.status(400).json({
          success: false,
          message: 'ID de receta requerido'
        });
      }

      // Validar ID
      const validRecipeId = validator.validateId(recipeId, 'recipeId');
      
      logger.processStarted(Date.now(), validRecipeId, req.user?.id);
      
      // Lógica para iniciar proceso
      res.json({ success: true, message: 'Proceso iniciado' });
    } catch (error) {
      logger.apiError('POST', '/api/process/start', error, req.user?.id);
      res.status(500).json({ error: error.message });
    }
  }

  async stopProcess(req, res) {
    try {
      logger.info('Proceso detenido', { userId: req.user?.id });
      res.json({ success: true, message: 'Proceso detenido' });
    } catch (error) {
      logger.apiError('POST', '/api/process/stop', error, req.user?.id);
      res.status(500).json({ error: error.message });
    }
  }

  async initialize() {
    await this.initDatabase();
    logger.systemStart();
  }
}

const silarServer = new SilarWebServer();
silarServer.initialize();
