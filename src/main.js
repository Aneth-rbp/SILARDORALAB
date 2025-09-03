const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const { SerialPort } = require('serialport');

class SilarSystem {
  constructor() {
    this.mainWindow = null;
    this.server = null;
    this.io = null;
    this.dbConnection = null;
    this.arduinoPort = null;
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
      next();
    } catch (error) {
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
    app.use(express.static(path.join(__dirname, 'public')));

    // Rutas API
    app.post('/api/auth/login', this.loginUser.bind(this));
    app.get('/api/recipes', this.authenticateToken.bind(this), this.getRecipes.bind(this));
    app.post('/api/recipes', this.authenticateToken.bind(this), this.saveRecipe.bind(this));
    app.put('/api/recipes/:id', this.authenticateToken.bind(this), this.updateRecipe.bind(this));
    app.delete('/api/recipes/:id', this.authenticateToken.bind(this), this.deleteRecipe.bind(this));
    app.get('/api/system/status', this.getSystemStatus.bind(this));
    app.post('/api/process/start', this.startProcess.bind(this));
    app.post('/api/process/stop', this.stopProcess.bind(this));

    this.server.listen(3000, () => {
      console.log('Servidor interno ejecutándose en puerto 3000');
    });

    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Cliente conectado');
      
      socket.on('arduino-command', (data) => {
        this.sendToArduino(data);
      });

      socket.on('disconnect', () => {
        console.log('Cliente desconectado');
      });
    });
  }

  async initDatabase() {
    try {
      this.dbConnection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'silar_db'
      });
      console.log('Conexión a MySQL establecida');
    } catch (error) {
      console.error('Error conectando a MySQL:', error);
    }
  }

  async initArduino() {
    try {
      // Buscar puerto Arduino automáticamente
      const ports = await SerialPort.list();
      const arduinoPort = ports.find(port => 
        port.manufacturer && 
        (port.manufacturer.includes('Arduino') || 
         port.manufacturer.includes('USB-SERIAL'))
      );

      if (arduinoPort) {
        this.arduinoPort = new SerialPort({
          path: arduinoPort.path,
          baudRate: 9600
        });

        this.arduinoPort.on('data', (data) => {
          this.io.emit('arduino-data', data.toString());
        });

        console.log('Arduino conectado en:', arduinoPort.path);
      }
    } catch (error) {
      console.error('Error conectando Arduino:', error);
    }
  }

  sendToArduino(command) {
    if (this.arduinoPort && this.arduinoPort.isOpen) {
      this.arduinoPort.write(command);
    }
  }

  async loginUser(req, res) {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ 
          success: false, 
          message: 'Usuario y contraseña requeridos' 
        });
      }

      // Buscar usuario en la base de datos
      const [rows] = await this.dbConnection.execute(
        'SELECT id, username, password, full_name, role, email, is_active FROM users WHERE username = ? AND is_active = 1',
        [username]
      );

      if (rows.length === 0) {
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
      console.error('Error en login:', error);
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
      
      console.log('Datos obtenidos de la BD:', rows.length, 'recetas');
      if (rows.length > 0) {
        console.log('Primera receta raw:', {
          id: rows[0].id,
          name: rows[0].name,
          duration: rows[0].duration,
          temperature: rows[0].temperature,
          velocity_x: rows[0].velocity_x
        });
      }
      
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
      
      console.log('Datos formateados enviados al frontend:', formattedRows.length, 'recetas');
      if (formattedRows.length > 0) {
        console.log('Primera receta formateada:', {
          id: formattedRows[0].id,
          name: formattedRows[0].name,
          parameters: formattedRows[0].parameters
        });
      }
      
      res.json(formattedRows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async saveRecipe(req, res) {
    try {
      const { name, description, type, parameters } = req.body;
      
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
      console.error('Error saving recipe:', error);
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
      
      // Verificar que la receta existe
      const [existingRecipe] = await this.dbConnection.execute(
        'SELECT * FROM recipes WHERE id = ? AND is_active = 1',
        [id]
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
            id 
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
            id,
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
        
        res.json({ 
          success: true, 
          message: 'Receta actualizada correctamente',
          updatedRecipe: {
            id: parseInt(id),
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
      console.error('Error updating recipe:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  async deleteRecipe(req, res) {
    try {
      const { id } = req.params;
      
      // Verificar que la receta existe
      const [existingRecipe] = await this.dbConnection.execute(
        'SELECT * FROM recipes WHERE id = ? AND is_active = 1',
        [id]
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
        return res.status(403).json({ 
          success: false, 
          message: 'No tiene permisos para eliminar esta receta' 
        });
      }
      
      // Eliminar la receta (soft delete)
      await this.dbConnection.execute(
        'UPDATE recipes SET is_active = 0, deleted_at = NOW() WHERE id = ?',
        [id]
      );
      
      res.json({ 
        success: true, 
        message: 'Receta eliminada correctamente' 
      });
    } catch (error) {
      console.error('Error deleting recipe:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  async getSystemStatus(req, res) {
    res.json({
      arduino: this.arduinoPort ? this.arduinoPort.isOpen : false,
      database: this.dbConnection ? true : false,
      timestamp: new Date().toISOString()
    });
  }

  async startProcess(req, res) {
    try {
      const { recipeId } = req.body;
      // Lógica para iniciar proceso
      this.sendToArduino('START_PROCESS');
      res.json({ success: true, message: 'Proceso iniciado' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async stopProcess(req, res) {
    try {
      this.sendToArduino('STOP_PROCESS');
      res.json({ success: true, message: 'Proceso detenido' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      fullscreen: true, // Para pantalla táctil
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      show: false
    });

    this.mainWindow.loadURL('http://localhost:3000');

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  async initialize() {
    await this.initDatabase();
    await this.initArduino();
    this.createWindow();
  }
}

const silarSystem = new SilarSystem();

app.whenReady().then(() => {
  silarSystem.initialize();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    silarSystem.createWindow();
  }
});
