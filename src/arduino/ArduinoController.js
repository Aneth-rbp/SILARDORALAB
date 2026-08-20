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
        // Version del firmware que declara la placa. null = todavia no se sabe,
        // o el firmware es tan viejo que no sabe decirla.
        this.firmwareVersion = null;
        // Mientras se graba el firmware el puerto se cierra a proposito; sin
        // esto la reconexion automatica se lo arrebataria a avrdude a media
        // grabacion.
        this.reconexionPausada = false;
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

        // La placa la anuncia sola al arrancar y tambien al preguntarle "FW?".
        if (data.startsWith('FIRMWARE:')) {
            this.firmwareVersion = data.slice('FIRMWARE:'.length).trim();
        }

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
                // En Z el home está ARRIBA, así que las etiquetas del firmware van
                // al revés que en Y. Se usa el mismo criterio que el parseo de
                // STATUS más abajo: limitMax bloquea subir, limitMin bloquea bajar.
                //   "Limite Z Home alcanzado" -> pin 14, tope de ARRIBA
                //   "Limite Z Max alcanzado"  -> pin 15, tope de ABAJO
                // Antes el tope de abajo marcaba limitMax y dejaba el eje sin poder
                // subir para salir de él.
                if (parsed.limit === 'MAX') {
                    this.currentState.axisZ.limitMin = true;
                } else if (parsed.limit === 'HOME' || parsed.limit === 'MIN') {
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
                // Pin 14 (TOP/Home) -> limitMax in JS (blocks steps > 0 / UP)
                this.currentState.axisZ.limitMax = parsed.limitMinZ;
                this.currentState.axisZ.atLimit = parsed.limitMinZ || this.currentState.axisZ.limitMin;
            }
            if (parsed.limitMaxZ !== undefined) {
                // Pin 15 (BOTTOM) -> limitMin in JS (blocks steps < 0 / DOWN)
                this.currentState.axisZ.limitMin = parsed.limitMaxZ;
                this.currentState.axisZ.atLimit = parsed.limitMaxZ || this.currentState.axisZ.limitMax;
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
    /**
     * Arma el JSON de parámetros que entiende el firmware.
     *
     * Lo usan tanto la receta normal (START_RECIPE) como cada etapa de una
     * receta por etapas (ADD_STAGE). Es el mismo juego de parámetros en los dos
     * casos a propósito: una etapa es una receta normal, y si los defaults o el
     * saneado se separaran, una etapa correría distinto a la receta equivalente.
     */
    construirParametrosReceta(parameters) {
        const numDippingLen = Number(parameters.dippingLength);
        const numTransSpeed = Number(parameters.transferSpeed);
        const numDipSpeed = Number(parameters.dipSpeed);
        const numEmersionSpeed = Number(parameters.emersionSpeed);

        const dippingLen = (numDippingLen && numDippingLen > 0) ? numDippingLen : 30;
        // Las dos velocidades viajan en mm/s, tal cual las escribe el operador. La
        // conversión a la unidad de los motores la hace el firmware en
        // velocidadMMsAMicros(), único punto de traducción del sistema: aquí no se
        // puede hacer porque la escala del eje Z es calibrable y vive en la EEPROM.
        // Un 0 significa "aplica tu propio default". Antes se sustituía por 1000,
        // que en la unidad vieja eran microsegundos; leído como mm/s sería una
        // velocidad imposible, y el filtro > 100 descartaba justamente los valores
        // válidos (una emersión de 3 mm/s se convertía en 1000).
        const transSpeed = numTransSpeed > 0 ? numTransSpeed : 0;
        const dippingSpeed = numDipSpeed > 0 ? numDipSpeed : 0;
        // La emersión va aparte de la inmersión porque en SILAR es la que decide
        // el espesor de la capa que queda adherida. Un 0 significa "sube a la
        // misma velocidad con la que bajaste": es como se comportaba el sistema
        // antes de que existiera este parámetro, así que las recetas que ya
        // estaban guardadas corren exactamente igual.
        const emersionSpeed = numEmersionSpeed > 0 ? numEmersionSpeed : 0;

        const jsonParams = JSON.stringify({
            cycles: Number(parameters.cycles) || 1,
            dippingWait0: Number(parameters.dippingWait0) || 5000,
            dippingWait1: Number(parameters.dippingWait1) || 5000,
            dippingWait2: Number(parameters.dippingWait2) || 5000,
            dippingWait3: Number(parameters.dippingWait3) || 5000,
            transferWait: Number(parameters.transferWait) || 2000,
            // Escurrido tras la emersión, antes de viajar al vaso siguiente. Un
            // 0 significa "sin espera": es como corría el equipo antes de que
            // este parámetro existiera, así que las recetas ya guardadas siguen
            // haciendo exactamente lo mismo.
            transitionWait: Number(parameters.transitionWait) || 0,
            exceptDripping1: parameters.exceptDripping1 || false,
            exceptDripping2: parameters.exceptDripping2 || false,
            exceptDripping3: parameters.exceptDripping3 || false,
            exceptDripping4: parameters.exceptDripping4 || false,
            dipStartPosition: Number(parameters.dipStartPosition) || 0,
            dippingLength: dippingLen,
            transferSpeed: transSpeed,
            dipSpeed: dippingSpeed,
            emersionSpeed: emersionSpeed,
            // Posición de cada vaso en mm, medida desde el home de Y. Es un ajuste
            // de la receta por encima de la geometría calibrada de la máquina, para
            // un montaje puntual que no justifica recalibrar el banco. 0 (o vacío)
            // = usar la posición calibrada, que es lo normal.
            posY1: Number(parameters.posY1) || 0,
            posY2: Number(parameters.posY2) || 0,
            posY3: Number(parameters.posY3) || 0,
            posY4: Number(parameters.posY4) || 0,
            fan: parameters.fan || false
        });

        return jsonParams;
    }

    async startRecipe(parameters) {
        if (!this.isConnected) {
            throw new Error('Arduino no conectado');
        }

        const command = `START_RECIPE:${this.construirParametrosReceta(parameters)}`;
        logger.info('Iniciando proceso automático en Arduino', { parameters });
        return await this.sendCommand(command, false, 10000);
    }

    /**
     * Inicia una receta por etapas: varios tramos encadenados en una sola
     * corrida (5 ciclos de una manera, luego 6 de otra, luego 15 de otra).
     *
     * Las etapas se cargan una por una y no en un único comando gigante porque
     * el buffer serie del Arduino son 64 bytes: cada ADD_STAGE ocupa lo mismo
     * que el START_RECIPE que ya funciona. Se espera el acuse de cada etapa
     * antes de mandar la siguiente, que es lo que evita el desbordamiento.
     *
     * Una vez cargadas, la secuencia entera vive en el Arduino: el PC no
     * interviene entre etapa y etapa, así que un cuelgue o una desconexión del
     * puerto no dejan la corrida abandonada a medias.
     */
    async startStagedRecipe(stages) {
        if (!this.isConnected) {
            throw new Error('Arduino no conectado');
        }

        if (!Array.isArray(stages) || stages.length === 0) {
            throw new Error('La receta por etapas no tiene etapas');
        }

        logger.info('Cargando receta por etapas en Arduino', { etapas: stages.length });

        await this.sendCommandAwaitLine('RECIPE_BEGIN', /^RECETA_ETAPAS_INICIO/, 5000);

        for (let i = 0; i < stages.length; i++) {
            const json = this.construirParametrosReceta(stages[i]);
            // El firmware imprime PARAMETROS_RECIBIDOS y sus avisos antes del
            // acuse; sendCommandAwaitLine ignora todo lo que no case con el
            // patrón, así que solo se espera al ETAPA_AGREGADA.
            const acuse = await this.sendCommandAwaitLine(
                `ADD_STAGE:${json}`, /^ETAPA_AGREGADA:/, 10000
            );
            logger.debug(`Etapa ${i + 1}/${stages.length} cargada`, { acuse });
        }

        logger.info('Iniciando receta por etapas en Arduino', { etapas: stages.length });
        return await this.sendCommand('RECIPE_START', false, 10000);
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
     * Envía un comando y espera la primera línea CRUDA que encaje con un patrón.
     *
     * sendCommand(..., waitForResponse) resuelve con el primer evento 'data' que
     * llegue, y como el firmware emite STATUS cada 500 ms casi siempre resuelve
     * con la línea equivocada. Aquí se escucha 'raw' hasta encontrar la línea
     * concreta que se está esperando.
     */
    async sendCommandAwaitLine(command, pattern, timeout = 5000) {
        if (!this.isConnected) {
            throw new Error('Arduino no conectado');
        }

        return new Promise((resolve, reject) => {
            let timeoutHandle;

            const rawHandler = (line) => {
                const texto = String(line).trim();

                // El firmware antiguo no conoce estos comandos y responde
                // "Error: Comando desconocido: X". Sin esto se quedaba esperando
                // hasta el timeout y el mensaje no decía nada útil.
                if (/^Error:\s*Comando desconocido/i.test(texto)) {
                    clearTimeout(timeoutHandle);
                    this.removeListener('raw', rawHandler);
                    reject(new Error(
                        `El firmware de la placa no soporta "${command}". ` +
                        'Sube la versión actual del sketch al Arduino.'
                    ));
                    return;
                }

                if (!pattern.test(texto)) return;
                clearTimeout(timeoutHandle);
                this.removeListener('raw', rawHandler);
                resolve(texto);
            };

            timeoutHandle = setTimeout(() => {
                this.removeListener('raw', rawHandler);
                reject(new Error(`Timeout esperando respuesta a ${command}`));
            }, timeout);

            this.on('raw', rawHandler);

            this.sendCommand(command).catch((err) => {
                clearTimeout(timeoutHandle);
                this.removeListener('raw', rawHandler);
                reject(err);
            });
        });
    }

    /**
     * Trocea una línea "PREFIJO:clave=valor,clave=valor" en un objeto de
     * números. Devuelve null si la línea no lleva el prefijo esperado.
     */
    static parseCalibrationFields(line, prefijo) {
        const texto = String(line).trim();
        if (!texto.startsWith(`${prefijo}:`)) return null;

        const campos = {};
        texto.substring(prefijo.length + 1).split(',').forEach((par) => {
            const [clave, valor] = par.split('=');
            if (clave && valor !== undefined) campos[clave.trim()] = Number(valor);
        });
        return campos;
    }

    /**
     * Convierte "CAL_Z:ppm=20.0000,home=275.00,min=25.00,fondo=-5000,z=-2500"
     * en un objeto. Devuelve null si la línea no tiene el formato esperado.
     */
    static parseCalibrationLine(line) {
        const campos = ArduinoController.parseCalibrationFields(line, 'CAL_Z');
        if (!campos) return null;

        return {
            stepsPerMm: campos.ppm,
            homeHeightMm: campos.home,
            minHeightMm: campos.min,
            floorSteps: campos.fondo,
            currentSteps: campos.z
        };
    }

    /**
     * Lee la calibración del eje Z que el firmware tiene cargada ahora mismo.
     */
    async getZCalibration() {
        const linea = await this.sendCommandAwaitLine('CAL_Z?', /^CAL_Z:/, 5000);
        const calibracion = ArduinoController.parseCalibrationLine(linea);
        if (!calibracion) {
            throw new Error(`Respuesta de calibración no reconocida: ${linea}`);
        }
        return calibracion;
    }

    /**
     * Aplica una calibración en la RAM del firmware (no sobrevive al reinicio).
     * Los tres campos son opcionales: se envía solo lo que se quiere cambiar.
     */
    async setZCalibration({ stepsPerMm, homeHeightMm, minHeightMm } = {}) {
        const campos = [];
        if (Number.isFinite(Number(stepsPerMm))) campos.push(`ppm=${Number(stepsPerMm)}`);
        if (Number.isFinite(Number(homeHeightMm))) campos.push(`home=${Number(homeHeightMm)}`);
        if (Number.isFinite(Number(minHeightMm))) campos.push(`min=${Number(minHeightMm)}`);

        if (campos.length === 0) {
            throw new Error('No se indicó ningún valor de calibración');
        }

        logger.info('Aplicando calibración de Z', { stepsPerMm, homeHeightMm, minHeightMm });
        const linea = await this.sendCommandAwaitLine(
            `CAL_Z_SET:${campos.join(',')}`,
            /^(CAL_Z:|CAL_Z_ERROR)/,
            5000
        );

        if (linea.startsWith('CAL_Z_ERROR')) {
            throw new Error(linea.replace(/^CAL_Z_ERROR:\s*/, ''));
        }

        return ArduinoController.parseCalibrationLine(linea);
    }

    /**
     * Persiste en EEPROM la calibración que el firmware tiene cargada.
     */
    async saveZCalibration() {
        logger.info('Guardando calibración de Z en EEPROM');
        const linea = await this.sendCommandAwaitLine('CAL_Z_SAVE', /^CAL_Z:/, 5000);
        return ArduinoController.parseCalibrationLine(linea);
    }

    /**
     * Devuelve la calibración a los valores de fábrica del firmware.
     */
    async resetZCalibration() {
        logger.warn('Restaurando calibración de Z a valores de fábrica');
        const linea = await this.sendCommandAwaitLine('CAL_Z_RESET', /^CAL_Z:/, 5000);
        return ArduinoController.parseCalibrationLine(linea);
    }

    /**
     * Convierte "CAL_Y:ppm=76.3636,v1=0.00,v2=55.00,...,p1=0,p2=4200,...,y=0"
     * en un objeto. Devuelve null si la línea no tiene el formato esperado.
     *
     * v1..v4 son las posiciones que el usuario edita (mm) y p1..p4 las mismas
     * posiciones ya convertidas a pasos por el firmware. Se leen las dos: los mm
     * para rellenar el formulario y los pasos para mostrar contra qué se compara
     * el final de carrera, sin recalcular la conversión aquí.
     */
    static parseYCalibrationLine(line) {
        const campos = ArduinoController.parseCalibrationFields(line, 'CAL_Y');
        if (!campos) return null;

        return {
            stepsPerMm: campos.ppm,
            vesselPositionsMm: [campos.v1, campos.v2, campos.v3, campos.v4],
            positions: [campos.p1, campos.p2, campos.p3, campos.p4],
            axisLimitSteps: campos.tope,
            maxSpeedMms: campos.vmax,
            currentSteps: campos.y
        };
    }

    /**
     * Lee la geometría del eje Y que el firmware tiene cargada ahora mismo.
     */
    async getYCalibration() {
        const linea = await this.sendCommandAwaitLine('CAL_Y?', /^CAL_Y:/, 5000);
        const calibracion = ArduinoController.parseYCalibrationLine(linea);
        if (!calibracion) {
            throw new Error(`Respuesta de geometría de Y no reconocida: ${linea}`);
        }
        return calibracion;
    }

    /**
     * Aplica una geometría de Y en la RAM del firmware (no sobrevive al
     * reinicio). Todos los campos son opcionales y cada vaso va por separado:
     * mover un vaso no debe obligar a reescribir la posición de los otros tres,
     * ni asumir que están igualmente espaciados.
     */
    async setYCalibration({ stepsPerMm, vesselPositionsMm } = {}) {
        const campos = [];
        if (Number.isFinite(Number(stepsPerMm))) campos.push(`ppm=${Number(stepsPerMm)}`);

        const posiciones = Array.isArray(vesselPositionsMm) ? vesselPositionsMm : [];
        posiciones.slice(0, 4).forEach((mm, i) => {
            if (Number.isFinite(Number(mm))) campos.push(`v${i + 1}=${Number(mm)}`);
        });

        if (campos.length === 0) {
            throw new Error('No se indicó ningún valor de geometría');
        }

        logger.info('Aplicando geometría de Y', { stepsPerMm, vesselPositionsMm });
        const linea = await this.sendCommandAwaitLine(
            `CAL_Y_SET:${campos.join(',')}`,
            /^(CAL_Y:|CAL_Y_ERROR)/,
            5000
        );

        if (linea.startsWith('CAL_Y_ERROR')) {
            throw new Error(linea.replace(/^CAL_Y_ERROR:\s*/, ''));
        }

        return ArduinoController.parseYCalibrationLine(linea);
    }

    /**
     * Persiste en EEPROM la geometría de Y que el firmware tiene cargada.
     */
    async saveYCalibration() {
        logger.info('Guardando geometría de Y en EEPROM');
        const linea = await this.sendCommandAwaitLine('CAL_Y_SAVE', /^CAL_Y:/, 5000);
        return ArduinoController.parseYCalibrationLine(linea);
    }

    /**
     * Devuelve la geometría de Y a los valores de fábrica del firmware.
     */
    async resetYCalibration() {
        logger.warn('Restaurando geometría de Y a valores de fábrica');
        const linea = await this.sendCommandAwaitLine('CAL_Y_RESET', /^CAL_Y:/, 5000);
        return ArduinoController.parseYCalibrationLine(linea);
    }

    /**
     * Jog de Z en pasos crudos que ESPERA a que el movimiento termine.
     *
     * moveAxisZ() vuelve en cuanto escribe en el puerto, lo que sirve para la
     * pantalla manual pero no para calibrar: ahí hay que pedirle al operador que
     * mida justo cuando el eje se ha parado. El firmware cierra el movimiento
     * imprimiendo "Z: <posicion>".
     */
    async jogZSteps(steps) {
        const pasos = Number(steps);
        if (!Number.isInteger(pasos) || pasos === 0) {
            throw new Error('Los pasos deben ser un entero distinto de cero');
        }

        // Con el paro activo el firmware contesta con un error y NO imprime la
        // posición, así que sin esto la espera se comía los 60 s de timeout
        // enteros antes de decir nada.
        if (this.currentState.emergencyStop) {
            throw new Error('No se puede mover el eje: Paro de emergencia activo');
        }

        logger.info(`Jog de calibración en Z: ${pasos} pasos`);
        this.currentState.axisZ.moving = true;
        try {
            const linea = await this.sendCommandAwaitLine(`Z${pasos}`, /^Z:\s*-?\d+/, 60000);
            this.currentState.axisZ.moving = false;
            const posicion = Number(linea.split(':')[1]);
            return { success: true, currentSteps: posicion };
        } catch (error) {
            this.currentState.axisZ.moving = false;
            throw error;
        }
    }

    /**
     * Jog de Y en pasos crudos que ESPERA a que el movimiento termine, igual
     * que jogZSteps y por el mismo motivo: el asistente de geometría pide medir
     * con la regla justo cuando el eje se ha parado, y necesita la posición
     * real del eje (no la que se supone) para capturar dónde queda cada vaso.
     * El firmware cierra el movimiento imprimiendo "Y: <posicion>".
     */
    async jogYSteps(steps) {
        const pasos = Number(steps);
        if (!Number.isInteger(pasos) || pasos === 0) {
            throw new Error('Los pasos deben ser un entero distinto de cero');
        }

        // Con el paro activo el firmware contesta con un error y NO imprime la
        // posición, así que sin esto la espera se comía los 60 s de timeout
        // enteros antes de decir nada.
        if (this.currentState.emergencyStop) {
            throw new Error('No se puede mover el eje: Paro de emergencia activo');
        }

        logger.info(`Jog de calibración en Y: ${pasos} pasos`);
        this.currentState.axisY.moving = true;
        try {
            const linea = await this.sendCommandAwaitLine(`Y${pasos}`, /^Y:\s*-?\d+/, 60000);
            this.currentState.axisY.moving = false;
            const posicion = Number(linea.split(':')[1]);
            return { success: true, currentSteps: posicion };
        } catch (error) {
            this.currentState.axisY.moving = false;
            throw error;
        }
    }

    /**
     * Lleva el eje Z a una altura absoluta sobre el suelo, en mm.
     * Es el movimiento de verificación de la calibración.
     */
    async moveZToHeight(heightMm) {
        const altura = Number(heightMm);
        if (!Number.isFinite(altura)) {
            throw new Error('Altura inválida');
        }

        logger.info(`Moviendo Z a ${altura} mm sobre el suelo`);
        this.currentState.axisZ.moving = true;
        try {
            const linea = await this.sendCommandAwaitLine(
                `GOTO_MM:${altura}`,
                /^GOTO_MM_ALCANZADO:/,
                60000
            );
            this.currentState.axisZ.moving = false;
            return { success: true, response: linea };
        } catch (error) {
            this.currentState.axisZ.moving = false;
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
     * Le pregunta a la placa que firmware trae.
     *
     * Devuelve null si no contesta o si contesta que no conoce el comando: un
     * firmware anterior a FW? no sabe responder, y para el caso eso significa
     * lo mismo que "trae uno viejo".
     */
    async consultarVersionFirmware(timeout = 3000) {
        if (!this.isConnected) return null;

        try {
            const linea = await this.sendCommandAwaitLine('FW?', /^FIRMWARE:/, timeout);
            this.firmwareVersion = linea.slice(linea.indexOf(':') + 1).trim();
        } catch (error) {
            logger.info(`La placa no informa su firmware: ${error.message}`);
            this.firmwareVersion = null;
        }

        return this.firmwareVersion;
    }

    /**
     * Suelta el puerto para que lo pueda usar avrdude y deja de reconectar solo.
     */
    async liberarPuertoParaGrabar() {
        this.reconexionPausada = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        await this.disconnect();
    }

    /**
     * Vuelve a tomar el puerto despues de grabar.
     *
     * Al terminar avrdude la placa se reinicia: el bootloader espera un par de
     * segundos antes de arrancar el sketch, y en Windows el puerto tarda un
     * momento en quedar libre. Por eso espera y reintenta en vez de conectar de
     * golpe; si se rinde, queda la reconexion automatica de siempre.
     */
    async retomarPuertoTrasGrabar(portPath = null) {
        this.firmwareVersion = null;
        const puerto = portPath || this.portPath;

        for (let intento = 1; intento <= 3; intento++) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            try {
                const resultado = await this.connect(puerto);
                this.reconexionPausada = false;
                return resultado;
            } catch (error) {
                logger.warn(`Reconexion tras grabar, intento ${intento}: ${error.message}`);
            }
        }

        this.reconexionPausada = false;
        this.attemptReconnect();
        throw new Error('No se pudo reabrir el puerto despues de grabar');
    }

    /**
     * Intenta reconectar automáticamente
     */
    attemptReconnect() {
        if (this.reconexionPausada) {
            logger.info('Reconexion en pausa (grabando firmware)');
            return;
        }

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


