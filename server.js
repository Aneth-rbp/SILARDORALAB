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

// Importar controlador de Arduino
const { getInstance } = require('./src/arduino/ArduinoController');
const { ArduinoController } = require('./src/arduino/ArduinoController');
// const { getInstance: getFlasherInstance } = require('./src/arduino/flasher/ArduinoFlasher'); // Comentado - módulo no disponible

class SilarWebServer {
  constructor() {
    this.server = null;
    this.io = null;
    this.dbConnection = null;
    this.arduinoController = getInstance();
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
    
    // Configurar Socket.IO con CORS
    this.io = socketIo(this.server, config.socket);

    // Configurar charset UTF-8 para todas las respuestas JSON
    app.use((req, res, next) => {
      // Interceptar res.json para asegurar charset UTF-8
      const originalJson = res.json.bind(res);
      res.json = function(data) {
        // Solo establecer charset si no se ha establecido otro Content-Type
        if (!res.get('Content-Type') || res.get('Content-Type').includes('application/json')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        return originalJson(data);
      };
      
      next();
    });

    // Configurar CORS para Express
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // Configurar express.json y urlencoded
    // Express maneja UTF-8 por defecto, pero lo aseguramos con el middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    
    // Servir archivos estáticos desde la carpeta public con charset UTF-8
    app.use(express.static(path.join(__dirname, 'src', 'public'), {
      setHeaders: (res, filePath) => {
        // Establecer charset UTF-8 para archivos de texto
        if (filePath.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (filePath.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (filePath.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (filePath.endsWith('.json')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
      }
    }));
    
    // Servir Socket.IO client
    app.get('/socket.io/socket.io.js', (req, res) => {
      res.sendFile(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js'));
    });

    // Middleware de logging
    app.use((req, res, next) => {
      logger.debug(`${req.method} ${req.url}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });

    // Ruta raíz - redirigir a login
    app.get('/', (req, res) => {
      res.redirect('/login.html');
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
    
    // Rutas API Arduino
    app.get('/api/arduino/ports', this.getArduinoPorts.bind(this));
    app.post('/api/arduino/connect', this.connectArduino.bind(this));
    app.post('/api/arduino/disconnect', this.disconnectArduino.bind(this));
    app.get('/api/arduino/state', this.getArduinoState.bind(this));
    app.post('/api/arduino/command', this.sendArduinoCommand.bind(this));
    
    // Rutas API Flash Arduino
    app.get('/api/arduino/flash/info', this.getFlashInfo.bind(this));
    app.post('/api/arduino/flash', this.flashArduino.bind(this));
    app.get('/api/arduino/flash/verify', this.verifyFirmware.bind(this));

    // Middleware de manejo de errores
    app.use(errorHandler.middleware());

    // Manejar rutas no encontradas
    app.use('*', (req, res) => {
      res.status(404).json({ 
        success: false, 
        message: 'Ruta no encontrada',
        path: req.originalUrl 
      });
    });

    this.server.listen(config.app.port, '0.0.0.0', () => {
      logger.info(`Servidor web ejecutándose en puerto ${config.app.port}`);
      logger.info(`Frontend disponible en: http://localhost:${config.app.port}`);
    });

    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.info('Cliente WebSocket conectado', { socketId: socket.id });
      
      // Enviar estado actual del Arduino al conectar
      socket.emit('arduino-state', this.arduinoController.getState());
      
      // Manejar comandos Arduino desde el cliente
      socket.on('arduino-command', async (data) => {
        try {
          logger.info('Comando Arduino recibido', { command: data, socketId: socket.id });
          const { command, params } = data;
          let result;

          switch(command) {
            case 'MODE_MANUAL':
              result = await this.arduinoController.setModeManual();
              break;
            case 'MODE_AUTOMATIC':
              result = await this.arduinoController.setModeAutomatic();
              break;
            case 'HOME':
              result = await this.arduinoController.executeHome();
              break;
            case 'MOVE_Y':
              result = await this.arduinoController.moveAxisY(params?.steps || 0);
              break;
            case 'MOVE_Z':
              result = await this.arduinoController.moveAxisZ(params?.steps || 0);
              break;
            case 'STOP':
              result = await this.arduinoController.emergencyStop();
              break;
            default:
              socket.emit('arduino-error', { error: 'Comando desconocido' });
              return;
          }
          
          socket.emit('arduino-command-result', { success: true, result });
        } catch (error) {
          logger.error('Error ejecutando comando Arduino:', error);
          socket.emit('arduino-error', { error: error.message });
        }
      });

      socket.on('disconnect', () => {
        logger.info('Cliente WebSocket desconectado', { socketId: socket.id });
      });
    });
    
    // Reenviar eventos del Arduino a todos los clientes conectados
    this.setupArduinoEventForwarding();
  }

  setupArduinoEventForwarding() {
    // Datos parseados del Arduino
    this.arduinoController.on('data', (parsed) => {
      this.io.emit('arduino-data', parsed);
      logger.debug('Arduino data broadcast', { type: parsed.type });
    });
    
    // Cambios de estado
    this.arduinoController.on('state-changed', (state) => {
      this.io.emit('arduino-state', state);
    });
    
    // Conexión establecida
    this.arduinoController.on('connected', (data) => {
      this.io.emit('arduino-connected', data);
      logger.info('Arduino conectado - notificando clientes');
    });
    
    // Desconexión
    this.arduinoController.on('disconnected', () => {
      this.io.emit('arduino-disconnected');
      logger.warn('Arduino desconectado - notificando clientes');
    });
    
    // Errores
    this.arduinoController.on('error', (error) => {
      this.io.emit('arduino-error', error);
      logger.error('Arduino error broadcast', error);
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
      
      console.log('🔐 Intento de login:', { username, password: '***' });
      
      // Verificar conexión a BD
      if (!this.dbConnection) {
        console.error('❌ No hay conexión a la base de datos');
        return res.status(500).json({
          success: false,
          message: 'Error de conexión a la base de datos'
        });
      }
      
      // Validar datos de entrada
      const loginValidation = validator.validateLogin({ username, password });
      if (!loginValidation.isValid) {
        console.log('❌ Validación fallida:', loginValidation.errors);
        return res.status(400).json({
          success: false,
          message: 'Datos de login inválidos',
          errors: loginValidation.errors
        });
      }

      // Buscar usuario en la base de datos
      console.log('🔍 Buscando usuario en BD:', username);
      const [rows] = await this.dbConnection.execute(
        'SELECT id, username, password, full_name, role, email, is_active FROM users WHERE username = ? AND is_active = 1',
        [username]
      );
      
      console.log('📊 Resultado BD:', rows.length, 'usuarios encontrados');

      if (rows.length === 0) {
        logger.warn('Intento de login fallido', { username, reason: 'Usuario no encontrado' });
        return res.status(401).json({ 
          success: false, 
          message: 'Usuario no encontrado' 
        });
      }

      const user = rows[0];
      console.log('👤 Usuario encontrado:', { id: user.id, username: user.username, role: user.role });
      
      // Verificar contraseña (MD5 simple para demo)
      const crypto = require('crypto');
      const hashedPassword = crypto.createHash('md5').update(password).digest('hex');
      
      console.log('🔐 Verificando contraseña:', {
        passwordReceived: '***',
        passwordHashed: hashedPassword,
        passwordStored: user.password,
        match: user.password === hashedPassword
      });
      
      if (user.password !== hashedPassword) {
        console.log('❌ Contraseña incorrecta');
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
    const arduinoState = this.arduinoController.getState();
    res.json({
      arduino: arduinoState.isConnected,
      arduinoPort: arduinoState.port,
      arduinoMode: arduinoState.mode,
      database: this.dbConnection ? true : false,
      timestamp: new Date().toISOString()
    });
  }

  async getArduinoPorts(req, res) {
    try {
      const ports = await ArduinoController.listAvailablePorts();
      res.json({
        success: true,
        ports: ports
      });
    } catch (error) {
      logger.error('Error listando puertos Arduino:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async connectArduino(req, res) {
    try {
      const { port, baudRate } = req.body;
      await this.arduinoController.connect(port, baudRate || 9600);
      
      logger.info('Arduino conectado exitosamente', { port });
      
      res.json({
        success: true,
        message: 'Arduino conectado exitosamente',
        state: this.arduinoController.getState()
      });
    } catch (error) {
      logger.error('Error conectando Arduino:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async disconnectArduino(req, res) {
    try {
      await this.arduinoController.disconnect();
      
      logger.info('Arduino desconectado');
      
      res.json({
        success: true,
        message: 'Arduino desconectado'
      });
    } catch (error) {
      logger.error('Error desconectando Arduino:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getArduinoState(req, res) {
    try {
      // Si se solicita actualizar desde el Arduino, hacerlo
      const refresh = req.query.refresh === 'true';
      
      if (refresh && this.arduinoController.isConnected) {
        try {
          await this.arduinoController.requestStatus();
          // Esperar un momento para que se actualice el estado
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.warn('No se pudo actualizar estado desde Arduino:', error.message);
        }
      }
      
      const state = this.arduinoController.getState();
      res.json({
        success: true,
        state: state,
        connected: this.arduinoController.isConnected
      });
    } catch (error) {
      logger.error('Error obteniendo estado Arduino:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async sendArduinoCommand(req, res) {
    try {
      const { command, params } = req.body;
      
      if (!command) {
        return res.status(400).json({
          success: false,
          error: 'Comando requerido'
        });
      }

      let result;

      switch(command) {
        case 'MODE_MANUAL':
          result = await this.arduinoController.setModeManual();
          break;
        case 'MODE_AUTOMATIC':
          result = await this.arduinoController.setModeAutomatic();
          break;
        case 'HOME':
          result = await this.arduinoController.executeHome();
          break;
        case 'MOVE_Y':
          if (!params?.steps) {
            return res.status(400).json({
              success: false,
              error: 'Parámetro steps requerido para MOVE_Y'
            });
          }
          result = await this.arduinoController.moveAxisY(params.steps);
          break;
        case 'MOVE_Z':
          if (!params?.steps) {
            return res.status(400).json({
              success: false,
              error: 'Parámetro steps requerido para MOVE_Z'
            });
          }
          result = await this.arduinoController.moveAxisZ(params.steps);
          break;
        case 'STOP':
          result = await this.arduinoController.emergencyStop();
          break;
        default:
          return res.status(400).json({
            success: false,
            error: 'Comando desconocido'
          });
      }

      logger.info('Comando Arduino ejecutado', { command, params });

      res.json({
        success: true,
        message: 'Comando ejecutado',
        result: result
      });
    } catch (error) {
      logger.error('Error ejecutando comando Arduino:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getFlashInfo(req, res) {
    // Funcionalidad de flash no disponible - flasher module no incluido
    res.json({
      success: false,
      message: 'Funcionalidad de flash automático no disponible. Flashea el Arduino manualmente usando Arduino IDE.',
      flashSystem: {
        available: false,
        arduinoCliInstalled: false
      }
    });
  }

  async flashArduino(req, res) {
    // Funcionalidad de flash no disponible - flasher module no incluido
    logger.warn('Intento de flashear Arduino - funcionalidad no disponible');
    
    res.status(501).json({
      success: false,
      message: 'Funcionalidad de flash automático no disponible.',
      instructions: 'Para flashear el Arduino manualmente: 1) Abre Arduino IDE, 2) Abre src/arduino/arduino-sketch/SILAR_Control.ino, 3) Selecciona tu placa, 4) Haz clic en Upload'
    });
  }

  async verifyFirmware(req, res) {
    // Funcionalidad de verificación no disponible - flasher module no incluido
    res.json({
      success: false,
      message: 'Funcionalidad de verificación automática no disponible. Verifica manualmente que el Arduino responda correctamente.',
      hasCorrectFirmware: null
    });
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    
    // Intentar conectar con Arduino automáticamente
    try {
      await this.arduinoController.connect();
      logger.info('Arduino conectado automáticamente');
    } catch (error) {
      logger.warn('Arduino no disponible al inicio. Se puede conectar manualmente desde la interfaz.', { error: error.message });
    }
    
    logger.systemStart();
  }
}

const silarServer = new SilarWebServer();
silarServer.initialize();
