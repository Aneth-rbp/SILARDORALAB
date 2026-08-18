/**
 * commands.js
 * Definición de comandos y respuestas del Arduino
 * Basado en el protocolo del sketch de Arduino adjunto
 */

/**
 * Comandos que se envían desde el PC al Arduino
 */
const ARDUINO_COMMANDS = {
    // Modos de operación
    MODE_MANUAL: '1',      // Cambiar a modo manual
    MODE_AUTOMATIC: '2',   // Cambiar a modo automático
    HOME: '3',             // Ejecutar secuencia HOME
    
    // Comandos de movimiento (se construyen dinámicamente)
    // Formato: Y<pasos> o Z<pasos>
    // Ejemplo: Y1000, Z-500
    
    // Comandos de proceso automático
    START_RECIPE: 'START_RECIPE:',  // Iniciar proceso automático con parámetros JSON
    PAUSE: 'PAUSE',                 // Pausar proceso automático
    RESUME: 'RESUME',               // Reanudar proceso automático

    // Receta por etapas: varios tramos encadenados en una sola corrida. Se
    // cargan de uno en uno (RECIPE_BEGIN, un ADD_STAGE por etapa, RECIPE_START)
    // porque el buffer serie del Arduino son 64 bytes y un comando con todas
    // las etapas juntas no cabría. Cada etapa lleva el mismo JSON que
    // START_RECIPE.
    RECIPE_BEGIN: 'RECIPE_BEGIN',   // Vaciar la lista de etapas
    ADD_STAGE: 'ADD_STAGE:',        // Agregar una etapa con parámetros JSON
    RECIPE_START: 'RECIPE_START',   // Iniciar la secuencia de etapas cargada
    
    // Comandos de emergencia
    STOP: 'STOP',         // Paro de emergencia / Detener proceso
    RESET: 'RESET',       // Reiniciar sistema
    
    // Comandos de consulta
    STATUS: 'STATUS',     // Solicitar estado actual
    VERSION: 'VERSION'    // Solicitar versión del firmware
};

/**
 * Respuestas esperadas del Arduino
 * Basado en los Serial.println() del código Arduino
 */
const ARDUINO_RESPONSES = {
    // Respuestas de modo
    MODE_MANUAL: 'Modo Manual',
    MODE_AUTOMATIC: 'Modo Automatico',
    
    // Respuestas de HOME
    HOME_Y_START: 'Buscando Home Y',
    HOME_Y_FOUND: 'Home Y encontrado',
    HOME_Z_START: 'Buscando Home Z',
    HOME_Z_FOUND: 'Home Z encontrado',
    HOME_COMPLETE: 'Secuencia HOME completada',
    
    // Respuestas de proceso automático
    PARAMETROS_RECIBIDOS: 'PARAMETROS_RECIBIDOS',
    PROCESO_INICIADO: 'PROCESO_INICIADO',
    PROCESO_PAUSADO: 'PROCESO_PAUSADO',
    PROCESO_REANUDADO: 'PROCESO_REANUDADO',
    PROCESO_DETENIDO: 'PROCESO_DETENIDO',
    PROCESO_COMPLETADO: 'PROCESO_COMPLETADO',
    CICLO_INICIADO: 'CICLO_INICIADO',
    CICLO_COMPLETADO: 'CICLO_COMPLETADO',
    RECETA_ETAPAS_INICIO: 'RECETA_ETAPAS_INICIO',
    ETAPA_AGREGADA: 'ETAPA_AGREGADA',
    ETAPA_INICIADA: 'ETAPA_INICIADA',
    ETAPA_COMPLETADA: 'ETAPA_COMPLETADA',
    INMERSION_INICIADA: 'INMERSION_INICIADA',
    INMERSION_COMPLETADA: 'INMERSION_COMPLETADA',
    VENTILADOR_ACTIVADO: 'VENTILADOR_ACTIVADO',
    VENTILADOR_DESACTIVADO: 'VENTILADOR_DESACTIVADO',
    
    // Respuestas de límites
    LIMIT_Y_MIN: 'Limite Y Min alcanzado',
    LIMIT_Y_MAX: 'Limite Y Max alcanzado',
    LIMIT_Z_MIN: 'Limite Z Min alcanzado',
    LIMIT_Z_MAX: 'Limite Z Max alcanzado',
    
    // Respuestas de movimiento
    MOVE_Y: 'Moviendo Eje Y',
    MOVE_Z: 'Moviendo Eje Z',
    MOVE_COMPLETE: 'Movimiento completado',
    
    // Respuestas de emergencia
    EMERGENCY_ACTIVE: 'PARO DE EMERGENCIA ACTIVADO',
    EMERGENCY_CLEARED: 'Paro de emergencia desactivado',
    
    // Respuestas de error
    ERROR_MODE: 'Error: Modo no valido',
    ERROR_LIMIT: 'Error: Limite alcanzado',
    ERROR_COMMAND: 'Error: Comando desconocido'
};

