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

        // Intentar parsear como STATUS
        const statusResult = this.parseStatus(trimmedLine);
        if (statusResult) return statusResult;

        // Intentar parsear como movimiento
        const movementResult = this.parseMovement(trimmedLine);
        if (movementResult) return movementResult;

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
        // Patrones mejorados para límites
        const limitPatterns = [
            { pattern: /Limite\s+Y\s+Min\s+alcanzado/i, axis: 'Y', limit: 'MIN' },
            { pattern: /Limite\s+Y\s+Max\s+alcanzado/i, axis: 'Y', limit: 'MAX' },
            { pattern: /Limite\s+Z\s+Min\s+alcanzado/i, axis: 'Z', limit: 'MIN' },
            { pattern: /Limite\s+Z\s+Max\s+alcanzado/i, axis: 'Z', limit: 'MAX' },
            // Patrón genérico como fallback
            { pattern: /Limite\s+Y\s+(Min|Max)/i, axis: 'Y', limit: null },
            { pattern: /Limite\s+Z\s+(Min|Max)/i, axis: 'Z', limit: null }
        ];

        for (const limitPattern of limitPatterns) {
            const match = line.match(limitPattern.pattern);
            if (match) {
                let limitType = limitPattern.limit;
                if (!limitType && match[1]) {
                    limitType = match[1].toLowerCase() === 'min' ? 'MIN' : 'MAX';
                }
                return {
                    type: 'limit',
                    axis: limitPattern.axis,
                    limit: limitType,
                    message: line,
                    timestamp: new Date().toISOString()
                };
            }
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
     * Parsea mensajes de movimiento
     */
    static parseMovement(line) {
        const matchY = line.match(/Moviendo Y:\s*([+-])(\d+)/i);
        if (matchY) {
            return {
                type: 'movement',
                axis: 'Y',
                direction: matchY[1] === '+' ? 1 : -1,
                steps: parseInt(matchY[2]),
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        const matchZ = line.match(/Moviendo Z:\s*([+-])(\d+)/i);
        if (matchZ) {
            return {
                type: 'movement',
                axis: 'Z',
                direction: matchZ[1] === '+' ? 1 : -1,
                steps: parseInt(matchZ[2]),
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        const interruptY = line.match(/Movimiento Y interrumpido/i);
        if (interruptY) {
            return {
                type: 'movement',
                axis: 'Y',
                interrupted: true,
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        const interruptZ = line.match(/Movimiento Z interrumpido/i);
        if (interruptZ) {
            return {
                type: 'movement',
                axis: 'Z',
                interrupted: true,
                message: line,
                timestamp: new Date().toISOString()
            };
        }

        return null;
    }

    /**
     * Parsea respuesta de STATUS
     */
    static parseStatus(line) {
        if (!line.startsWith('STATUS:')) {
            return null;
        }

        const statusData = {};
        const parts = line.substring(7).split(','); // Remover "STATUS:"

        parts.forEach(part => {
            const [key, value] = part.split('=');
            if (key && value !== undefined) {
                if (key === 'Mode') {
                    statusData.mode = value;
                } else if (key === 'Emergency') {
                    statusData.emergencyStop = value === '1';
                } else if (key === 'Y' || key === 'Z') {
                    statusData[`position${key}`] = parseInt(value);
                } else if (key.startsWith('Home')) {
                    const axis = key.replace('Home', '');
                    statusData[`home${axis}`] = value === '1';
                } else if (key.includes('Limit')) {
                    const match = key.match(/Limit(Min|Max)([YZ])/);
                    if (match) {
                        const limitType = match[1];
                        const axis = match[2];
                        statusData[`limit${limitType}${axis}`] = value === '1';
                    }
                }
            }
        });

        return {
            type: 'status',
            ...statusData,
            message: line,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Parsea mensajes de error
     */
    static parseError(line) {
        if (RESPONSE_PATTERNS.ERROR.test(line)) {
            let errorCode = ERROR_CODES.UNKNOWN_ERROR;
            
            if (line.includes('Modo no valido') || line.includes('Comando desconocido')) {
                errorCode = ERROR_CODES.INVALID_COMMAND;
            } else if (line.includes('Limite alcanzado') || line.includes('Paro de emergencia activo')) {
                errorCode = ERROR_CODES.LIMIT_REACHED;
            } else if (line.includes('Paro de emergencia')) {
                errorCode = ERROR_CODES.EMERGENCY_STOP;
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


