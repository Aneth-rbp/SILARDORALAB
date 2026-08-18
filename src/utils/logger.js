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

    // Tope por archivo y cuántos rotados se conservan además del actual
    // (silar-system.log.1 ... .5). Sin esto el log crecía sin límite: el equipo
    // del laboratorio queda encendido semanas seguidas.
    this.maxSize = this.parseSize(config.logging.maxSize);
    this.maxFiles = Number(config.logging.maxFiles) || 5;

    // Las escrituras van encadenadas y son asíncronas: appendFileSync bloqueaba
    // el event loop en cada línea, y el reconciliador registra al ritmo de las
    // lecturas del Arduino, dos por segundo.
    this.cola = Promise.resolve();
    // Líneas encoladas que todavía no están en disco. Se guardan para poder
    // volcarlas de golpe si el proceso termina antes de que la cola drene.
    this.pendientes = [];

    this.ensureLogDirectory();
    this.tamanoActual = this.tamanoEnDisco();
    this.volcarAlSalir();
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Convierte '10m', '512k' o un número a bytes.
   * Un valor que no se entienda cae a 10 MB en vez de desactivar la rotación:
   * quedarse sin tope es justo el fallo que esto viene a evitar.
   */
  parseSize(valor) {
    const PREDETERMINADO = 10 * 1024 * 1024;

    if (typeof valor === 'number' && valor > 0) return Math.floor(valor);

    const partes = String(valor || '').trim().match(/^(\d+(?:\.\d+)?)\s*([kmg])?b?$/i);
    if (!partes) return PREDETERMINADO;

    const cantidad = parseFloat(partes[1]);
    if (!(cantidad > 0)) return PREDETERMINADO;

    const multiplicadores = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
    return Math.floor(cantidad * (multiplicadores[(partes[2] || '').toLowerCase()] || 1));
  }

  /**
   * Tamaño del log al arrancar. De ahí en adelante se lleva en memoria, para no
   * hacer un stat por cada línea escrita.
   */
  tamanoEnDisco() {
    try {
      return fs.statSync(this.logFile).size;
    } catch (error) {
      return 0;
    }
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (data) {
      return `${formattedMessage} ${this.serialize(data)}`;
    }

    return formattedMessage;
  }

  /**
   * JSON.stringify convierte un Error en "{}" porque sus propiedades no son
   * enumerables, así que los logs perdían el motivo real de las fallas
   * (conexión serial, MySQL). Aquí se aplanan a mano.
   */
  serialize(data) {
    const flatten = (value) => ({
      message: value.message,
      code: value.code,
      errno: value.errno
    });

    if (data instanceof Error) {
      return JSON.stringify(flatten(data));
    }

    try {
      return JSON.stringify(data, (key, value) => (
        value instanceof Error ? flatten(value) : value
      ));
    } catch (error) {
      return String(data);
    }
  }

  /**
   * Corre los archivos rotados una posición y deja el log actual como .1.
   * Se descarta el más viejo. Si la rotación falla se sigue escribiendo en el
   * archivo actual: perder la rotación es preferible a perder los logs.
   */
  async rotar() {
    try {
      await fs.promises.rm(`${this.logFile}.${this.maxFiles}`, { force: true });

      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const origen = `${this.logFile}.${i}`;
        if (fs.existsSync(origen)) {
          await fs.promises.rename(origen, `${this.logFile}.${i + 1}`);
        }
      }

      await fs.promises.rename(this.logFile, `${this.logFile}.1`);
      this.tamanoActual = 0;
    } catch (error) {
      console.error('Error rotando el archivo de log:', error.message);
    }
  }

  async escribir(linea) {
    const bytes = Buffer.byteLength(linea);

    // Se rota antes de escribir, no después, para que el archivo no llegue a
    // pasarse del tope. No se rota estando vacío: una línea más larga que
    // maxSize dejaría el log rotando en cada escritura.
    if (this.tamanoActual > 0 && this.tamanoActual + bytes > this.maxSize) {
      await this.rotar();
    }

    await fs.promises.appendFile(this.logFile, linea);
    this.tamanoActual += bytes;
  }

  writeToFile(message) {
    const linea = message + '\n';
    this.pendientes.push(linea);

    // La cadena de promesas conserva el orden de las líneas y evita que una
    // escritura se solape con la rotación.
    this.cola = this.cola
      .then(() => this.escribir(linea))
      .catch((error) => {
        console.error('Error writing to log file:', error.message);
      })
      .then(() => {
        // La cola es FIFO, así que la que sale es la que entró en esta posición.
        this.pendientes.shift();
      });
  }

  /**
   * Espera a que todo lo encolado esté en disco. Útil antes de cerrar.
   */
  async flush() {
    await this.cola;
  }

  /**
   * Red de seguridad: si el proceso termina con líneas todavía en la cola se
   * escriben de forma síncrona. En 'exit' ya no se puede esperar a una promesa,
   * y esas son justo las líneas que explican por qué se cerró.
   */
  volcarAlSalir() {
    process.on('exit', () => {
      if (this.pendientes.length === 0) return;
      try {
        fs.appendFileSync(this.logFile, this.pendientes.join(''));
      } catch (error) {
        // El proceso ya se está cerrando: no hay nada más que hacer.
      }
    });
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
