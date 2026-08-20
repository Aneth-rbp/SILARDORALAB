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
const actualizadorFirmware = require('./src/firmware/actualizador');
const migraciones = require('./src/database/migraciones');

class SilarWebServer {
  // Mismo tope que MAX_ETAPAS en el firmware. Si aquí fuera mayor, la receta se
  // guardaría entera y el Arduino rechazaría las etapas sobrantes en mitad de
  // la carga, con la receta ya a medio mandar.
  static MAX_STAGES = 8;

  // Límite de velocidad de una receta, en mm/s, cuando no hay configuración que
  // leer. Es el mismo valor que siembra la migración 008 en max_transfer_speed
  // y max_dip_speed, para que una base a medio migrar se comporte igual que una
  // al día. Lo que la mecánica da de verdad es otra cosa y la sabe el firmware:
  // MAX_SPEED_Y y MAX_SPEED_Z valen 2000 pasos/s, que con los pasos/mm de cada
  // eje son unos 26 mm/s en Y y 100 en Z. Pedir más de eso no rompe nada, el
  // firmware recorta y lo avisa por el puerto serie.
  static LIMITE_VELOCIDAD_POR_DEFECTO_MMS = 50;

  constructor() {
    this.server = null;
    this.io = null;
    this.dbConnection = null;
    this.arduinoController = getInstance();
    this.isReconnecting = false;
    this.systemConfigCache = {};
    this.lastArduinoConfig = null;
    // Etapa en curso de una receta por etapas. Se guarda para poder contársela
    // a un cliente que se conecte a mitad de la corrida: el Arduino solo la
    // anuncia una vez, al entrar en ella, y recargar la pantalla no debe dejar
    // al operador sin saber en qué punto de la secuencia va.
    this.currentStage = null;
    // Ciclo en curso segun el Arduino: { cycle, totalCycles }. Vive en memoria
    // porque el firmware es el unico que sabe por donde va; la base solo guarda
    // el total de la receta.
    this.currentCycle = null;
    // Si la receta en curso pidió volver a home al completarse. Se toma de
    // recipes.return_home_at_end al arrancar y solo se usa cuando la corrida
    // termina sola: un STOP o un paro de emergencia no mueven nada más, porque
    // ahí el operador está interviniendo la máquina.
    this.regresarAHomeAlTerminar = false;
    // Reconciliación del estado del proceso contra la placa. El Arduino manda
    // ProcessActive/ProcessPaused en cada STATUS (cada 500 ms) y esa es la
    // verdad: los mensajes sueltos (PROCESO_PAUSADO, PROCESO_COMPLETADO) se
    // pierden si la placa se desconecta o si llegan fuera de orden.
    this.procesoConfirmadoPorArduino = false;
    this.lecturasProcesoInactivo = 0;
    // Hasta cuándo se le concede a la placa el beneficio de la duda para
    // reclamar un proceso que quedó abierto de una ejecución anterior.
    this.plazoAdopcionHuerfanos = 0;
    this.ultimaReconciliacion = 0;
    // Cola de arranques de proceso. Ver conArranqueEnExclusiva().
    this.colaDeArranque = Promise.resolve();
    this.setupExpress();
  }

