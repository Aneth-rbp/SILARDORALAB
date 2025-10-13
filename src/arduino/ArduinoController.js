/**
 * ArduinoController.js
 * Controlador principal para la comunicación serial con Arduino
 * Implementa patrón Singleton para evitar múltiples conexiones
 */

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const { ARDUINO_COMMANDS, ARDUINO_RESPONSES } = require('./commands');
const ResponseParser = require('./parser');

class ArduinoController extends EventEmitter {
    constructor() {
        super();
        this.port = null;
        this.parser = null;
        this.isConnected = false;
        this.portPath = null;
        this.reconnectTimer = null;
        this.commandQueue = [];
        this.processingCommand = false;
        
        // Estado actual del Arduino
        this.currentState = {
            mode: 'UNKNOWN', // MANUAL, AUTOMATIC, HOME
            axisY: {
                position: 0,
                moving: false,
                atHome: false,
                atLimit: false
            },
            axisZ: {
                position: 0,
                moving: false,
                atHome: false,
                atLimit: false
            },
            emergencyStop: false,
            lastUpdate: null
        };
    }

    /**
     * Escanea los puertos disponibles y retorna una lista
     */
    static async listAvailablePorts() {
        try {
            const ports = await SerialPort.list();
            return ports.map(port => ({
                path: port.path,
                manufacturer: port.manufacturer || 'Unknown',
                serialNumber: port.serialNumber || 'N/A',
                vendorId: port.vendorId || 'N/A',
                productId: port.productId || 'N/A'
            }));
        } catch (error) {
            logger.error('Error listando puertos:', error);
            return [];
        }
    }

    /**
     * Detecta automáticamente el puerto del Arduino
     */
    async detectArduinoPort() {
        try {
            const ports = await SerialPort.list();
            
            // Buscar Arduino por fabricante conocido
            const arduinoPort = ports.find(port => {
                const manufacturer = (port.manufacturer || '').toLowerCase();
                return manufacturer.includes('arduino') || 
                       manufacturer.includes('ch340') || 
                       manufacturer.includes('ftdi') ||
                       manufacturer.includes('silicon labs');
            });

            if (arduinoPort) {
                logger.info(`Arduino detectado en puerto: ${arduinoPort.path}`);
                return arduinoPort.path;
            }

            // Si no se encuentra, usar el primer puerto COM/tty disponible
            if (ports.length > 0) {
                logger.warn(`Arduino no detectado específicamente, usando: ${ports[0].path}`);
                return ports[0].path;
            }

            return null;
        } catch (error) {
            logger.error('Error detectando puerto Arduino:', error);
            return null;
        }
    }

    /**
     * Conecta con el Arduino en el puerto especificado
     */
    async connect(portPath = null, baudRate = 9600) {
        try {
            // Si ya está conectado, desconectar primero
            if (this.isConnected) {
                await this.disconnect();
            }

            // Si no se especifica puerto, intentar detectar automáticamente
            if (!portPath) {
                portPath = await this.detectArduinoPort();
            }

            if (!portPath) {
                throw new Error('No se encontró ningún puerto Arduino disponible');
            }

            this.portPath = portPath;

            // Crear conexión serial
            this.port = new SerialPort({
                path: portPath,
                baudRate: baudRate,
                dataBits: 8,
                parity: 'none',
                stopBits: 1,
                autoOpen: false
            });

            // Configurar parser de líneas
            this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));

            // Manejar eventos del puerto
            this.setupPortHandlers();

            // Abrir el puerto
            await new Promise((resolve, reject) => {
                this.port.open((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });

            // Esperar que el Arduino se reinicie (2 segundos)
            await this.delay(2000);

            this.isConnected = true;
            this.emit('connected', { port: portPath });
            logger.info(`Conectado a Arduino en ${portPath} a ${baudRate} baud`);

            return true;
        } catch (error) {
            logger.error('Error conectando con Arduino:', error);
            this.isConnected = false;
            this.emit('error', { message: 'Error de conexión', error });
            throw error;
        }
    }

    /**
     * Configura los manejadores de eventos del puerto serial
     */
    setupPortHandlers() {
        // Manejar datos recibidos
        this.parser.on('data', (line) => {
            this.handleArduinoData(line.trim());
        });

        // Manejar errores del puerto
        this.port.on('error', (err) => {
            logger.error('Error en puerto serial:', err);
            this.emit('error', { message: 'Error de puerto', error: err });
        });

        // Manejar cierre del puerto
        this.port.on('close', () => {
            logger.warn('Puerto serial cerrado');
            this.isConnected = false;
            this.emit('disconnected');
            
            // Intentar reconectar automáticamente
            this.attemptReconnect();
        });

        // Manejar apertura del puerto
        this.port.on('open', () => {
            logger.info('Puerto serial abierto');
        });
    }

