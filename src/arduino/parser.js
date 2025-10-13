/**
 * parser.js
 * Parser de respuestas del Arduino
 * Interpreta los mensajes recibidos y los convierte en objetos estructurados
 */

const { ARDUINO_RESPONSES, RESPONSE_PATTERNS, ERROR_CODES } = require('./commands');

class ResponseParser {
    /**
     * Parsea una línea de respuesta del Arduino
     * @param {string} line - Línea recibida del Arduino
     * @returns {Object|null} - Objeto con los datos parseados o null
     */
    static parse(line) {
        if (!line || typeof line !== 'string') {
            return null;
        }

        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) {
            return null;
        }

        // Intentar parsear como modo
        const modeResult = this.parseMode(trimmedLine);
        if (modeResult) return modeResult;

        // Intentar parsear como HOME
        const homeResult = this.parseHome(trimmedLine);
        if (homeResult) return homeResult;

        // Intentar parsear como límite
        const limitResult = this.parseLimit(trimmedLine);
        if (limitResult) return limitResult;

        // Intentar parsear como posición
        const positionResult = this.parsePosition(trimmedLine);
        if (positionResult) return positionResult;

        // Intentar parsear como emergencia
        const emergencyResult = this.parseEmergency(trimmedLine);
        if (emergencyResult) return emergencyResult;

        // Intentar parsear como error
        const errorResult = this.parseError(trimmedLine);
        if (errorResult) return errorResult;

        // Si no coincide con ningún patrón, retornar mensaje genérico
        return {
            type: 'message',
            raw: trimmedLine,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Parsea cambios de modo
     */
    static parseMode(line) {
        const match = line.match(RESPONSE_PATTERNS.MODE);
        if (match) {
            const mode = match[1].toLowerCase() === 'manual' ? 'MANUAL' : 'AUTOMATIC';
            return {
                type: 'mode',
                mode: mode,
                message: line,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    /**
     * Parsea mensajes de HOME
     */
    static parseHome(line) {
        // Home Y
        const matchY = line.match(RESPONSE_PATTERNS.HOME_Y);
        if (matchY) {
            const status = matchY[1].toLowerCase();
            return {
                type: 'home',
                axis: 'Y',
                status: status === 'encontrado' ? 'found' : 'searching',
                complete: status === 'encontrado',
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        // Home Z
        const matchZ = line.match(RESPONSE_PATTERNS.HOME_Z);
        if (matchZ) {
            const status = matchZ[1].toLowerCase();
            return {
                type: 'home',
                axis: 'Z',
                status: status === 'encontrado' ? 'found' : 'searching',
                complete: status === 'encontrado',
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        // Secuencia HOME completa
        if (line.includes('Secuencia HOME completada')) {
            return {
                type: 'home',
                axis: 'ALL',
                status: 'complete',
                complete: true,
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        return null;
    }

    /**
     * Parsea mensajes de límites
     */
    static parseLimit(line) {
        // Límite Y
        const matchY = line.match(RESPONSE_PATTERNS.LIMIT_Y);
        if (matchY) {
            const limitType = matchY[1].toLowerCase();
            return {
                type: 'limit',
                axis: 'Y',
                limit: limitType === 'min' ? 'MIN' : 'MAX',
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        // Límite Z
        const matchZ = line.match(RESPONSE_PATTERNS.LIMIT_Z);
        if (matchZ) {
            const limitType = matchZ[1].toLowerCase();
            return {
                type: 'limit',
                axis: 'Z',
                limit: limitType === 'min' ? 'MIN' : 'MAX',
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        return null;
    }

    /**
     * Parsea posiciones de los ejes
     */
    static parsePosition(line) {
        // Posición Y
        const matchY = line.match(RESPONSE_PATTERNS.POSITION_Y);
        if (matchY) {
            return {
                type: 'position',
                axis: 'Y',
                position: parseInt(matchY[1]),
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        // Posición Z
        const matchZ = line.match(RESPONSE_PATTERNS.POSITION_Z);
        if (matchZ) {
            return {
                type: 'position',
                axis: 'Z',
                position: parseInt(matchZ[1]),
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        return null;
    }

    /**
     * Parsea mensajes de emergencia
     */
    static parseEmergency(line) {
        if (RESPONSE_PATTERNS.EMERGENCY.test(line)) {
            const isActive = line.toLowerCase().includes('activado');
            return {
                type: 'emergency',
                active: isActive,
                message: line,
                errorCode: ERROR_CODES.EMERGENCY_STOP,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    /**
     * Parsea mensajes de error
     */
    static parseError(line) {
        if (RESPONSE_PATTERNS.ERROR.test(line)) {
            let errorCode = ERROR_CODES.UNKNOWN_ERROR;
            
            if (line.includes('Modo no valido')) {
                errorCode = ERROR_CODES.INVALID_COMMAND;
            } else if (line.includes('Limite alcanzado')) {
                errorCode = ERROR_CODES.LIMIT_REACHED;
            }

            return {
                type: 'error',
                errorCode: errorCode,
                message: line,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    /**
     * Valida si una respuesta indica éxito
     */
    static isSuccess(parsedResponse) {
        if (!parsedResponse) return false;
        
        return parsedResponse.type !== 'error' && 
               parsedResponse.type !== 'emergency';
    }

    /**
     * Extrae información de error de una respuesta
     */
    static getErrorInfo(parsedResponse) {
        if (!parsedResponse || parsedResponse.type !== 'error') {
            return null;
        }

        return {
            code: parsedResponse.errorCode,
            message: parsedResponse.message,
            timestamp: parsedResponse.timestamp
        };
    }
}

module.exports = ResponseParser;


