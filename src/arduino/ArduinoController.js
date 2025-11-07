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
                atLimit: false,
                limitMin: false,
                limitMax: false
            },
            axisZ: {
                position: 0,
                moving: false,
                atHome: false,
                atLimit: false,
                limitMin: false,
                limitMax: false
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
            
            logger.info(`Escaneando ${ports.length} puerto(s) disponible(s)...`);
            ports.forEach(port => {
                logger.debug(`Puerto encontrado: ${port.path} - Vendor: ${port.vendorId || 'N/A'}, Product: ${port.productId || 'N/A'}, Manufacturer: ${port.manufacturer || 'N/A'}, Friendly: ${port.friendlyName || 'N/A'}`);
            });
            
            // Buscar Arduino por fabricante o identificadores conocidos
            const arduinoPort = ports.find(port => {
                const manufacturer = (port.manufacturer || '').toLowerCase();
                const friendlyName = (port.friendlyName || '').toLowerCase();
                const vendorId = (port.vendorId || '').toLowerCase();
                const productId = (port.productId || '').toLowerCase();

                const knownVendors = new Set([
                    '2341', // Arduino/Genuino
                    '2a03', // Arduino SA
                    '1a86', // CH340/CH341
                    '10c4', // Silicon Labs CP210x
                    '0403'  // FTDI
                ]);

                const knownProducts = new Set([
                    '0043', // Arduino Uno
                    '0010', // Arduino Mega 2560 (USB Serial)
                    '0042', // Arduino Mega 2560 Rev3
                    '0210', // Arduino Mega ADK
                    '0001', // Arduino Leonardo
                    '0036', // Arduino Micro
                    '0037', // Arduino Due
                    '7523', // CH340
                    'ea60', // CP2102
                    '6001'  // FT232
                ]);

                return manufacturer.includes('arduino') || 
                       manufacturer.includes('ch340') || 
                       manufacturer.includes('ftdi') ||
                       manufacturer.includes('silicon labs') ||
                       friendlyName.includes('arduino') ||
                       friendlyName.includes('mega') ||
                       friendlyName.includes('uno') ||
                       friendlyName.includes('nano') ||
                       knownVendors.has(vendorId) ||
                       knownProducts.has(productId);
            });

            if (arduinoPort) {
                const detectedModel = arduinoPort.friendlyName || 
                                     (arduinoPort.productId === '0042' ? 'Mega 2560 Rev3' : 
                                      arduinoPort.productId === '0010' ? 'Mega 2560' :
                                      arduinoPort.productId === '0043' ? 'Uno' : 'Arduino');
                logger.info(`Arduino ${detectedModel} detectado en puerto: ${arduinoPort.path} (VID: ${arduinoPort.vendorId || 'N/A'}, PID: ${arduinoPort.productId || 'N/A'})`);
                return arduinoPort.path;
            }

            // Si no se encuentra, intentar con algún puerto USB reconocido
            if (ports.length > 0) {
                const usbPort = ports.find(port => port.vendorId || port.productId);
                const fallback = usbPort || ports[0];
                logger.warn(`Arduino no detectado específicamente, usando: ${fallback.path}`);
                return fallback.path;
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
                autoOpen: false,
                encoding: 'utf8' // Asegurar codificación UTF-8
            });

            // Configurar parser de líneas con codificación UTF-8
            this.parser = this.port.pipe(new ReadlineParser({ 
                delimiter: '\n',
                encoding: 'utf8'
            }));

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

            // Solicitar estado inicial después de conectar
            try {
                await this.delay(500); // Pequeña pausa adicional
                await this.requestStatus();
            } catch (error) {
                logger.warn('No se pudo obtener estado inicial del Arduino, continuando...', error.message);
            }

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
                this.currentState.axisY.moving = false;
            } else if (parsed.axis === 'Z') {
                this.currentState.axisZ.position = parsed.position;
                this.currentState.axisZ.moving = false;
            }
        } else if (parsed.type === 'movement') {
            if (parsed.axis === 'Y') {
                if (parsed.interrupted) {
                    this.currentState.axisY.moving = false;
                } else {
                    this.currentState.axisY.moving = true;
                }
            } else if (parsed.axis === 'Z') {
                if (parsed.interrupted) {
                    this.currentState.axisZ.moving = false;
                } else {
                    this.currentState.axisZ.moving = true;
                }
            }
        } else if (parsed.type === 'limit') {
            if (parsed.axis === 'Y') {
                this.currentState.axisY.atLimit = true;
                this.currentState.axisY.moving = false;
                if (parsed.limit === 'MIN') {
                    this.currentState.axisY.limitMin = true;
                } else if (parsed.limit === 'MAX') {
                    this.currentState.axisY.limitMax = true;
                }
            } else if (parsed.axis === 'Z') {
                this.currentState.axisZ.atLimit = true;
                this.currentState.axisZ.moving = false;
                if (parsed.limit === 'MIN') {
                    this.currentState.axisZ.limitMin = true;
                } else if (parsed.limit === 'MAX') {
                    this.currentState.axisZ.limitMax = true;
                }
            }
        } else if (parsed.type === 'home') {
            if (parsed.axis === 'Y') {
                if (parsed.status === 'found' || parsed.complete) {
                    this.currentState.axisY.atHome = true;
                    this.currentState.axisY.position = 0;
                    this.currentState.axisY.moving = false;
                } else if (parsed.status === 'searching') {
                    this.currentState.axisY.moving = true;
                }
            } else if (parsed.axis === 'Z') {
                if (parsed.status === 'found' || parsed.complete) {
                    this.currentState.axisZ.atHome = true;
                    this.currentState.axisZ.position = 0;
                    this.currentState.axisZ.moving = false;
                } else if (parsed.status === 'searching') {
                    this.currentState.axisZ.moving = true;
                }
            }
        } else if (parsed.type === 'emergency') {
            this.currentState.emergencyStop = parsed.active;
            if (parsed.active) {
                // Detener todos los movimientos
                this.currentState.axisY.moving = false;
                this.currentState.axisZ.moving = false;
            }
        } else if (parsed.type === 'status') {
            // Actualizar estado completo desde STATUS
            this.currentState.mode = parsed.mode || this.currentState.mode;
            this.currentState.emergencyStop = parsed.emergencyStop !== undefined ? parsed.emergencyStop : this.currentState.emergencyStop;
            
            if (parsed.positionY !== undefined) {
                this.currentState.axisY.position = parsed.positionY;
            }
            if (parsed.positionZ !== undefined) {
                this.currentState.axisZ.position = parsed.positionZ;
            }
            if (parsed.homeY !== undefined) {
                this.currentState.axisY.atHome = parsed.homeY;
            }
            if (parsed.homeZ !== undefined) {
                this.currentState.axisZ.atHome = parsed.homeZ;
            }
            if (parsed.limitMinY !== undefined) {
                this.currentState.axisY.limitMin = parsed.limitMinY;
                this.currentState.axisY.atLimit = parsed.limitMinY || this.currentState.axisY.limitMax;
            }
            if (parsed.limitMaxY !== undefined) {
                this.currentState.axisY.limitMax = parsed.limitMaxY;
                this.currentState.axisY.atLimit = parsed.limitMaxY || this.currentState.axisY.limitMin;
            }
            if (parsed.limitMinZ !== undefined) {
                this.currentState.axisZ.limitMin = parsed.limitMinZ;
                this.currentState.axisZ.atLimit = parsed.limitMinZ || this.currentState.axisZ.limitMax;
            }
            if (parsed.limitMaxZ !== undefined) {
                this.currentState.axisZ.limitMax = parsed.limitMaxZ;
                this.currentState.axisZ.atLimit = parsed.limitMaxZ || this.currentState.axisZ.limitMin;
            }
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
        if (this.currentState.emergencyStop) {
            throw new Error('No se puede ejecutar HOME: Paro de emergencia activo');
        }
        
        logger.info('Ejecutando HOME');
        this.currentState.axisY.moving = true;
        this.currentState.axisZ.moving = true;
        try {
            const result = await this.sendCommand(ARDUINO_COMMANDS.HOME, false, 60000); // Timeout más largo para HOME
            return result;
        } catch (error) {
            this.currentState.axisY.moving = false;
            this.currentState.axisZ.moving = false;
            throw error;
        }
    }

    async moveAxisY(steps) {
        if (!Number.isInteger(steps)) {
            throw new Error('Los pasos deben ser un número entero');
        }
        if (this.currentState.emergencyStop) {
            throw new Error('No se puede mover: Paro de emergencia activo');
        }
        if (this.currentState.axisY.atLimit && ((steps > 0 && this.currentState.axisY.limitMax) || (steps < 0 && this.currentState.axisY.limitMin))) {
            throw new Error('No se puede mover: Límite alcanzado');
        }
        
        logger.info(`Moviendo eje Y: ${steps} pasos`);
        this.currentState.axisY.moving = true;
        try {
            const result = await this.sendCommand(`Y${steps}`);
            return result;
        } catch (error) {
            this.currentState.axisY.moving = false;
            throw error;
        }
    }

    async moveAxisZ(steps) {
        if (!Number.isInteger(steps)) {
            throw new Error('Los pasos deben ser un número entero');
        }
        if (this.currentState.emergencyStop) {
            throw new Error('No se puede mover: Paro de emergencia activo');
        }
        if (this.currentState.axisZ.atLimit && ((steps > 0 && this.currentState.axisZ.limitMax) || (steps < 0 && this.currentState.axisZ.limitMin))) {
            throw new Error('No se puede mover: Límite alcanzado');
        }
        
        logger.info(`Moviendo eje Z: ${steps} pasos`);
        this.currentState.axisZ.moving = true;
        try {
            const result = await this.sendCommand(`Z${steps}`);
            return result;
        } catch (error) {
            this.currentState.axisZ.moving = false;
            throw error;
        }
    }

    async emergencyStop() {
        logger.warn('PARO DE EMERGENCIA activado');
        return await this.sendCommand('STOP');
    }

    /**
     * Inicia un proceso automático con parámetros de receta
     */
    async startRecipe(parameters) {
        if (!this.isConnected) {
            throw new Error('Arduino no conectado');
        }
        
        // Construir comando START_RECIPE con parámetros JSON
        const jsonParams = JSON.stringify({
            cycles: parameters.cycles || 1,
            dippingWait0: parameters.dippingWait0 || 5000,
            dippingWait1: parameters.dippingWait1 || 5000,
            dippingWait2: parameters.dippingWait2 || 5000,
            dippingWait3: parameters.dippingWait3 || 5000,
            transferWait: parameters.transferWait || 2000,
            exceptDripping1: parameters.exceptDripping1 || false,
            exceptDripping2: parameters.exceptDripping2 || false,
            exceptDripping3: parameters.exceptDripping3 || false,
            exceptDripping4: parameters.exceptDripping4 || false,
            dipStartPosition: parameters.dipStartPosition || 0,
            dippingLength: parameters.dippingLength || 10000,
            transferSpeed: parameters.transferSpeed || 1000,
            dipSpeed: parameters.dipSpeed || 1000,
            fan: parameters.fan || false
        });
        
        const command = `START_RECIPE:${jsonParams}`;
        logger.info('Iniciando proceso automático en Arduino', { parameters });
        return await this.sendCommand(command, false, 10000);
    }

    /**
     * Pausa el proceso automático
     */
    async pauseProcess() {
        logger.info('Pausando proceso automático');
        return await this.sendCommand('PAUSE');
    }

    /**
     * Reanuda el proceso automático
     */
    async resumeProcess() {
        logger.info('Reanudando proceso automático');
        return await this.sendCommand('RESUME');
    }

    /**
     * Solicita el estado actual del Arduino
     */
    async requestStatus() {
        logger.info('Solicitando estado del Arduino');
        try {
            const response = await this.sendCommand(ARDUINO_COMMANDS.STATUS, true, 3000);
            return response;
        } catch (error) {
            logger.error('Error solicitando estado:', error);
            throw error;
        }
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


