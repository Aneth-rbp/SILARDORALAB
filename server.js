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
    this.isReconnecting = false; // Bandera para evitar reconexiones múltiples
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

    // Ruta raíz - servir index.html directamente
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'src', 'public', 'index.html'));
    });

    // Rutas API
    app.post('/api/auth/login', this.loginUser.bind(this));
    app.get('/api/recipes', this.authenticateToken.bind(this), this.getRecipes.bind(this));
    app.post('/api/recipes', this.authenticateToken.bind(this), this.saveRecipe.bind(this));
    app.put('/api/recipes/:id', this.authenticateToken.bind(this), this.updateRecipe.bind(this));
    app.delete('/api/recipes/:id', this.authenticateToken.bind(this), this.deleteRecipe.bind(this));
    app.get('/api/system/status', this.getSystemStatus.bind(this));
    app.get('/api/process/status', this.authenticateToken.bind(this), this.getProcessStatus.bind(this));
    app.post('/api/process/start', this.authenticateToken.bind(this), this.startProcess.bind(this));
    app.post('/api/process/pause', this.authenticateToken.bind(this), this.pauseProcess.bind(this));
    app.post('/api/process/resume', this.authenticateToken.bind(this), this.resumeProcess.bind(this));
    app.post('/api/process/stop', this.authenticateToken.bind(this), this.stopProcess.bind(this));
    
    // Rutas API Configuración (solo admin)
    app.get('/api/config', this.authenticateToken.bind(this), this.getSystemConfig.bind(this));
    app.put('/api/config', this.authenticateToken.bind(this), this.updateSystemConfig.bind(this));
    
    // Ruta pública para leer límites del sistema (todos los usuarios autenticados)
    app.get('/api/config/limits', this.authenticateToken.bind(this), this.getSystemLimits.bind(this));
    
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
    // Evitar múltiples intentos de conexión simultáneos
    if (this.isReconnecting) {
      logger.warn('Ya hay un intento de reconexión en curso, esperando...');
      return;
    }
    
    try {
      this.isReconnecting = true;
      
      // Cerrar conexión anterior si existe
      if (this.dbConnection) {
        try {
          await this.dbConnection.end();
        } catch (error) {
          // Ignorar errores al cerrar conexión anterior
        }
      }
      
      this.dbConnection = await mysql.createConnection({
        host: config.database.host,
        user: config.database.user,
        password: config.database.password,
        database: config.database.database,
        charset: 'utf8mb4',
        timezone: config.database.timezone,
        // Configuración adicional para UTF-8
        typeCast: function (field, next) {
          if (field.type === 'VAR_STRING' || field.type === 'STRING' || field.type === 'TEXT') {
            return field.string();
          }
          return next();
        }
      });
      
      // Establecer UTF-8 explícitamente en la conexión
      await this.dbConnection.execute("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");
      await this.dbConnection.execute("SET CHARACTER SET utf8mb4");
      await this.dbConnection.execute("SET character_set_connection=utf8mb4");
      
      // Manejar errores de conexión perdida
      this.dbConnection.on('error', async (err) => {
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
          logger.warn('Conexión a la base de datos perdida, intentando reconectar...');
          this.dbConnection = null;
          // Esperar un poco antes de reconectar para evitar bucles
          setTimeout(async () => {
            try {
              await this.initDatabase();
            } catch (reconnectError) {
              logger.error('Error al reconectar a la base de datos:', reconnectError);
            }
          }, 1000);
        } else {
          logger.error('Error de base de datos:', err);
        }
      });
      
      logger.databaseConnected();
      this.isReconnecting = false;
    } catch (error) {
      this.isReconnecting = false;
      logger.databaseError(error);
      this.dbConnection = null;
      throw error;
    }
  }

  /**
   * Verifica si la conexión a la base de datos está activa
   */
  async ensureDatabaseConnection() {
    if (!this.dbConnection) {
      try {
        await this.initDatabase();
      } catch (error) {
        logger.error('No se pudo establecer conexión con la base de datos:', error);
        throw error;
      }
    }
    
    // Verificar que la conexión sigue activa
    try {
      await this.dbConnection.execute('SELECT 1');
    } catch (error) {
      if (error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ECONNRESET') {
        logger.warn('Conexión perdida, reconectando...');
        try {
          await this.initDatabase();
        } catch (reconnectError) {
          logger.error('Error al reconectar:', reconnectError);
          throw reconnectError;
        }
      } else {
        throw error;
      }
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
                 rp.accel_x, rp.accel_y, rp.humidity_offset, rp.temperature_offset,
                 rp.dipping_wait0, rp.dipping_wait1, rp.dipping_wait2, rp.dipping_wait3, rp.transfer_wait,
                 rp.cycles, rp.fan, rp.except_dripping1, rp.except_dripping2, rp.except_dripping3, rp.except_dripping4,
                 rp.dip_start_position, rp.dipping_length, rp.transfer_speed, rp.dip_speed
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
                 rp.accel_x, rp.accel_y, rp.humidity_offset, rp.temperature_offset,
                 rp.dipping_wait0, rp.dipping_wait1, rp.dipping_wait2, rp.dipping_wait3, rp.transfer_wait,
                 rp.cycles, rp.fan, rp.except_dripping1, rp.except_dripping2, rp.except_dripping3, rp.except_dripping4,
                 rp.dip_start_position, rp.dipping_length, rp.transfer_speed, rp.dip_speed
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
          temperatureOffset: row.temperature_offset || 0,
          // Tiempos de inmersión
          dippingWait0: row.dipping_wait0 || 0,
          dippingWait1: row.dipping_wait1 || 0,
          dippingWait2: row.dipping_wait2 || 0,
          dippingWait3: row.dipping_wait3 || 0,
          transferWait: row.transfer_wait || 0,
          // Parámetros de proceso
          cycles: row.cycles || 1,
          fan: row.fan || false,
          exceptDripping1: row.except_dripping1 || false,
          exceptDripping2: row.except_dripping2 || false,
          exceptDripping3: row.except_dripping3 || false,
          exceptDripping4: row.except_dripping4 || false,
          // Posiciones
          dipStartPosition: row.dip_start_position || 0,
          dippingLength: row.dipping_length || 0,
          transferSpeed: row.transfer_speed || 0,
          dipSpeed: row.dip_speed || 0
          // Variables Pendiente (COMENTADAS - No implementadas)
          // setTemp1: row.set_temp1 || 0,
          // setTemp2: row.set_temp2 || 0,
          // setTemp3: row.set_temp3 || 0,
          // setTemp4: row.set_temp4 || 0,
          // setStirr1: row.set_stirr1 || 0,
          // setStirr2: row.set_stirr2 || 0,
          // setStirr3: row.set_stirr3 || 0,
          // setStirr4: row.set_stirr4 || 0,
          // measTemp1: row.meas_temp1 || 0,
          // measTemp2: row.meas_temp2 || 0,
          // measTemp3: row.meas_temp3 || 0,
          // measTemp4: row.meas_temp4 || 0,
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
        
        // Insertar parámetros (incluyendo tiempos de inmersión y ciclos)
        // Convertir valores booleanos a 0/1 para MySQL
        const fanValue = parameters?.fan ? 1 : 0;
        const exceptDripping1Value = parameters?.exceptDripping1 ? 1 : 0;
        const exceptDripping2Value = parameters?.exceptDripping2 ? 1 : 0;
        const exceptDripping3Value = parameters?.exceptDripping3 ? 1 : 0;
        const exceptDripping4Value = parameters?.exceptDripping4 ? 1 : 0;
        
        await this.dbConnection.execute(
          `INSERT INTO recipe_parameters 
           (recipe_id, duration, temperature, velocity_x, velocity_y, accel_x, accel_y, humidity_offset, temperature_offset,
            dipping_wait0, dipping_wait1, dipping_wait2, dipping_wait3, transfer_wait,
            cycles, fan, except_dripping1, except_dripping2, except_dripping3, except_dripping4,
            dip_start_position, dipping_length, transfer_speed, dip_speed) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            recipeId,
            parameters?.duration || 0,
            parameters?.temperature || 0,
            parameters?.velocityX || 0,
            parameters?.velocityY || 0,
            parameters?.accelX || 0,
            parameters?.accelY || 0,
            parameters?.humidityOffset || 0,
            parameters?.temperatureOffset || 0,
            // Tiempos de inmersión (en milisegundos)
            parameters?.dippingWait0 || 0,
            parameters?.dippingWait1 || 0,
            parameters?.dippingWait2 || 0,
            parameters?.dippingWait3 || 0,
            parameters?.transferWait || 0,
            // Parámetros de proceso
            parameters?.cycles || 1,
            fanValue,
            exceptDripping1Value,
            exceptDripping2Value,
            exceptDripping3Value,
            exceptDripping4Value,
            // Posiciones
            parameters?.dipStartPosition || 0,
            parameters?.dippingLength || 0,
            parameters?.transferSpeed || 0,
            parameters?.dipSpeed || 0
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
      
      // Verificar conexión a la base de datos
      if (!this.dbConnection) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos. Por favor, verifique que MySQL esté ejecutándose.'
        });
      }
      
      // Asegurar que la conexión esté activa
      try {
        await this.ensureDatabaseConnection();
      } catch (dbError) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos. Por favor, verifique que MySQL esté ejecutándose.'
        });
      }
      
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
        
        // Actualizar o insertar parámetros (incluyendo tiempos de inmersión y ciclos)
        // Convertir valores booleanos a 0/1 para MySQL
        const fanValue = parameters?.fan ? 1 : 0;
        const exceptDripping1Value = parameters?.exceptDripping1 ? 1 : 0;
        const exceptDripping2Value = parameters?.exceptDripping2 ? 1 : 0;
        const exceptDripping3Value = parameters?.exceptDripping3 ? 1 : 0;
        const exceptDripping4Value = parameters?.exceptDripping4 ? 1 : 0;
        
        const paramsArray = [
          recipeId,
          parameters?.duration || 0,
          parameters?.temperature || 0,
          parameters?.velocityX || 0,
          parameters?.velocityY || 0,
          parameters?.accelX || 0,
          parameters?.accelY || 0,
          parameters?.humidityOffset || 0,
          parameters?.temperatureOffset || 0,
          // Tiempos de inmersión
          parameters?.dippingWait0 || 0,
          parameters?.dippingWait1 || 0,
          parameters?.dippingWait2 || 0,
          parameters?.dippingWait3 || 0,
          parameters?.transferWait || 0,
          // Parámetros de proceso
          parameters?.cycles || 1,
          fanValue,
          exceptDripping1Value,
          exceptDripping2Value,
          exceptDripping3Value,
          exceptDripping4Value,
          // Posiciones
          parameters?.dipStartPosition || 0,
          parameters?.dippingLength || 0,
          parameters?.transferSpeed || 0,
          parameters?.dipSpeed || 0
        ];
        
        // Log para depuración
        logger.debug(`Actualizando parámetros de receta ${recipeId}`, {
          columnCount: 24,
          valueCount: paramsArray.length,
          params: paramsArray
        });
        
        await this.dbConnection.execute(
          `INSERT INTO recipe_parameters 
           (recipe_id, duration, temperature, velocity_x, velocity_y, accel_x, accel_y, humidity_offset, temperature_offset,
            dipping_wait0, dipping_wait1, dipping_wait2, dipping_wait3, transfer_wait,
            cycles, fan, except_dripping1, except_dripping2, except_dripping3, except_dripping4,
            dip_start_position, dipping_length, transfer_speed, dip_speed) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
           duration = VALUES(duration),
           temperature = VALUES(temperature),
           velocity_x = VALUES(velocity_x),
           velocity_y = VALUES(velocity_y),
           accel_x = VALUES(accel_x),
           accel_y = VALUES(accel_y),
           humidity_offset = VALUES(humidity_offset),
           temperature_offset = VALUES(temperature_offset),
           dipping_wait0 = VALUES(dipping_wait0),
           dipping_wait1 = VALUES(dipping_wait1),
           dipping_wait2 = VALUES(dipping_wait2),
           dipping_wait3 = VALUES(dipping_wait3),
           transfer_wait = VALUES(transfer_wait),
           cycles = VALUES(cycles),
           fan = VALUES(fan),
           except_dripping1 = VALUES(except_dripping1),
           except_dripping2 = VALUES(except_dripping2),
           except_dripping3 = VALUES(except_dripping3),
           except_dripping4 = VALUES(except_dripping4),
           dip_start_position = VALUES(dip_start_position),
           dipping_length = VALUES(dipping_length),
           transfer_speed = VALUES(transfer_speed),
           dip_speed = VALUES(dip_speed),
           updated_at = NOW()`,
          paramsArray
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
      
      // Determinar código de estado según el tipo de error
      let statusCode = 500;
      let errorMessage = error.message || 'Error interno del servidor';
      
      // Verificar si es un error de conexión perdida
      if (error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ECONNRESET' || 
          error.code === 'ETIMEDOUT' || error.fatal === true) {
        statusCode = 503;
        errorMessage = 'La conexión con la base de datos se perdió. Por favor, verifique que MySQL esté ejecutándose.';
        // Intentar reconectar
        try {
          await this.initDatabase();
        } catch (reconnectError) {
          logger.error('Error al intentar reconectar a la base de datos:', reconnectError);
        }
      }
      // Errores de validación
      else if (error.type === 'VALIDATION_ERROR' || error.message?.includes('Validación fallida') || error.message?.includes('ID inválido')) {
        statusCode = 400;
        errorMessage = error.message || 'Datos de receta inválidos';
      }
      // Errores de base de datos MySQL
      else if (error.code?.startsWith('ER_') || error.code === 'ECONNREFUSED' || 
               error.code === 'ENOTFOUND' || error.sqlMessage) {
        statusCode = 503;
        errorMessage = error.sqlMessage || 'Error de conexión con la base de datos. Verifique que MySQL esté ejecutándose.';
      }
      
      res.status(statusCode).json({ 
        success: false,
        message: errorMessage,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

  async getProcessStatus(req, res) {
    try {
      // Verificar conexión a la base de datos
      if (!this.dbConnection) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      await this.ensureDatabaseConnection();

      // Buscar si hay un proceso ejecutándose
      const [processes] = await this.dbConnection.execute(
        `SELECT id, status, start_time, recipe_id, process_number 
         FROM processes 
         WHERE status IN ('running', 'paused') 
         ORDER BY start_time DESC 
         LIMIT 1`
      );

      if (processes.length === 0) {
        return res.json({
          success: true,
          status: 'stopped',
          process: null
        });
      }

      const process = processes[0];
      return res.json({
        success: true,
        status: process.status,
        process: {
          id: process.id,
          recipeId: process.recipe_id,
          processNumber: process.process_number,
          startTime: process.start_time
        }
      });
    } catch (error) {
      logger.apiError('GET', '/api/process/status', error, req.user?.id);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
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

      // Verificar conexión a la base de datos
      if (!this.dbConnection) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      await this.ensureDatabaseConnection();

      // Verificar si ya hay un proceso ejecutándose
      const [runningProcesses] = await this.dbConnection.execute(
        `SELECT id, status, process_number 
         FROM processes 
         WHERE status IN ('running', 'paused') 
         LIMIT 1`
      );

      if (runningProcesses.length > 0) {
        const runningProcess = runningProcesses[0];
        return res.status(409).json({
          success: false,
          message: `Ya hay un proceso ejecutándose (${runningProcess.process_number}). Debe detenerlo antes de iniciar uno nuevo.`,
          runningProcess: {
            id: runningProcess.id,
            status: runningProcess.status,
            processNumber: runningProcess.process_number
          }
        });
      }

      // Validar ID
      const validRecipeId = validator.validateId(recipeId, 'recipeId');
      
      // Obtener los parámetros de la receta
      const [recipes] = await this.dbConnection.execute(
        `SELECT r.*, rp.* 
         FROM recipes r
         LEFT JOIN recipe_parameters rp ON r.id = rp.recipe_id
         WHERE r.id = ? AND r.is_active = 1`,
        [validRecipeId]
      );

      if (recipes.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Receta no encontrada o inactiva'
        });
      }

      const recipe = recipes[0];
      const parameters = {
        duration: recipe.duration || 0,
        temperature: recipe.temperature || 0,
        velocityY: recipe.velocity_y || 0,
        velocityZ: recipe.velocity_x || 0, // Nota: velocity_x se usa para Z según el esquema
        accelY: recipe.accel_y || 0,
        accelZ: recipe.accel_x || 0,
        dippingWait0: recipe.dipping_wait0 || 0,
        dippingWait1: recipe.dipping_wait1 || 0,
        dippingWait2: recipe.dipping_wait2 || 0,
        dippingWait3: recipe.dipping_wait3 || 0,
        transferWait: recipe.transfer_wait || 0,
        cycles: recipe.cycles || 1,
        fan: recipe.fan || false,
        exceptDripping1: recipe.except_dripping1 || false,
        exceptDripping2: recipe.except_dripping2 || false,
        exceptDripping3: recipe.except_dripping3 || false,
        exceptDripping4: recipe.except_dripping4 || false,
        dipStartPosition: recipe.dip_start_position || 0,
        dippingLength: recipe.dipping_length || 0,
        transferSpeed: recipe.transfer_speed || 0,
        dipSpeed: recipe.dip_speed || 0
      };

      // Verificar conexión con Arduino antes de iniciar proceso
      if (!this.arduinoController.isConnected) {
        logger.warn('Arduino no conectado al intentar iniciar proceso', { recipeId: validRecipeId });
        // Continuar con el proceso aunque Arduino no esté conectado (modo simulación)
        // En producción, podrías querer requerir conexión:
        // return res.status(503).json({
        //   success: false,
        //   message: 'Arduino no conectado. Conecte el Arduino antes de iniciar un proceso.'
        // });
      }

      // Crear nuevo proceso en la base de datos
      const [result] = await this.dbConnection.execute(
        `INSERT INTO processes (recipe_id, process_number, status, start_time, operator_name, parameters) 
         VALUES (?, CONCAT('PROC-', DATE_FORMAT(NOW(), '%Y%m%d'), '-', LPAD(FLOOR(RAND() * 10000), 4, '0')), 'running', NOW(), ?, ?)`,
        [validRecipeId, req.user?.fullName || req.user?.username || 'Usuario', JSON.stringify(parameters)]
      );

      const processId = result.insertId;

      // Obtener el número de proceso generado
      const [processData] = await this.dbConnection.execute(
        `SELECT process_number FROM processes WHERE id = ?`,
        [processId]
      );

      // Si Arduino está conectado, enviar comandos para iniciar el proceso automático
      if (this.arduinoController.isConnected) {
        try {
          // Cambiar a modo automático
          await this.arduinoController.setModeAutomatic();
          logger.info('Arduino configurado en modo automático', { processId, recipeId: validRecipeId });
          
          // Enviar parámetros de la receta al Arduino para iniciar el proceso automático
          await this.arduinoController.startRecipe(parameters);
          logger.info('Proceso automático iniciado en Arduino', { processId, recipeId: validRecipeId, parameters });
          
        } catch (arduinoError) {
          logger.error('Error enviando comandos al Arduino al iniciar proceso:', arduinoError);
          // No fallar el proceso si hay error con Arduino, solo loguear
          // El proceso puede continuar en modo simulación
        }
      }

      logger.processStarted(processId, validRecipeId, req.user?.id);
      
      res.json({ 
        success: true, 
        message: 'Proceso iniciado correctamente',
        processId: processId,
        processNumber: processData[0].process_number,
        arduinoConnected: this.arduinoController.isConnected
      });
    } catch (error) {
      logger.apiError('POST', '/api/process/start', error, req.user?.id);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  async pauseProcess(req, res) {
    try {
      // Verificar conexión a la base de datos
      if (!this.dbConnection) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      await this.ensureDatabaseConnection();

      // Buscar proceso ejecutándose
      const [runningProcesses] = await this.dbConnection.execute(
        `SELECT id, status 
         FROM processes 
         WHERE status = 'running' 
         ORDER BY start_time DESC 
         LIMIT 1`
      );

      if (runningProcesses.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No hay ningún proceso ejecutándose para pausar'
        });
      }

      const process = runningProcesses[0];

      // Si Arduino está conectado, enviar comando de pausa
      if (this.arduinoController.isConnected) {
        try {
          await this.arduinoController.pauseProcess();
          logger.info('Proceso pausado en Arduino', { processId: process.id });
        } catch (arduinoError) {
          logger.error('Error pausando proceso en Arduino:', arduinoError);
          // Continuar con la pausa en la base de datos aunque haya error con Arduino
        }
      }

      // Actualizar proceso a pausado
      await this.dbConnection.execute(
        `UPDATE processes 
         SET status = 'paused' 
         WHERE id = ?`,
        [process.id]
      );

      logger.info('Proceso pausado', { 
        processId: process.id, 
        userId: req.user?.id 
      });
      
      res.json({ 
        success: true, 
        message: 'Proceso pausado correctamente',
        processId: process.id
      });
    } catch (error) {
      logger.apiError('POST', '/api/process/pause', error, req.user?.id);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  async resumeProcess(req, res) {
    try {
      // Verificar conexión a la base de datos
      if (!this.dbConnection) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      await this.ensureDatabaseConnection();

      // Buscar proceso pausado
      const [pausedProcesses] = await this.dbConnection.execute(
        `SELECT id, status 
         FROM processes 
         WHERE status = 'paused' 
         ORDER BY start_time DESC 
         LIMIT 1`
      );

      if (pausedProcesses.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No hay ningún proceso pausado para reanudar'
        });
      }

      const process = pausedProcesses[0];

      // Si Arduino está conectado, enviar comando de reanudar
      if (this.arduinoController.isConnected) {
        try {
          await this.arduinoController.resumeProcess();
          logger.info('Proceso reanudado en Arduino', { processId: process.id });
        } catch (arduinoError) {
          logger.error('Error reanudando proceso en Arduino:', arduinoError);
          // Continuar con la reanudación en la base de datos aunque haya error con Arduino
        }
      }

      // Actualizar proceso a ejecutándose
      await this.dbConnection.execute(
        `UPDATE processes 
         SET status = 'running' 
         WHERE id = ?`,
        [process.id]
      );

      logger.info('Proceso reanudado', { 
        processId: process.id, 
        userId: req.user?.id 
      });
      
      res.json({ 
        success: true, 
        message: 'Proceso reanudado correctamente',
        processId: process.id
      });
    } catch (error) {
      logger.apiError('POST', '/api/process/resume', error, req.user?.id);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  async stopProcess(req, res) {
    try {
      // Verificar conexión a la base de datos
      if (!this.dbConnection) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      await this.ensureDatabaseConnection();

      // Buscar proceso ejecutándose
      const [runningProcesses] = await this.dbConnection.execute(
        `SELECT id, status, start_time 
         FROM processes 
         WHERE status IN ('running', 'paused') 
         ORDER BY start_time DESC 
         LIMIT 1`
      );

      if (runningProcesses.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No hay ningún proceso ejecutándose'
        });
      }

      const process = runningProcesses[0];
      const startTime = process.start_time;
      const endTime = new Date();
      const durationMinutes = startTime 
        ? Math.floor((endTime - new Date(startTime)) / 60000)
        : 0;

      // Si Arduino está conectado, enviar comando de paro
      if (this.arduinoController.isConnected) {
        try {
          // Enviar comando de paro de emergencia al Arduino
          await this.arduinoController.emergencyStop();
          logger.info('Proceso detenido en Arduino', { processId: process.id });
        } catch (arduinoError) {
          logger.error('Error deteniendo proceso en Arduino:', arduinoError);
          // Continuar con la detención en la base de datos aunque haya error con Arduino
        }
      }

      // Actualizar proceso a detenido
      await this.dbConnection.execute(
        `UPDATE processes 
         SET status = 'cancelled', 
             end_time = NOW(), 
             duration_minutes = ? 
         WHERE id = ?`,
        [durationMinutes, process.id]
      );

      logger.info('Proceso detenido', { 
        processId: process.id, 
        userId: req.user?.id 
      });
      
      res.json({ 
        success: true, 
        message: 'Proceso detenido correctamente',
        processId: process.id
      });
    } catch (error) {
      logger.apiError('POST', '/api/process/stop', error, req.user?.id);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  /**
   * Obtiene la configuración del sistema
   * Solo administradores pueden ver todas las configuraciones
   */
  async getSystemConfig(req, res) {
    try {
      // Verificar permisos de administrador
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Solo los administradores pueden acceder a la configuración del sistema'
        });
      }

      // Verificar conexión a la base de datos
      if (!this.dbConnection) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      try {
        await this.ensureDatabaseConnection();
      } catch (dbError) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      // Obtener todas las configuraciones del sistema
      const [rows] = await this.dbConnection.execute(
        'SELECT config_key, config_value, config_type, description, category FROM system_config ORDER BY category, config_key'
      );

      // Organizar configuraciones por categoría
      const configByCategory = {};
      rows.forEach(row => {
        if (!configByCategory[row.category]) {
          configByCategory[row.category] = [];
        }
        
        // Convertir valores según el tipo
        let value = row.config_value;
        if (row.config_type === 'number') {
          value = parseFloat(value) || 0;
        } else if (row.config_type === 'boolean') {
          value = value === 'true' || value === '1';
        } else if (row.config_type === 'json') {
          try {
            value = JSON.parse(value);
          } catch (e) {
            value = value;
          }
        }
        
        configByCategory[row.category].push({
          key: row.config_key,
          value: value,
          type: row.config_type,
          description: row.description
        });
      });

      res.json({
        success: true,
        config: configByCategory,
        all: rows
      });
    } catch (error) {
      logger.apiError('GET', '/api/config', error, req.user?.id);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Actualiza la configuración del sistema
   * Solo administradores pueden modificar configuraciones
   */
  async updateSystemConfig(req, res) {
    try {
      // Verificar permisos de administrador
      if (req.user.role !== 'admin') {
        logger.warn('Intento de modificación de configuración no autorizada', {
          userId: req.user.id,
          role: req.user.role
        });
        return res.status(403).json({
          success: false,
          message: 'Solo los administradores pueden modificar la configuración del sistema'
        });
      }

      const { config } = req.body;

      if (!config || typeof config !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'Datos de configuración inválidos'
        });
      }

      // Verificar conexión a la base de datos
      if (!this.dbConnection) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      try {
        await this.ensureDatabaseConnection();
      } catch (dbError) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      // Iniciar transacción
      await this.dbConnection.beginTransaction();

      try {
        const updates = [];
        
        // Actualizar cada configuración
        for (const [key, value] of Object.entries(config)) {
          // Obtener el tipo de configuración
          const [configRow] = await this.dbConnection.execute(
            'SELECT config_type FROM system_config WHERE config_key = ?',
            [key]
          );

          if (configRow.length === 0) {
            // Si no existe, crear nueva configuración
            await this.dbConnection.execute(
              'INSERT INTO system_config (config_key, config_value, config_type, updated_by) VALUES (?, ?, ?, ?)',
              [key, String(value), 'string', req.user.username]
            );
          } else {
            // Convertir valor según el tipo
            let stringValue = String(value);
            const configType = configRow[0].config_type;
            
            if (configType === 'json' && typeof value === 'object') {
              stringValue = JSON.stringify(value);
            }
            
            // Actualizar configuración existente
            await this.dbConnection.execute(
              'UPDATE system_config SET config_value = ?, updated_by = ?, updated_at = NOW() WHERE config_key = ?',
              [stringValue, req.user.username, key]
            );
          }
          
          updates.push(key);
        }

        // Confirmar transacción
        await this.dbConnection.commit();

        logger.info(`Configuración actualizada por admin ${req.user.id}`, {
          userId: req.user.id,
          username: req.user.username,
          updatedKeys: updates
        });

        res.json({
          success: true,
          message: 'Configuración guardada correctamente',
          updatedKeys: updates
        });
      } catch (error) {
        // Revertir transacción en caso de error
        await this.dbConnection.rollback();
        throw error;
      }
    } catch (error) {
      logger.apiError('PUT', '/api/config', error, req.user?.id);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Obtiene solo los límites del sistema (público para todos los usuarios autenticados)
   * Usado para validar recetas sin necesidad de permisos de admin
   */
  async getSystemLimits(req, res) {
    try {
      // Verificar conexión a la base de datos
      if (!this.dbConnection) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      try {
        await this.ensureDatabaseConnection();
      } catch (dbError) {
        return res.status(503).json({
          success: false,
          message: 'Error de conexión con la base de datos'
        });
      }

      // Obtener solo las configuraciones de límites
      const [rows] = await this.dbConnection.execute(
        `SELECT config_key, config_value, config_type 
         FROM system_config 
         WHERE config_key IN ('max_velocity_y', 'max_velocity_z', 'max_accel_y', 'max_accel_z', 'humidity_offset', 'temperature_offset')
         ORDER BY config_key`
      );

      // Convertir a objeto plano
      const limits = {};
      rows.forEach(row => {
        let value = row.config_value;
        if (row.config_type === 'number') {
          value = parseFloat(value) || 0;
        }
        limits[row.config_key] = value;
      });

      res.json({
        success: true,
        limits: limits
      });
    } catch (error) {
      logger.apiError('GET', '/api/config/limits', error, req.user?.id);
      res.status(500).json({
        success: false,
        error: error.message
      });
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