/**
 * Patrones de respuesta para parsing
 */
const RESPONSE_PATTERNS = {
    MODE: /Modo\s+(Manual|Automatico)/i,
    HOME_Y: /Home Y\s+(encontrado|buscando)/i,
    HOME_Z: /Home Z\s+(encontrado|buscando)/i,
    LIMIT_Y: /Limite Y\s+(Min|Max)/i,
    LIMIT_Z: /Limite Z\s+(Min|Max)/i,
    // Anclados: sin ^...$ tambien capturaban "Moviendo Y: -100" y el numero de
    // pasos se interpretaba como posicion absoluta.
    POSITION_Y: /^Y:\s*(-?\d+)$/,
    POSITION_Z: /^Z:\s*(-?\d+)$/,
    // "ETAPA_INICIADA: 2/3 Ciclos=6" -> etapa en curso y total de etapas.
    ETAPA: /^ETAPA_(INICIADA|COMPLETADA):\s*(\d+)\/(\d+)/,
    EMERGENCY: /PARO DE EMERGENCIA/i,
    ERROR: /Error:/i
};

/**
 * Configuración de los ejes según el código Arduino
 */
const AXIS_CONFIG = {
    Y: {
        DIR_PIN: 2,
        STEP_PIN: 3,
        ENABLE_PIN: 4,
        HOME_PIN: 9,
        LIMIT_MIN_PIN: 10,
        LIMIT_MAX_PIN: 11,
        STEPS_PER_REV: 200,    // 200 pasos por revolución (motor típico)
        DEFAULT_SPEED: 1000,   // Microsegundos entre pasos
        HOME_SPEED: 2000       // Velocidad para buscar home (más lento)
    },
    Z: {
        DIR_PIN: 5,
        STEP_PIN: 6,
        ENABLE_PIN: 7,
        HOME_PIN: 12,
        LIMIT_MIN_PIN: 13,
        LIMIT_MAX_PIN: 8,
        STEPS_PER_REV: 200,
        DEFAULT_SPEED: 1000,
        HOME_SPEED: 2000
    },
    EMERGENCY_PIN: 14
};

/**
 * Estados del sistema
 */
const SYSTEM_STATES = {
    DISCONNECTED: 'disconnected',
    CONNECTED: 'connected',
    MANUAL: 'manual',
    AUTOMATIC: 'automatic',
    HOMING: 'homing',
    RUNNING: 'running',
    PAUSED: 'paused',
    ERROR: 'error',
    EMERGENCY: 'emergency'
};

/**
 * Códigos de error
 */
const ERROR_CODES = {
    CONNECTION_FAILED: 'E001',
    TIMEOUT: 'E002',
    LIMIT_REACHED: 'E003',
    EMERGENCY_STOP: 'E004',
    INVALID_COMMAND: 'E005',
    HOME_FAILED: 'E006',
    UNKNOWN_ERROR: 'E999'
};

module.exports = {
    ARDUINO_COMMANDS,
    ARDUINO_RESPONSES,
    RESPONSE_PATTERNS,
    AXIS_CONFIG,
    SYSTEM_STATES,
    ERROR_CODES
};