  /**
   * Serializa los arranques de proceso: mientras uno esté en curso, el
   * siguiente espera su turno.
   *
   * Sin esto, dos peticiones simultáneas a /api/process/start consultaban las dos
   * que no había proceso activo antes de que ninguna hubiera insertado el suyo,
   * y las dos arrancaban: dos filas en 'running' y dos recetas mandadas a la
   * misma placa. La comprobación y el INSERT tienen que ser un solo paso.
   *
   * El turno se conserva hasta que la receta está cargada en el Arduino, no
   * sólo hasta el INSERT: una receta por etapas viaja etapa por etapa y tarda
   * segundos, y durante ese rato la máquina tampoco está libre.
   *
   * Basta con una exclusión dentro del proceso porque este servidor es el único
   * que escribe en processes y el único que habla con la placa.
   */
  async conArranqueEnExclusiva(tarea) {
    const turnoAnterior = this.colaDeArranque;
    let liberar;
    this.colaDeArranque = new Promise((resolve) => { liberar = resolve; });

    // El turno anterior nunca rechaza (siempre se libera en su finally), pero
    // se encadena con catch por si acaso: una promesa rota aquí dejaría la cola
    // atascada y no se podría volver a arrancar nada.
    await turnoAnterior.catch(() => {});

    try {
      return await tarea();
    } finally {
      liberar();
    }
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
      res.json = function (data) {
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
    app.get('/api/system/busy', this.getSystemBusy.bind(this));
    app.get('/api/process/status', this.authenticateToken.bind(this), this.getProcessStatus.bind(this));
    app.post('/api/process/start', this.authenticateToken.bind(this), this.startProcess.bind(this));
    app.post('/api/process/pause', this.authenticateToken.bind(this), this.pauseProcess.bind(this));
    app.post('/api/process/resume', this.authenticateToken.bind(this), this.resumeProcess.bind(this));
    app.post('/api/process/stop', this.authenticateToken.bind(this), this.stopProcess.bind(this));

    // Rutas API Configuración (solo admin)
    app.get('/api/config', this.authenticateToken.bind(this), this.getSystemConfig.bind(this));
    app.put('/api/config', this.authenticateToken.bind(this), this.updateSystemConfig.bind(this));

    // Rutas API Usuarios (solo admin)
    app.get('/api/users', this.authenticateToken.bind(this), this.getUsers.bind(this));
    app.post('/api/users', this.authenticateToken.bind(this), this.createUser.bind(this));
    app.put('/api/users/:id', this.authenticateToken.bind(this), this.updateUser.bind(this));
    app.delete('/api/users/:id', this.authenticateToken.bind(this), this.deleteUser.bind(this));

    // Ruta pública para leer límites del sistema (todos los usuarios autenticados)
    app.get('/api/config/limits', this.authenticateToken.bind(this), this.getSystemLimits.bind(this));

    // Rutas API Arduino
    app.get('/api/arduino/ports', this.getArduinoPorts.bind(this));
    app.post('/api/arduino/connect', this.connectArduino.bind(this));
    app.post('/api/arduino/disconnect', this.disconnectArduino.bind(this));
    app.get('/api/arduino/state', this.getArduinoState.bind(this));
    app.post('/api/arduino/command', this.sendArduinoCommand.bind(this));

    // Rutas API de calibración del eje Z (solo administradores).
    // Van autenticadas a diferencia del resto de /api/arduino porque escriben
    // en la EEPROM de la máquina y una escala mal puesta puede estrellar el eje.
    app.get('/api/arduino/calibration/z', this.authenticateToken.bind(this), this.getZCalibration.bind(this));
    app.put('/api/arduino/calibration/z', this.authenticateToken.bind(this), this.updateZCalibration.bind(this));
    app.post('/api/arduino/calibration/z/save', this.authenticateToken.bind(this), this.saveZCalibration.bind(this));
    app.post('/api/arduino/calibration/z/reset', this.authenticateToken.bind(this), this.resetZCalibration.bind(this));
    app.post('/api/arduino/calibration/z/goto', this.authenticateToken.bind(this), this.gotoZHeight.bind(this));
    app.post('/api/arduino/calibration/z/jog', this.authenticateToken.bind(this), this.jogZCalibration.bind(this));
    app.post('/api/arduino/calibration/z/home', this.authenticateToken.bind(this), this.homeZCalibration.bind(this));

    // Geometría del eje Y: separación entre vasos y escala del eje.
    app.get('/api/arduino/calibration/y', this.authenticateToken.bind(this), this.getYCalibration.bind(this));
    app.put('/api/arduino/calibration/y', this.authenticateToken.bind(this), this.updateYCalibration.bind(this));
    app.post('/api/arduino/calibration/y/save', this.authenticateToken.bind(this), this.saveYCalibration.bind(this));
    app.post('/api/arduino/calibration/y/reset', this.authenticateToken.bind(this), this.resetYCalibration.bind(this));
    app.post('/api/arduino/calibration/y/jog', this.authenticateToken.bind(this), this.jogYCalibration.bind(this));
    app.post('/api/arduino/calibration/y/home', this.authenticateToken.bind(this), this.homeYCalibration.bind(this));

    // Rutas API Flash Arduino. Grabar la placa la reinicia, asi que pide sesion;
    // no se exige rol de administrador para que el operador de turno pueda
    // actualizar el firmware al abrir el sistema sin depender de nadie.
    app.get('/api/arduino/flash/info', this.authenticateToken.bind(this), this.getFlashInfo.bind(this));
    app.post('/api/arduino/flash', this.authenticateToken.bind(this), this.flashArduino.bind(this));
    app.get('/api/arduino/flash/verify', this.authenticateToken.bind(this), this.verifyFirmware.bind(this));

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

      // Y los parámetros del proceso en curso, para que recargar la página no
      // deje las tarjetas de monitoreo vacías
      this.sendRunningProcessParameters(socket);

      // La etapa en curso, si la corrida es por etapas
      if (this.currentStage) {
        socket.emit('process-stage', this.currentStage);
      }

      // Y el ciclo en curso, para que recargar la pantalla no borre el contador
      if (this.currentCycle) {
        socket.emit('process-cycle', this.currentCycle);
      }

      // Constantes de la máquina (CONFIG): el Arduino sólo las manda al arrancar
      if (this.lastArduinoConfig) {
        socket.emit('arduino-data', this.lastArduinoConfig);
      }

      // Manejar comandos Arduino desde el cliente
      socket.on('arduino-command', async (data) => {
        try {
          logger.info('Comando Arduino recibido', { command: data, socketId: socket.id });
          const { command, params } = data;
          let result;

          switch (command) {
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

  /**
   * Emite a un socket los parámetros del proceso que esté corriendo.
   * Los parámetros se guardan como JSON en processes.parameters al iniciar.
   */
  async sendRunningProcessParameters(socket) {
    try {
      if (!this.dbConnection) return;

      const [rows] = await this.dbConnection.execute(
        `SELECT parameters FROM processes WHERE status = 'running' ORDER BY start_time DESC, id DESC LIMIT 1`
      );

      if (rows.length === 0 || !rows[0].parameters) return;

      const parameters = typeof rows[0].parameters === 'string'
        ? JSON.parse(rows[0].parameters)
        : rows[0].parameters;

      socket.emit('process-parameters', parameters);
    } catch (error) {
      logger.error('Error enviando parámetros del proceso en curso:', error);
    }
  }

  setupArduinoEventForwarding() {
    // Datos parseados del Arduino
    this.arduinoController.on('data', (parsed) => {
      // APLICAR OFFSETS DE SENSORES SI EXISTEN
      if (parsed.type === 'sensors') {
        if (parsed.envTemp !== undefined && this.systemConfigCache.temperature_offset) {
          parsed.envTemp += parseFloat(this.systemConfigCache.temperature_offset);
        }
        if (parsed.envHumidity !== undefined && this.systemConfigCache.humidity_offset) {
          parsed.envHumidity += parseFloat(this.systemConfigCache.humidity_offset);
        }
      }

      // El firmware sólo envía CONFIG al arrancar; se guarda para poder
      // reenviarlo a los clientes que se conecten después
      if (parsed.type === 'config') {
        this.lastArduinoConfig = parsed;
      }

      this.io.emit('arduino-data', parsed);
      logger.debug('Arduino data broadcast with offsets applied', { type: parsed.type });

      // Avance de una receta por etapas
      if (parsed.type === 'stage') {
        if (parsed.event === 'started') {
          this.currentStage = {
            stage: parsed.stage,
            totalStages: parsed.totalStages,
            cycles: parsed.cycles
          };
          this.io.emit('process-stage', this.currentStage);
        }
        logger.info(`Receta por etapas: etapa ${parsed.stage}/${parsed.totalStages} ${parsed.event}`);
      }

      // Avance de ciclos dentro de la corrida
      if (parsed.type === 'cycle') {
        this.currentCycle = {
          cycle: parsed.cycle,
          totalCycles: parsed.totalCycles,
          event: parsed.event
        };
        this.io.emit('process-cycle', this.currentCycle);
      }

      // Sincronizar estado del proceso en la base de datos basado en mensajes de control del Arduino
      if (parsed.type === 'message' && parsed.raw) {
        if (parsed.raw.startsWith('PROCESO_COMPLETADO')) {
          this.currentStage = null;
          this.currentCycle = null;
          this.markProcessState('completed');
          this.regresarAHomeSiLaRecetaLoPidio();
        } else if (parsed.raw.startsWith('PROCESO_DETENIDO') || parsed.raw.startsWith('PROCESO_ABORTADO')) {
          this.currentStage = null;
          this.currentCycle = null;
          this.regresarAHomeAlTerminar = false;
          this.markProcessState('cancelled', 'Detenido por Arduino');
        } else if (parsed.raw.startsWith('PROCESO_PAUSADO')) {
          this.markProcessState('paused');
        } else if (parsed.raw.startsWith('PROCESO_REANUDADO')) {
          // Sin esto la base se quedaba en 'paused' para siempre: se marcaba la
          // pausa pero nadie marcaba la vuelta. Tras varios pausar/reanudar el
          // estado real y el guardado dejaban de coincidir.
          this.markProcessState('running');
        }
      }

      // El paro de emergencia aborta la receta en el firmware (procesoActivo
      // pasa a false) y ahí se acaban los avisos: no se imprime ningún
      // PROCESO_DETENIDO. Sin esto la fila quedaba 'running' para siempre y
      // bloqueaba el arranque de la siguiente receta.
      if (parsed.type === 'emergency' && parsed.active) {
        this.currentStage = null;
        this.currentCycle = null;
        this.regresarAHomeAlTerminar = false;
        this.io.emit('process-stage', null);
        this.io.emit('process-cycle', null);
        this.markProcessState('cancelled', 'Paro de emergencia');
      }

      // La verdad del estado la tiene la placa, no los mensajes sueltos
      if (parsed.type === 'status') {
        this.reconciliarProcesoConArduino(parsed);
      }
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

  async markProcessState(newState, reason = null) {
    try {
      if (!this.dbConnection) return;
      await this.ensureDatabaseConnection();
      
      const [runningProcesses] = await this.dbConnection.execute(
        `SELECT id, status, start_time FROM processes WHERE status IN ('running', 'paused') ORDER BY start_time DESC, id DESC LIMIT 1`
      );
      
      if (runningProcesses.length > 0) {
        const process = runningProcesses[0];

        // Ya está como se pide: no reescribir ni volver a avisar a los clientes.
        // Con el reconciliador corriendo dos veces por segundo esto evita un
        // UPDATE y un broadcast por cada lectura del Arduino.
        if (process.status === newState) return;
        
        if (newState === 'completed' || newState === 'cancelled') {
          const durationMinutes = process.start_time
            ? Math.max(1, Math.floor((Date.now() - new Date(process.start_time).getTime()) / 60000))
            : 0;
            
          await this.dbConnection.execute(
            `UPDATE processes SET status = ?, end_time = NOW(), duration_minutes = ?, error_message = ? WHERE id = ?`,
            [newState, durationMinutes, reason, process.id]
          );
        } else if (newState === 'paused' || newState === 'running') {
          await this.dbConnection.execute(
            `UPDATE processes SET status = ? WHERE id = ?`,
            [newState, process.id]
          );
        } else {
          return;
        }
        
        logger.info(`Proceso ${process.id} marcado como ${newState} en la base de datos automáticamente.`);
        
        // Notificar a los clientes WebSocket
        this.io.emit('process-status-update', { status: newState, processId: process.id });
      }
    } catch (error) {
      logger.error(`Error al marcar proceso como ${newState}:`, error);
    }
  }

  /**
   * Manda los ejes a home cuando la receta que acaba de completarse lo pidió
   * (recipes.return_home_at_end).
   *
   * Solo se llama desde PROCESO_COMPLETADO: si el operador detuvo el proceso o
   * saltó el paro de emergencia, la máquina se queda quieta. Mover los ejes
   * justo después de una intervención manual es la peor forma de sorprender a
   * quien tiene las manos dentro del equipo.
   *
   * No se espera al resultado en el manejador del puerto serie: el HOME tarda
   * lo que tarde y el resto de los mensajes de la placa tienen que seguir
   * procesándose mientras tanto.
   */
  regresarAHomeSiLaRecetaLoPidio() {
    if (!this.regresarAHomeAlTerminar) return;

    // Se apaga antes de lanzarlo para que no se repita si llegan dos
    // PROCESO_COMPLETADO seguidos.
    this.regresarAHomeAlTerminar = false;

    logger.info('Receta completada: la receta pide regresar a home, ejecutando HOME');
    this.io.emit('arduino-data', {
      type: 'message',
      raw: 'Receta completada: regresando a home'
    });

    this.arduinoController.executeHome()
      .then(() => logger.info('HOME automático de fin de receta completado'))
      .catch((error) => {
        // Que falle el home no invalida la corrida, que ya terminó bien.
        logger.error('No se pudo ejecutar el HOME automático de fin de receta', { error: error.message });
        this.io.emit('arduino-data', {
          type: 'message',
          raw: `No se pudo regresar a home automaticamente: ${error.message}`
        });
      });
  }

  /**
   * Ajusta el estado guardado al que reporta la placa en cada STATUS.
   *
   * Antes el estado se llevaba solo con los mensajes sueltos que manda el
   * firmware al cambiar de situación, y eso fallaba de dos maneras. Al pausar y
   * reanudar seguido, el PROCESO_PAUSADO podía llegar después del UPDATE de
   * reanudar (el firmware sólo mira el puerto entre paso y paso del motor) y
   * dejaba la base en 'paused' con la máquina corriendo. Y cuando el proceso
   * terminaba de una forma que no imprime nada -paro de emergencia, cable
   * desconectado, la app cerrada a media corrida- la fila se quedaba en
   * 'running' para siempre, bloqueando el inicio de la siguiente receta.
   *
   * ProcessActive/ProcessPaused vienen en cada STATUS, así que sirven de
   * corrección continua: como mucho el estado guardado va medio segundo por
   * detrás del real.
   */
  async reconciliarProcesoConArduino(status) {
    if (status.processActive === undefined) return;

    // El STATUS llega cada 500 ms y cada reconciliacion consulta la base. Con
    // una vez por segundo sobra: el peor caso es que el estado guardado vaya un
    // segundo por detras del real, y a cambio no se golpea MySQL sin motivo.
    const ahora = Date.now();
    if (ahora - this.ultimaReconciliacion < 1000) return;
    this.ultimaReconciliacion = ahora;

    if (status.processActive) {
      // La placa reclama el proceso: a partir de aquí su silencio sí significa
      // que terminó. Vale también para adoptar una corrida que sobrevivió a un
      // reinicio del servidor.
      this.procesoConfirmadoPorArduino = true;
      this.lecturasProcesoInactivo = 0;
      await this.markProcessState(status.processPaused ? 'paused' : 'running');
      return;
    }

    // Sin proceso en la placa. Hay dos momentos en que eso es normal y no debe
    // cerrar nada: entre el INSERT del proceso y el RECIPE_START (la receta
    // viaja etapa por etapa y tarda), y el instante justo después de arrancar
    // el servidor, cuando todavía no sabemos si la placa sigue trabajando.
    if (!this.procesoConfirmadoPorArduino) {
      if (this.plazoAdopcionHuerfanos === 0) return;
      if (Date.now() < this.plazoAdopcionHuerfanos) return;
    }

    // Se piden varias lecturas seguidas para no cerrar el proceso por un STATUS
    // suelto llegado a destiempo.
    this.lecturasProcesoInactivo++;
    if (this.lecturasProcesoInactivo < 6) return;
    this.lecturasProcesoInactivo = 0;
    this.procesoConfirmadoPorArduino = false;
    this.plazoAdopcionHuerfanos = 0;

    this.currentStage = null;
    this.currentCycle = null;
    this.regresarAHomeAlTerminar = false;
    this.io.emit('process-stage', null);
    this.io.emit('process-cycle', null);
    await this.markProcessState('cancelled', 'La placa dejó de reportar el proceso');
  }

  /**
   * Al arrancar puede haber recetas en 'running' o 'paused' de una ejecución
   * anterior. No se cierran de golpe porque el Arduino es independiente del PC
   * y puede seguir corriendo la receta tras un reinicio de la aplicación: se le
   * da un plazo para reclamarla en reconciliarProcesoConArduino(). Si no la
   * reclama -o si ni siquiera hay placa conectada- se cierran, porque una fila
   * abierta para siempre impide iniciar la siguiente receta y deja al updater
   * viendo el equipo ocupado de por vida.
   */
  async adoptarProcesosHuerfanos(plazoMs = 30000) {
    try {
      if (!this.dbConnection) return;
      await this.ensureDatabaseConnection();

      const [huerfanos] = await this.dbConnection.execute(
        `SELECT id, process_number, status FROM processes WHERE status IN ('running', 'paused')`
      );

      if (huerfanos.length === 0) return;

      logger.warn(`Procesos abiertos de una ejecución anterior: ${huerfanos.map(pr => pr.process_number).join(', ')}. Esperando a que el Arduino los reclame.`);
      this.procesoConfirmadoPorArduino = false;
      this.lecturasProcesoInactivo = 0;
      this.plazoAdopcionHuerfanos = Date.now() + plazoMs;

      setTimeout(async () => {
        if (this.procesoConfirmadoPorArduino) return;
        this.plazoAdopcionHuerfanos = 0;
        try {
          if (!this.dbConnection) return;
          const [pendientes] = await this.dbConnection.execute(
            `UPDATE processes
                SET status = 'cancelled',
                    end_time = NOW(),
                    duration_minutes = COALESCE(TIMESTAMPDIFF(MINUTE, start_time, NOW()), 0),
                    error_message = 'Interrumpido: la aplicación se cerró durante la corrida'
              WHERE status IN ('running', 'paused')`
          );
          if (pendientes.affectedRows > 0) {
            logger.warn(`${pendientes.affectedRows} proceso(s) cerrado(s): el Arduino no los reclamó.`);
            this.currentStage = null;
            this.currentCycle = null;
            this.io.emit('process-stage', null);
            this.io.emit('process-cycle', null);
            this.io.emit('process-status-update', { status: 'cancelled', processId: null });
          }
        } catch (error) {
          logger.error('Error cerrando procesos huérfanos:', error);
        }
      }, plazoMs);
    } catch (error) {
      logger.error('Error revisando procesos huérfanos al arrancar:', error);
    }
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
        port: config.database.port,
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
      // Detalle accionable para diagnosticar a distancia el equipo del
      // laboratorio, sin exponer la contraseña en el log
      logger.error('No se pudo conectar a MySQL', {
        servidor: `${config.database.host}:${config.database.port}`,
        usuario: config.database.user,
        baseDeDatos: config.database.database,
        conPassword: config.database.password !== '',
        code: error.code
      });
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
        'SELECT id, username, password, full_name, role, is_active FROM users WHERE username = ? AND is_active = 1',
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
          role: user.role
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

  /**
   * Convierte una fila de recipe_stages (o de recipe_parameters) al mismo
   * objeto camelCase que el frontend y el ArduinoController ya esperan.
   *
   * Es el mismo juego de campos para una etapa que para una receta normal: una
   * etapa ES una receta normal, solo que encadenada con otras. Si aquí faltara
   * un campo, esa etapa correría con el default del firmware en vez de con lo
   * que el operador escribió, y sin ningún error visible.
   */
  mapRecipeParameterRow(row) {
    return {
      duration: Number(row.duration) || 0,
      temperature: Number(row.temperature) || 0,
      velocityX: Number(row.velocity_x) || 0,
      velocityY: Number(row.velocity_y) || 0,
      accelX: Number(row.accel_x) || 0,
      accelY: Number(row.accel_y) || 0,
      humidityOffset: Number(row.humidity_offset) || 0,
      temperatureOffset: Number(row.temperature_offset) || 0,
      dippingWait0: Number(row.dipping_wait0) || 0,
      dippingWait1: Number(row.dipping_wait1) || 0,
      dippingWait2: Number(row.dipping_wait2) || 0,
      dippingWait3: Number(row.dipping_wait3) || 0,
      transferWait: Number(row.transfer_wait) || 0,
      transitionWait: Number(row.transition_wait) || 0,
      cycles: Number(row.cycles) || 1,
      fan: !!row.fan,
      exceptDripping1: !!row.except_dripping1,
      exceptDripping2: !!row.except_dripping2,
      exceptDripping3: !!row.except_dripping3,
      exceptDripping4: !!row.except_dripping4,
      dipStartPosition: Number(row.dip_start_position) || 0,
      dippingLength: Number(row.dipping_length) || 0,
      transferSpeed: Number(row.transfer_speed) || 0,
      dipSpeed: Number(row.dip_speed) || 0,
      // 0 = subir a la misma velocidad de bajada (comportamiento anterior)
      emersionSpeed: Number(row.emersion_speed) || 0,
      posY1: Number(row.pos_y1) || 0,
      posY2: Number(row.pos_y2) || 0,
      posY3: Number(row.pos_y3) || 0,
      posY4: Number(row.pos_y4) || 0
    };
  }

  /**
   * Lee las etapas de una o varias recetas, en orden de ejecución.
   * Se consulta de una sola vez para todas las recetas del listado: una consulta
   * por receta convertiría abrir la pantalla en decenas de viajes a la base.
   */
  async getStagesForRecipes(recipeIds) {
    const porReceta = new Map();
    if (!recipeIds || recipeIds.length === 0) return porReceta;

    const marcadores = recipeIds.map(() => '?').join(', ');
    const [rows] = await this.dbConnection.execute(
      `SELECT * FROM recipe_stages WHERE recipe_id IN (${marcadores}) ORDER BY recipe_id, stage_order`,
      recipeIds
    );

    for (const row of rows) {
      if (!porReceta.has(row.recipe_id)) porReceta.set(row.recipe_id, []);
      porReceta.get(row.recipe_id).push({
        id: row.id,
        stageOrder: Number(row.stage_order),
        name: row.name || '',
        ...this.mapRecipeParameterRow(row)
      });
    }

    return porReceta;
  }

  /**
   * Valores de una etapa listos para el INSERT, en el orden de STAGE_COLUMNS.
   */
  stageValues(recipeId, orden, etapa) {
    return [
      recipeId,
      orden,
      etapa?.name || null,
      etapa?.duration || 0,
      etapa?.temperature || 0,
      etapa?.velocityX || 0,
      etapa?.velocityY || 0,
      etapa?.accelX || 0,
      etapa?.accelY || 0,
      etapa?.humidityOffset || 0,
      etapa?.temperatureOffset || 0,
      etapa?.dippingWait0 || 0,
      etapa?.dippingWait1 || 0,
      etapa?.dippingWait2 || 0,
      etapa?.dippingWait3 || 0,
      etapa?.transferWait || 0,
      etapa?.transitionWait || 0,
      etapa?.cycles || 1,
      etapa?.fan ? 1 : 0,
      etapa?.exceptDripping1 ? 1 : 0,
      etapa?.exceptDripping2 ? 1 : 0,
      etapa?.exceptDripping3 ? 1 : 0,
      etapa?.exceptDripping4 ? 1 : 0,
      etapa?.dipStartPosition || 0,
      etapa?.dippingLength || 0,
      etapa?.transferSpeed || 0,
      etapa?.dipSpeed || 0,
      etapa?.emersionSpeed || 0,
      etapa?.posY1 || 0,
      etapa?.posY2 || 0,
      etapa?.posY3 || 0,
      etapa?.posY4 || 0
    ];
  }

  /**
   * Reemplaza por completo la lista de etapas de una receta.
   * Se borra y se vuelve a insertar en vez de actualizar fila por fila porque
   * el operador puede reordenar, quitar o insertar etapas en medio: casar filas
   * viejas con nuevas sería adivinar, y una etapa huérfana correría de verdad.
   * Va siempre dentro de la transacción de quien llama.
   */
  async replaceRecipeStages(recipeId, etapas) {
    await this.dbConnection.execute('DELETE FROM recipe_stages WHERE recipe_id = ?', [recipeId]);

    const columnas = `recipe_id, stage_order, name, duration, temperature, velocity_x, velocity_y,
       accel_x, accel_y, humidity_offset, temperature_offset,
       dipping_wait0, dipping_wait1, dipping_wait2, dipping_wait3, transfer_wait, transition_wait,
       cycles, fan, except_dripping1, except_dripping2, except_dripping3, except_dripping4,
       dip_start_position, dipping_length, transfer_speed, dip_speed, emersion_speed,
       pos_y1, pos_y2, pos_y3, pos_y4`;
    const marcadores = new Array(32).fill('?').join(', ');

    for (let i = 0; i < etapas.length; i++) {
      await this.dbConnection.execute(
        `INSERT INTO recipe_stages (${columnas}) VALUES (${marcadores})`,
        this.stageValues(recipeId, i + 1, etapas[i])
      );
    }
  }

  /**
   * Resumen de una receta por etapas, con la forma de una receta normal.
   *
   * Una receta por etapas también guarda su fila en recipe_parameters. No es
   * duplicación por comodidad: el listado de recetas, la vista
   * v_recipes_with_parameters y el historial de procesos leen de ahí, y sin
   * resumen una receta por etapas aparecería con la duración y los ciclos
   * vacíos en todas esas pantallas. La duración y los ciclos se suman; el resto
   * se toma de la primera etapa, que es con lo que arranca la corrida.
   */
  buildStagedSummary(etapas) {
    const primera = etapas[0] || {};
    return {
      ...primera,
      name: undefined,
      // El resumen se valida con las mismas reglas que una receta normal, y
      // ahí duration tiene un tope de 999 minutos. Sumando ocho etapas largas se
      // puede pasar, y el guardado fallaría con un error sobre un campo que el
      // operador no escribió: se recorta, que solo afecta a la estimación.
      duration: Math.min(999, etapas.reduce((total, e) => total + (Number(e.duration) || 0), 0)),
      cycles: etapas.reduce((total, e) => total + (Number(e.cycles) || 0), 0)
    };
  }

  /**
   * Saca las etapas del cuerpo de la petición y comprueba que sirven.
   * Devuelve { esPorEtapas, etapas, error }.
   */
  extractStages(body) {
    const esPorEtapas = body.isStaged === true || body.isStaged === 'true' || body.isStaged === 1;
    if (!esPorEtapas) return { esPorEtapas: false, etapas: [] };

    const etapas = Array.isArray(body.stages) ? body.stages : [];

    if (etapas.length === 0) {
      return { esPorEtapas, etapas, error: 'Una receta por etapas necesita al menos una etapa' };
    }
    if (etapas.length > SilarWebServer.MAX_STAGES) {
      return {
        esPorEtapas, etapas,
        error: `Una receta admite como máximo ${SilarWebServer.MAX_STAGES} etapas`
      };
    }
    for (let i = 0; i < etapas.length; i++) {
      const validacion = validator.validateParameters(etapas[i]);
      if (!validacion.isValid) {
        const detalle = Object.entries(validacion.errors)
          .map(([campo, mensajes]) => `${campo}: ${mensajes.join(', ')}`)
          .join('; ');
        return { esPorEtapas, etapas, error: `Etapa ${i + 1} -> ${detalle}` };
      }
    }

    return { esPorEtapas, etapas };
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
                 rp.dipping_wait0, rp.dipping_wait1, rp.dipping_wait2, rp.dipping_wait3, rp.transfer_wait, rp.transition_wait,
                 rp.cycles, rp.fan, rp.except_dripping1, rp.except_dripping2, rp.except_dripping3, rp.except_dripping4,
                 rp.dip_start_position, rp.dipping_length, rp.transfer_speed, rp.dip_speed, rp.emersion_speed,
                 rp.pos_y1, rp.pos_y2, rp.pos_y3, rp.pos_y4
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
                 rp.dipping_wait0, rp.dipping_wait1, rp.dipping_wait2, rp.dipping_wait3, rp.transfer_wait, rp.transition_wait,
                 rp.cycles, rp.fan, rp.except_dripping1, rp.except_dripping2, rp.except_dripping3, rp.except_dripping4,
                 rp.dip_start_position, rp.dipping_length, rp.transfer_speed, rp.dip_speed, rp.emersion_speed,
                 rp.pos_y1, rp.pos_y2, rp.pos_y3, rp.pos_y4
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
          transitionWait: row.transition_wait || 0,
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
          dipSpeed: row.dip_speed || 0,
          // 0 = subir a la misma velocidad de bajada
          emersionSpeed: row.emersion_speed || 0,
          // Posición de cada vaso, en mm desde el home de Y. 0 = usar la
          // geometría calibrada de la máquina, que es el caso habitual.
          posY1: row.pos_y1 || 0,
          posY2: row.pos_y2 || 0,
          posY3: row.pos_y3 || 0,
          posY4: row.pos_y4 || 0
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

      // Las recetas por etapas llevan además su secuencia. Las normales no
      // pasan por aquí: si ninguna receta del listado es por etapas, no hay
      // consulta extra que hacer.
      const idsPorEtapas = formattedRows.filter(r => r.is_staged).map(r => r.id);
      if (idsPorEtapas.length > 0) {
        const etapasPorReceta = await this.getStagesForRecipes(idsPorEtapas);
        for (const receta of formattedRows) {
          if (receta.is_staged) receta.stages = etapasPorReceta.get(receta.id) || [];
        }
      }

      res.json(formattedRows);
    } catch (error) {
      logger.apiError('GET', '/api/recipes', error, req.user?.id);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Topes de velocidad vigentes, en mm/s: los que el administrador dejó en
   * Configuración. Si la consulta falla o el valor guardado no sirve, se cae al
   * valor por defecto en vez de quedarse sin límite.
   */
  async obtenerLimitesVelocidad() {
    const limites = {
      transferSpeed: SilarWebServer.LIMITE_VELOCIDAD_POR_DEFECTO_MMS,
      dipSpeed: SilarWebServer.LIMITE_VELOCIDAD_POR_DEFECTO_MMS
    };

    try {
      const [rows] = await this.dbConnection.execute(
        `SELECT config_key, config_value FROM system_config
         WHERE config_key IN ('max_transfer_speed', 'max_dip_speed')`
      );

      rows.forEach((row) => {
        const valor = parseFloat(row.config_value);
        if (!(valor > 0)) return;
        if (row.config_key === 'max_transfer_speed') {
          limites.transferSpeed = valor;
        } else if (row.config_key === 'max_dip_speed') {
          limites.dipSpeed = valor;
        }
      });
    } catch (error) {
      logger.warn(`No se pudieron leer los límites de velocidad, se usan ${SilarWebServer.LIMITE_VELOCIDAD_POR_DEFECTO_MMS} mm/s: ${error.message}`);
    }

    return limites;
  }

  /**
   * Revisa las tres velocidades de un juego de parámetros contra los topes.
   * Devuelve el mensaje del primer campo que se pasa, o null si todo cabe.
   *
   * Se comprueba aquí y no solo en la pantalla porque estas tres velocidades
   * son las únicas que llegan al firmware: una receta guardada por encima del
   * tope mueve la máquina de verdad, y el límite lo puso el administrador por
   * seguridad.
   */
  static errorDeVelocidad(parametros, limites, prefijo = '') {
    if (!parametros || typeof parametros !== 'object') return null;

    const campos = [
      ['transferSpeed', 'la velocidad de transferencia Y', limites.transferSpeed],
      ['dipSpeed', 'la velocidad de inmersión Z', limites.dipSpeed],
      // Vacío o 0 = subir a la misma velocidad de la bajada, que ya va validada.
      ['emersionSpeed', 'la velocidad de emersión Z', limites.dipSpeed]
    ];

    for (const [campo, etiqueta, tope] of campos) {
      const valor = parseFloat(parametros[campo]) || 0;
      if (valor > tope) {
        return `${prefijo}${etiqueta} no puede exceder ${tope} mm/s`;
      }
    }

    return null;
  }

  /**
   * Aplica los topes de velocidad a la receta entera: el juego de parámetros y,
   * si es por etapas, cada una de las etapas.
   */
  async errorDeVelocidadEnReceta(parameters, etapas) {
    const limites = await this.obtenerLimitesVelocidad();

    const errorParametros = SilarWebServer.errorDeVelocidad(parameters, limites);
    if (errorParametros) return errorParametros;

    // extractStages siempre devuelve un arreglo; el `|| []` es por si alguna vez
    // se llama con una receta sin etapas.
    const secuencia = etapas || [];
    for (let i = 0; i < secuencia.length; i++) {
      const error = SilarWebServer.errorDeVelocidad(secuencia[i], limites, `Etapa ${i + 1}: `);
      if (error) return error;
    }

    return null;
  }

  async saveRecipe(req, res) {
    try {
      const { name, description, type } = req.body;

      // Una receta por etapas trae su secuencia en `stages`; una receta normal
      // trae un único juego de parámetros, exactamente como hasta ahora.
      const { esPorEtapas, etapas, error: errorEtapas } = this.extractStages(req.body);
      if (errorEtapas) {
        return res.status(400).json({ success: false, message: errorEtapas });
      }

      // Los parámetros que se guardan en recipe_parameters: los de la receta
      // normal, o el resumen calculado si es por etapas.
      const parameters = esPorEtapas ? this.buildStagedSummary(etapas) : req.body.parameters;

      // Topes de velocidad configurados por el administrador
      const errorVelocidad = await this.errorDeVelocidadEnReceta(parameters, etapas);
      if (errorVelocidad) {
        return res.status(400).json({ success: false, message: errorVelocidad });
      }

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
          'INSERT INTO recipes (name, description, type, created_by_user_id, is_staged, return_home_at_end, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
          [
            name,
            description || 'Receta creada por usuario',
            type || 'A',
            req.user.id,
            esPorEtapas ? 1 : 0,
            req.body.returnHomeAtEnd ? 1 : 0
          ]
        );

        const recipeId = result.insertId;

        if (esPorEtapas) {
          await this.replaceRecipeStages(recipeId, etapas);
        }

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
            dipping_wait0, dipping_wait1, dipping_wait2, dipping_wait3, transfer_wait, transition_wait,
            cycles, fan, except_dripping1, except_dripping2, except_dripping3, except_dripping4,
            dip_start_position, dipping_length, transfer_speed, dip_speed, emersion_speed,
            pos_y1, pos_y2, pos_y3, pos_y4)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            parameters?.transitionWait || 0,
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
            parameters?.dipSpeed || 0,
            parameters?.emersionSpeed || 0,
            // Posiciones de los vasos de esta receta (mm desde el home de Y)
            parameters?.posY1 || 0,
            parameters?.posY2 || 0,
            parameters?.posY3 || 0,
            parameters?.posY4 || 0
          ]
        );

        // Confirmar transacción
        await this.dbConnection.commit();

        logger.recipeCreated(recipeId, name, req.user.id);

        res.json({
          success: true,
          message: esPorEtapas
            ? `Receta por etapas guardada correctamente (${etapas.length} etapas)`
            : 'Receta guardada correctamente',
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
      const { name, description, type } = req.body;

      const { esPorEtapas, etapas, error: errorEtapas } = this.extractStages(req.body);
      if (errorEtapas) {
        return res.status(400).json({ success: false, message: errorEtapas });
      }

      const parameters = esPorEtapas ? this.buildStagedSummary(etapas) : req.body.parameters;

      // Topes de velocidad configurados por el administrador
      const errorVelocidad = await this.errorDeVelocidadEnReceta(parameters, etapas);
      if (errorVelocidad) {
        return res.status(400).json({ success: false, message: errorVelocidad });
      }

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
          'UPDATE recipes SET name = ?, description = ?, type = ?, is_staged = ?, return_home_at_end = ?, updated_at = NOW() WHERE id = ?',
          [
            name,
            description || recipe.description,
            type || recipe.type,
            esPorEtapas ? 1 : 0,
            // Es un checkbox: si no viene marcado hay que apagarlo, así que no
            // vale el `|| recipe.…` que usan los campos de texto de arriba.
            req.body.returnHomeAtEnd ? 1 : 0,
            recipeId
          ]
        );

        // La lista de etapas se reemplaza entera. Si la receta dejó de ser por
        // etapas, el DELETE se lleva las que tenía: quedarían invisibles en el
        // formulario pero se ejecutarían igual.
        await this.replaceRecipeStages(recipeId, esPorEtapas ? etapas : []);

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
          parameters?.transitionWait || 0,
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
          parameters?.dipSpeed || 0,
          parameters?.emersionSpeed || 0,
          // Posiciones de los vasos de esta receta (mm desde el home de Y)
          parameters?.posY1 || 0,
          parameters?.posY2 || 0,
          parameters?.posY3 || 0,
          parameters?.posY4 || 0
        ];

        // Log para depuración
        logger.debug(`Actualizando parámetros de receta ${recipeId}`, {
          columnCount: 30,
          valueCount: paramsArray.length,
          params: paramsArray
        });

        await this.dbConnection.execute(
          `INSERT INTO recipe_parameters 
           (recipe_id, duration, temperature, velocity_x, velocity_y, accel_x, accel_y, humidity_offset, temperature_offset,
            dipping_wait0, dipping_wait1, dipping_wait2, dipping_wait3, transfer_wait, transition_wait,
            cycles, fan, except_dripping1, except_dripping2, except_dripping3, except_dripping4,
            dip_start_position, dipping_length, transfer_speed, dip_speed, emersion_speed,
            pos_y1, pos_y2, pos_y3, pos_y4)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           transition_wait = VALUES(transition_wait),
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
           emersion_speed = VALUES(emersion_speed),
           pos_y1 = VALUES(pos_y1),
           pos_y2 = VALUES(pos_y2),
           pos_y3 = VALUES(pos_y3),
           pos_y4 = VALUES(pos_y4),
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
            is_staged: esPorEtapas,
            stages: esPorEtapas ? etapas : undefined,
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
      version: config.app.version,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Indica si hay una receta corriendo o en pausa.
   * Público y sin datos sensibles: lo consulta el updater de Electron para no
   * reiniciar la aplicación a media corrida. Ante cualquier duda responde
   * ocupado, porque interrumpir un proceso lo aborta.
   */
  async getSystemBusy(req, res) {
    try {
      // Sin base de datos el servidor no puede iniciar ni registrar un proceso,
      // así que no hay nada que proteger. Responder "ocupado" aquí dejaba el
      // equipo sin poder instalar justamente las actualizaciones que arreglan
      // la conexión a MySQL: se posponía cada 10 minutos para siempre.
      if (!this.dbConnection) {
        return res.json({ busy: false, reason: 'database_unavailable' });
      }

      await this.ensureDatabaseConnection();

      const [rows] = await this.dbConnection.execute(
        `SELECT COUNT(*) AS total FROM processes WHERE status IN ('running', 'paused')`
      );

      res.json({ busy: rows[0].total > 0 });
    } catch (error) {
      logger.error('Error consultando ocupación del sistema:', error);
      res.json({ busy: true, reason: 'error' });
    }
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

      switch (command) {
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

  /**
   * Puerta común de las rutas de calibración: administrador y Arduino conectado.
   * Devuelve true si la petición puede seguir; si no, ya ha respondido.
   */
  guardCalibration(req, res) {
    if (req.user?.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Solo los administradores pueden calibrar la máquina'
      });
      return false;
    }

    if (!this.arduinoController?.isConnected) {
      res.status(503).json({
        success: false,
        message: 'Arduino no conectado'
      });
      return false;
    }

    return true;
  }

  async getZCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const calibration = await this.arduinoController.getZCalibration();
      res.json({ success: true, calibration });
    } catch (error) {
      logger.error('Error leyendo calibración de Z:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async updateZCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const calibration = await this.arduinoController.setZCalibration(req.body || {});
      logger.info('Calibración de Z aplicada', { user: req.user.username, calibration });
      res.json({
        success: true,
        message: 'Calibración aplicada. Verifícala antes de guardarla.',
        calibration
      });
    } catch (error) {
      logger.error('Error aplicando calibración de Z:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async saveZCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const calibration = await this.arduinoController.saveZCalibration();
      logger.warn('Calibración de Z guardada en EEPROM', { user: req.user.username, calibration });
      res.json({ success: true, message: 'Calibración guardada en la máquina', calibration });
    } catch (error) {
      logger.error('Error guardando calibración de Z:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async resetZCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const calibration = await this.arduinoController.resetZCalibration();
      logger.warn('Calibración de Z restaurada a fábrica', { user: req.user.username });
      res.json({ success: true, message: 'Calibración restaurada a valores de fábrica', calibration });
    } catch (error) {
      logger.error('Error restaurando calibración de Z:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getYCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const calibration = await this.arduinoController.getYCalibration();
      res.json({ success: true, calibration });
    } catch (error) {
      logger.error('Error leyendo geometría de Y:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async updateYCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const calibration = await this.arduinoController.setYCalibration(req.body || {});
      logger.info('Geometría de Y aplicada', { user: req.user.username, calibration });
      res.json({
        success: true,
        message: 'Geometría aplicada. Verifícala antes de guardarla.',
        calibration
      });
    } catch (error) {
      logger.error('Error aplicando geometría de Y:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async saveYCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const calibration = await this.arduinoController.saveYCalibration();
      logger.warn('Geometría de Y guardada en EEPROM', { user: req.user.username, calibration });
      res.json({ success: true, message: 'Geometría guardada en la máquina', calibration });
    } catch (error) {
      logger.error('Error guardando geometría de Y:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async resetYCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const calibration = await this.arduinoController.resetYCalibration();
      logger.warn('Geometría de Y restaurada a fábrica', { user: req.user.username });
      res.json({ success: true, message: 'Geometría restaurada a valores de fábrica', calibration });
    } catch (error) {
      logger.error('Error restaurando geometría de Y:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async gotoZHeight(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const result = await this.arduinoController.moveZToHeight(req.body?.heightMm);
      res.json({ success: true, message: 'Movimiento completado', result });
    } catch (error) {
      logger.error('Error moviendo Z a altura:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async jogYCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const result = await this.arduinoController.jogYSteps(req.body?.steps);
      res.json({ success: true, result });
    } catch (error) {
      logger.error('Error en jog de calibración de Y:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // El home de la máquina lleva los dos ejes a su final de carrera, así que
  // sirve igual para arrancar el asistente de Y que el de Z. Se expone con las
  // dos rutas para no obligar a la pantalla a saber ese detalle.
  async homeYCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const result = await this.arduinoController.executeHome();
      res.json({ success: true, result });
    } catch (error) {
      logger.error('Error ejecutando home desde calibración de Y:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async jogZCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const result = await this.arduinoController.jogZSteps(req.body?.steps);
      res.json({ success: true, result });
    } catch (error) {
      logger.error('Error en jog de calibración de Z:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async homeZCalibration(req, res) {
    if (!this.guardCalibration(req, res)) return;

    try {
      const result = await this.arduinoController.executeHome();
      res.json({ success: true, result });
    } catch (error) {
      logger.error('Error ejecutando home desde calibración:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Estado del firmware: que version trae el instalador, que version tiene la
   * placa y si hay que grabarla. Lo consulta la aplicación al arrancar.
   */
  async getFlashInfo(req, res) {
    try {
      const empaquetada = actualizadorFirmware.versionEmpaquetada();

      if (!empaquetada) {
        return res.json({
          success: true,
          disponible: false,
          message: 'Esta versión no trae firmware empaquetado'
        });
      }

      if (!this.arduinoController?.isConnected) {
        return res.json({
          success: true,
          disponible: true,
          conectado: false,
          versionEmpaquetada: empaquetada,
          necesitaActualizar: false,
          message: 'Arduino no conectado'
        });
      }

      // Si ya se sabe de cuando arrancó la placa, no se le vuelve a preguntar:
      // el firmware la anuncia solo al iniciar.
      const versionPlaca = this.arduinoController.firmwareVersion
        ?? await this.arduinoController.consultarVersionFirmware();

      res.json({
        success: true,
        disponible: true,
        conectado: true,
        puerto: this.arduinoController.portPath,
        versionEmpaquetada: empaquetada,
        versionPlaca,
        necesitaActualizar: actualizadorFirmware.necesitaActualizar(versionPlaca)
      });
    } catch (error) {
      logger.error('Error consultando el firmware:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Graba el firmware empaquetado en la placa.
   *
   * Suelta el puerto, corre avrdude y lo vuelve a tomar. Si algo falla, el
   * bootloader sigue intacto y se puede reintentar desde aquí mismo: la placa
   * queda sin sketch, pero no hace falta que nadie vaya al laboratorio.
   */
  async flashArduino(req, res) {
    if (!actualizadorFirmware.hayFirmwareEmpaquetado()) {
      return res.status(501).json({
        success: false,
        message: 'Esta versión no trae firmware empaquetado'
      });
    }

    if (!this.arduinoController?.isConnected) {
      return res.status(503).json({ success: false, message: 'Arduino no conectado' });
    }

    // Grabar reinicia la placa: a media receta el experimento se pierde y los
    // motores se quedan donde estén.
    if (await this.hayProcesoEnCurso()) {
      return res.status(409).json({
        success: false,
        message: 'Hay un proceso en curso. Espere a que termine para actualizar el firmware.'
      });
    }

    const puerto = this.arduinoController.portPath;

    try {
      await this.arduinoController.liberarPuertoParaGrabar();

      const resultado = await actualizadorFirmware.grabar(puerto, (linea) => {
        this.io?.emit('firmware-progreso', { linea });
      });

      await this.arduinoController.retomarPuertoTrasGrabar(puerto);
      const versionPlaca = await this.arduinoController.consultarVersionFirmware();

      res.json({
        success: true,
        versionPlaca,
        versionEsperada: resultado.version,
        verificado: versionPlaca === resultado.version
      });
    } catch (error) {
      logger.error('Error grabando el firmware:', error);

      // Pase lo que pase hay que devolverle el puerto a la aplicación, aunque la
      // placa haya quedado a medias: es la única forma de reintentar.
      // Si el fallo fue justamente al reabrir el puerto, no se insiste aqui: la
      // reconexion automatica del controlador sigue trabajando por su cuenta.
      if (!this.arduinoController.isConnected) {
        await this.arduinoController.retomarPuertoTrasGrabar(puerto).catch((fallo) => {
          logger.error('No se pudo recuperar el puerto tras el fallo:', fallo.message);
        });
      }

      res.status(500).json({ success: false, message: error.message });
    }
  }

  async verifyFirmware(req, res) {
    try {
      const empaquetada = actualizadorFirmware.versionEmpaquetada();
      const versionPlaca = await this.arduinoController?.consultarVersionFirmware();

      res.json({
        success: true,
        versionPlaca,
        versionEmpaquetada: empaquetada,
        hasCorrectFirmware: Boolean(empaquetada) && versionPlaca === empaquetada
      });
    } catch (error) {
      logger.error('Error verificando el firmware:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Igual que /api/system/busy: sin base de datos no hay proceso que proteger.
   */
  async hayProcesoEnCurso() {
    if (!this.dbConnection) return false;

    try {
      await this.ensureDatabaseConnection();
      const [rows] = await this.dbConnection.execute(
        `SELECT COUNT(*) AS total FROM processes WHERE status IN ('running', 'paused')`
      );
      return rows[0].total > 0;
    } catch (error) {
      logger.error('Error consultando procesos en curso:', error);
      // Ante la duda, se considera ocupado: no grabar de más es lo barato.
      return true;
    }
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

      // Buscar si hay un proceso ejecutándose.
      //
      // El tiempo transcurrido lo calcula MySQL, no el cliente. start_time es
      // un TIMESTAMP y el driver lo entrega interpretándolo con la zona del
      // proceso de Node: si el motor corre en otra zona (MySQL en Docker en
      // UTC contra un equipo en UTC-6, por ejemplo) la fecha sale desplazada
      // horas y el cronómetro de la pantalla se queda clavado en 00:00:00
      // porque el arranque parece estar en el futuro. TIMESTAMPDIFF resuelve
      // la resta dentro del motor, donde las dos fechas viven en la misma
      // zona, y lo que viaja es un número de segundos sin ambigüedad.
      //
      // total_cycles permite mostrar "Ciclo 3/20" en la cabecera desde el
      // primer instante: los ciclos de la receta se conocen aunque el Arduino
      // todavía no haya anunciado ninguno. En recetas por etapas el total es
      // la suma de los ciclos de todas las etapas.
      const [processes] = await this.dbConnection.execute(
        `SELECT p.id, p.status, p.start_time, p.recipe_id, p.process_number,
                TIMESTAMPDIFF(SECOND, p.start_time, NOW()) AS elapsed_seconds,
                r.name AS recipe_name,
                COALESCE(
                  (SELECT SUM(rs.cycles) FROM recipe_stages rs WHERE rs.recipe_id = p.recipe_id),
                  rp.cycles,
                  1
                ) AS total_cycles
         FROM processes p
         LEFT JOIN recipes r ON r.id = p.recipe_id
         LEFT JOIN recipe_parameters rp ON rp.recipe_id = p.recipe_id
         WHERE p.status IN ('running', 'paused')
         ORDER BY p.start_time DESC, p.id DESC
         LIMIT 1`
      );

      if (processes.length === 0) {
        return res.json({
          success: true,
          status: 'stopped',
          serverTime: new Date().toISOString(),
          process: null
        });
      }

      const process = processes[0];
      return res.json({
        success: true,
        status: process.status,
        serverTime: new Date().toISOString(),
        process: {
          id: process.id,
          recipeId: process.recipe_id,
          recipeName: process.recipe_name,
          processNumber: process.process_number,
          startTime: process.start_time,
          elapsedSeconds: Number(process.elapsed_seconds) || 0,
          totalCycles: Number(process.total_cycles) || null,
          currentCycle: this.currentCycle?.cycle || null
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

  /**
   * Deshace un arranque que no llegó a cuajar en la placa.
   *
   * Devuelve el Arduino a modo manual antes que nada: el comando "1" del
   * firmware pone procesoActivo y procesoPausado en false, así que si el
   * START_RECIPE llegó a entrar pese al error (un timeout no distingue entre
   * "no llegó" y "llegó y no contestó"), la máquina queda parada y no corriendo
   * una receta que el servidor da por muerta.
   *
   * Después cierra la fila como 'failed' y limpia el estado en memoria, para
   * que el reconciliador no siga esperando a que la placa reclame una corrida
   * que nunca existió.
   */
  async abortarArranque(processId, causa) {
    try {
      if (this.arduinoController.isConnected) {
        await this.arduinoController.setModeManual();
      }
    } catch (error) {
      logger.error('No se pudo devolver el Arduino a modo manual tras el arranque fallido', {
        processId,
        error
      });
    }

    this.procesoConfirmadoPorArduino = false;
    this.lecturasProcesoInactivo = 0;
    this.plazoAdopcionHuerfanos = 0;
    this.currentStage = null;
    this.currentCycle = null;

    try {
      await this.dbConnection.execute(
        `UPDATE processes
            SET status = 'failed', end_time = NOW(), duration_minutes = 0, error_message = ?
          WHERE id = ?`,
        [`No se pudo cargar la receta en el Arduino: ${causa?.message || causa}`, processId]
      );
      logger.warn(`Proceso ${processId} marcado como fallido: la receta no llegó a cargarse en el Arduino.`);
    } catch (error) {
      // Si esto falla la fila se queda en 'running'. No es una fuga permanente:
      // adoptarProcesosHuerfanos() la cierra en el siguiente arranque, y el
      // reconciliador la cancela en cuanto la placa no la reclame.
      logger.error('No se pudo marcar como fallido el proceso tras el error del Arduino', {
        processId,
        error
      });
    }

    this.io.emit('process-stage', null);
    this.io.emit('process-cycle', null);
    this.io.emit('process-status-update', { status: 'failed', processId });
  }

  async startProcess(req, res) {
    // Todo el arranque va en exclusiva: comprobar que no hay nada corriendo,
    // insertar la fila y cargar la receta en la placa son un solo paso.
    return this.conArranqueEnExclusiva(() => this.ejecutarArranqueDeProceso(req, res));
  }

  async ejecutarArranqueDeProceso(req, res) {
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

      // Las etapas, si la receta es por etapas. Van al Arduino una por una y de
      // ahí en adelante la secuencia la lleva el firmware: el PC no interviene
      // entre una etapa y la siguiente.
      let etapas = [];
      if (recipe.is_staged) {
        const etapasPorReceta = await this.getStagesForRecipes([validRecipeId]);
        etapas = etapasPorReceta.get(validRecipeId) || [];

        if (etapas.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'La receta está marcada como receta por etapas pero no tiene ninguna etapa configurada'
          });
        }
      }

      const parameters = {
        duration: Number(recipe.duration) || 0,
        temperature: Number(recipe.temperature) || 0,
        velocityY: Number(recipe.velocity_y) || 0,
        velocityZ: Number(recipe.velocity_x) || 0, // Nota: velocity_x se usa para Z según el esquema
        accelY: Number(recipe.accel_y) || 0,
        accelZ: Number(recipe.accel_x) || 0,
        dippingWait0: Number(recipe.dipping_wait0) || 0,
        dippingWait1: Number(recipe.dipping_wait1) || 0,
        dippingWait2: Number(recipe.dipping_wait2) || 0,
        dippingWait3: Number(recipe.dipping_wait3) || 0,
        transferWait: Number(recipe.transfer_wait) || 0,
        transitionWait: Number(recipe.transition_wait) || 0,
        cycles: Number(recipe.cycles) || 1,
        fan: recipe.fan || false,
        exceptDripping1: recipe.except_dripping1 || false,
        exceptDripping2: recipe.except_dripping2 || false,
        exceptDripping3: recipe.except_dripping3 || false,
        exceptDripping4: recipe.except_dripping4 || false,
        dipStartPosition: Number(recipe.dip_start_position) || 0,
        dippingLength: Number(recipe.dipping_length) || 0,
        transferSpeed: Number(recipe.transfer_speed) || 0,
        dipSpeed: Number(recipe.dip_speed) || 0,
        emersionSpeed: Number(recipe.emersion_speed) || 0,
        posY1: Number(recipe.pos_y1) || 0,
        posY2: Number(recipe.pos_y2) || 0,
        posY3: Number(recipe.pos_y3) || 0,
        posY4: Number(recipe.pos_y4) || 0
      };

      // Para una receta por etapas, lo de arriba es el resumen (duración y
      // ciclos totales); las etapas viajan aparte para que la pantalla de
      // monitoreo pueda mostrar cuál se está ejecutando. Se guardan en
      // processes.parameters junto con el resto, así que quedan registradas tal
      // y como se corrieron aunque la receta se edite después.
      if (recipe.is_staged) {
        parameters.isStaged = true;
        parameters.totalStages = etapas.length;
        parameters.stages = etapas;
      }

      // Se queda registrado en processes.parameters junto con el resto, así que
      // la corrida guarda con qué ajuste se lanzó aunque la receta se edite
      // después. La copia en memoria es la que se consulta al completar.
      parameters.returnHomeAtEnd = !!recipe.return_home_at_end;
      this.regresarAHomeAlTerminar = !!recipe.return_home_at_end;

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

      // Crear nuevo proceso en la base de datos.
      //
      // El número definitivo se pone en un segundo paso porque se deriva del id,
      // que no existe hasta después del INSERT. Antes se sacaba de RAND() sobre
      // cuatro dígitos, y process_number tiene un UNIQUE: a partir de ~120
      // procesos en un mismo día la probabilidad de chocar pasa del 50% y el
      // arranque fallaba con un error de clave duplicada. Con el id no hay
      // colisión posible y además quedan ordenados.
      //
      // El valor de entrada es un provisional único: la columna es NOT NULL y
      // UNIQUE, así que no puede quedar vacía ni repetida ni un instante.
      const [result] = await this.dbConnection.execute(
        `INSERT INTO processes (recipe_id, process_number, status, start_time, operator_name, parameters)
         VALUES (?, CONCAT('TMP-', UUID()), 'running', NOW(), ?, ?)`,
        [validRecipeId, req.user?.fullName || req.user?.username || 'Usuario', JSON.stringify(parameters)]
      );

      const processId = result.insertId;

      try {
        await this.dbConnection.execute(
          `UPDATE processes
              SET process_number = CONCAT('PROC-', DATE_FORMAT(start_time, '%Y%m%d'), '-', LPAD(id, 4, '0'))
            WHERE id = ?`,
          [processId]
        );
      } catch (error) {
        // El proceso ya está creado y es válido; sólo se queda con la etiqueta
        // provisional. No se aborta la corrida por el nombre de una columna.
        logger.error('No se pudo asignar el número definitivo al proceso', { processId, error });
      }

      // Publicar los parámetros de la receta: las tarjetas de monitoreo los
      // esperan con estos mismos nombres (dippingWait0, transferSpeed, ...)
      this.io.emit('process-parameters', parameters);

      // La etapa la anuncia el Arduino al entrar en cada una, pero la primera se
      // adelanta aquí: entre el arranque y ese anuncio hay todo el posicionado
      // inicial de Z, y la pantalla no debe quedarse en blanco mientras tanto.
      // Arranca una corrida nueva: la placa todavía no la reclama (la receta
      // viaja etapa por etapa y tarda) y el reconciliador debe esperar a que lo
      // haga antes de dar por terminado nada.
      this.procesoConfirmadoPorArduino = false;
      this.lecturasProcesoInactivo = 0;
      this.plazoAdopcionHuerfanos = Date.now() + 30000;

      this.currentStage = recipe.is_staged
        ? { stage: 1, totalStages: etapas.length, cycles: Number(etapas[0]?.cycles) || 0 }
        : null;
      if (this.currentStage) this.io.emit('process-stage', this.currentStage);

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
          if (recipe.is_staged) {
            await this.arduinoController.startStagedRecipe(etapas);
          } else {
            await this.arduinoController.startRecipe(parameters);
          }
          logger.info('Proceso automático iniciado en Arduino', { processId, recipeId: validRecipeId, parameters });

        } catch (arduinoError) {
          // La placa estaba conectada y aun así no aceptó la receta: la corrida
          // no ha empezado. Antes esto sólo se registraba y la petición
          // respondía success, con la fila en 'running': el operador veía un
          // proceso en marcha que no existía, y esa fila abierta impedía
          // arrancar el siguiente hasta detener a mano un proceso fantasma.
          logger.error('Error enviando comandos al Arduino al iniciar proceso:', arduinoError);

          await this.abortarArranque(processId, arduinoError);

          return res.status(502).json({
            success: false,
            message: `No se pudo cargar la receta en el Arduino: ${arduinoError.message}. El proceso no se inició.`,
            processNumber: processData[0].process_number
          });
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
         ORDER BY start_time DESC, id DESC
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
         ORDER BY start_time DESC, id DESC
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
         ORDER BY start_time DESC, id DESC
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

      // Paro a mano: la receta no se completó, así que no hay home automático.
      this.regresarAHomeAlTerminar = false;

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

      this.currentStage = null;
      this.currentCycle = null;
      this.io.emit('process-stage', null);
      this.io.emit('process-cycle', null);

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

      // Un tope en 0 o en negativo dejaría la máquina sin poder guardar ninguna
      // receta, y un tope vacío se guardaría como NaN. Por arriba no se corrige
      // nada: si el administrador pide más de lo que el eje da, el firmware
      // recorta en marcha y lo avisa.
      const topesConfigurables = {
        max_transfer_speed: 'la velocidad de transferencia Y',
        max_dip_speed: 'la velocidad del eje Z'
      };

      for (const [clave, etiqueta] of Object.entries(topesConfigurables)) {
        if (config[clave] === undefined) continue;
        if (!(parseFloat(config[clave]) > 0)) {
          return res.status(400).json({
            success: false,
            message: `El límite de ${etiqueta} tiene que ser mayor que 0 mm/s`
          });
        }
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
         WHERE config_key IN ('max_transfer_speed', 'max_dip_speed', 'humidity_offset', 'temperature_offset')
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

  /**
   * Obtiene la lista de todos los usuarios activos
   * Solo para administradores
   */
  async getUsers(req, res) {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acceso denegado' });
      }

      await this.ensureDatabaseConnection();
      const [rows] = await this.dbConnection.execute(
        'SELECT id, username, full_name, role, created_at, last_login FROM users WHERE is_active = 1 ORDER BY id ASC'
      );

      res.json({ success: true, users: rows });
    } catch (error) {
      logger.apiError('GET', '/api/users', error, req.user?.id);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Crea un nuevo usuario
   * Solo para administradores
   */
  async createUser(req, res) {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acceso denegado' });
      }

      const { username, password, full_name, role } = req.body;

      if (!username || !password || !role) {
        return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
      }

      await this.ensureDatabaseConnection();

      // Verificar si el usuario ya existe (incluyendo inactivos para evitar conflictos de username)
      const [existing] = await this.dbConnection.execute(
        'SELECT id FROM users WHERE username = ?',
        [username]
      );

      if (existing.length > 0) {
        return res.status(400).json({ success: false, message: 'El nombre de usuario ya está en uso' });
      }

      const crypto = require('crypto');
      const hashedPassword = crypto.createHash('md5').update(password).digest('hex');

      await this.dbConnection.execute(
        'INSERT INTO users (username, password, full_name, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, NOW())',
        [username, hashedPassword, full_name || '', role]
      );

      logger.info(`Usuario creado por admin ${req.user.username}`, { newUser: username });
      res.json({ success: true, message: 'Usuario creado correctamente' });
    } catch (error) {
      logger.apiError('POST', '/api/users', error, req.user?.id);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Actualiza un usuario existente
   * Solo para administradores
   */
  async updateUser(req, res) {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acceso denegado' });
      }

      const { id } = req.params;
      const { full_name, role, password } = req.body;

      await this.ensureDatabaseConnection();

      let query = 'UPDATE users SET full_name = ?, role = ?';
      let params = [full_name, role];

      if (password && password.trim() !== '') {
        const crypto = require('crypto');
        const hashedPassword = crypto.createHash('md5').update(password).digest('hex');
        query += ', password = ?';
        params.push(hashedPassword);
      }

      query += ' WHERE id = ?';
      params.push(id);

      await this.dbConnection.execute(query, params);

      logger.info(`Usuario ID ${id} actualizado por admin ${req.user.username}`);
      res.json({ success: true, message: 'Usuario actualizado correctamente' });
    } catch (error) {
      logger.apiError('PUT', '/api/users', error, req.user?.id);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Desactiva un usuario (Soft Delete)
   * Solo para administradores. No permite auto-eliminación.
   */
  async deleteUser(req, res) {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acceso denegado' });
      }

      const { id } = req.params;

      // Regla: No se pueden eliminar a sí mismos
      if (parseInt(id) === parseInt(req.user.id)) {
        return res.status(400).json({ success: false, message: 'No puedes eliminar tu propia cuenta' });
      }

      await this.ensureDatabaseConnection();

      // Soft delete: is_active = 0
      await this.dbConnection.execute(
        'UPDATE users SET is_active = 0 WHERE id = ?',
        [id]
      );

      logger.info(`Usuario ID ${id} desactivado (soft delete) por admin ${req.user.username}`);
      res.json({ success: true, message: 'Usuario eliminado correctamente' });
    } catch (error) {
      logger.apiError('DELETE', '/api/users', error, req.user?.id);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async initialize() {
    try {
      await this.initDatabase();
    } catch (dbError) {
      logger.error('Error crítico: No se pudo conectar a la base de datos al arrancar el servidor:', dbError);
    }

    // Poner la base al día antes de tocar nada más. La aplicación se actualiza
    // sola en el laboratorio y allí no hay nadie para correr los .sql a mano,
    // así que el arranque siguiente a una actualización es el único momento en
    // el que esto puede pasar. Va antes de adoptar procesos y de hablar con el
    // Arduino porque ambos leen recetas, y una receta a la que le falta una
    // columna nueva se lee mal.
    await migraciones.aplicarPendientes(this.dbConnection);

    await this.adoptarProcesosHuerfanos();

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