    /**
     * Procesa los datos recibidos del Arduino
     */
    handleArduinoData(data) {
        if (!data || data.length === 0) return;

        logger.debug(`Arduino → ${data}`);

        try {
            // Parsear la respuesta usando el parser
            const parsed = ResponseParser.parse(data);
            
            if (parsed) {
                // Actualizar estado interno
                this.updateState(parsed);
                
                // Emitir evento con los datos parseados
                this.emit('data', parsed);
            }

            // Emitir evento raw para debugging
            this.emit('raw', data);

        } catch (error) {
            logger.error('Error procesando datos de Arduino:', error);
        }
    }

    /**
     * Actualiza el estado interno basado en la respuesta del Arduino
     */
    updateState(parsed) {
        if (parsed.type === 'mode') {
            this.currentState.mode = parsed.mode;
        } else if (parsed.type === 'position') {
            if (parsed.axis === 'Y') {
                this.currentState.axisY.position = parsed.position;
            } else if (parsed.axis === 'Z') {
                this.currentState.axisZ.position = parsed.position;
            }
        } else if (parsed.type === 'limit') {
            if (parsed.axis === 'Y') {
                this.currentState.axisY.atLimit = true;
            } else if (parsed.axis === 'Z') {
                this.currentState.axisZ.atLimit = true;
            }
        } else if (parsed.type === 'home') {
            if (parsed.axis === 'Y') {
                this.currentState.axisY.atHome = true;
                this.currentState.axisY.position = 0;
            } else if (parsed.axis === 'Z') {
                this.currentState.axisZ.atHome = true;
                this.currentState.axisZ.position = 0;
            }
        } else if (parsed.type === 'emergency') {
            this.currentState.emergencyStop = parsed.active;
        }

        this.currentState.lastUpdate = new Date();
        this.emit('state-changed', this.currentState);
    }

    /**
     * Envía un comando al Arduino
     */
    async sendCommand(command, waitForResponse = false, timeout = 5000) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.port || !this.port.isOpen) {
                reject(new Error('Arduino no conectado'));
                return;
            }

            const commandString = `${command}\n`;
            logger.debug(`PC → Arduino: ${command}`);

            this.port.write(commandString, (err) => {
                if (err) {
                    logger.error('Error enviando comando:', err);
                    reject(err);
                    return;
                }

                if (!waitForResponse) {
                    resolve({ success: true, command });
                    return;
                }

                // Esperar respuesta con timeout
                let timeoutHandle;
                const responseHandler = (data) => {
                    clearTimeout(timeoutHandle);
                    this.removeListener('data', responseHandler);
                    resolve({ success: true, command, response: data });
                };

                timeoutHandle = setTimeout(() => {
                    this.removeListener('data', responseHandler);
                    reject(new Error('Timeout esperando respuesta del Arduino'));
                }, timeout);

                this.once('data', responseHandler);
            });
        });
    }

    /**
     * Comandos específicos del sistema SILAR
     */
    
    async setModeManual() {
        logger.info('Configurando modo MANUAL');
        return await this.sendCommand(ARDUINO_COMMANDS.MODE_MANUAL);
    }

    async setModeAutomatic() {
        logger.info('Configurando modo AUTOMÁTICO');
        return await this.sendCommand(ARDUINO_COMMANDS.MODE_AUTOMATIC);
    }

    async executeHome() {
        logger.info('Ejecutando HOME');
        return await this.sendCommand(ARDUINO_COMMANDS.HOME);
    }

    async moveAxisY(steps) {
        logger.info(`Moviendo eje Y: ${steps} pasos`);
        return await this.sendCommand(`Y${steps}`);
    }

    async moveAxisZ(steps) {
        logger.info(`Moviendo eje Z: ${steps} pasos`);
        return await this.sendCommand(`Z${steps}`);
    }

    async emergencyStop() {
        logger.warn('PARO DE EMERGENCIA activado');
        return await this.sendCommand('STOP');
    }

    /**
     * Obtiene el estado actual del Arduino
     */
    getState() {
        return {
            ...this.currentState,
            isConnected: this.isConnected,
            port: this.portPath
        };
    }

    /**
     * Intenta reconectar automáticamente
     */
    attemptReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectTimer = setTimeout(async () => {
            logger.info('Intentando reconectar con Arduino...');
            try {
                await this.connect(this.portPath);
            } catch (error) {
                logger.error('Fallo al reconectar:', error);
                // Intentar de nuevo en 10 segundos
                this.attemptReconnect();
            }
        }, 10000);
    }

    /**
     * Desconecta del Arduino
     */
    async disconnect() {
        try {
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            if (this.port && this.port.isOpen) {
                await new Promise((resolve) => {
                    this.port.close(() => {
                        resolve();
                    });
                });
            }

            this.isConnected = false;
            this.port = null;
            this.parser = null;
            this.emit('disconnected');
            logger.info('Desconectado de Arduino');
        } catch (error) {
            logger.error('Error al desconectar:', error);
            throw error;
        }
    }

    /**
     * Utilidad para delay
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Exportar como Singleton
let instance = null;

module.exports = {
    getInstance: () => {
        if (!instance) {
            instance = new ArduinoController();
        }
        return instance;
    },
    ArduinoController
};


