/**
 * Graba el firmware del Arduino desde la propia aplicacion.
 *
 * El instalador trae el .hex ya compilado y un avrdude (los deja
 * scripts/compilar-firmware.js y los empaqueta electron-builder como
 * extraResources), asi que el firmware llega a la maquina en la misma
 * actualizacion automatica que la aplicacion, sin que nadie tenga que abrir el
 * Arduino IDE en el laboratorio.
 *
 * Dos cosas que NO se pueden tocar sin pensarlo dos veces:
 *
 * - El "-D" de avrdude. Sin el, avrdude borra el chip entero *incluida la
 *   EEPROM*, y ahi viven las calibraciones de Z y de Y. Perderlas obliga a
 *   recalibrar la maquina con una regla, en sitio. Es el mismo flag que usa el
 *   Arduino IDE al subir un sketch.
 * - No se graba con un proceso corriendo. Grabar reinicia la placa a media
 *   receta y deja el experimento a medias y los motores donde estuvieran.
 *
 * Si la grabacion se corta a la mitad, el bootloader sigue intacto: la placa se
 * queda sin sketch valido pero se puede volver a grabar desde aqui, no hace
 * falta que nadie viaje al laboratorio.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');

// Grabar un Mega tarda ~15 s. Dos minutos es margen de sobra para una placa
// lenta, y evita que un avrdude colgado deje el puerto tomado para siempre.
const TIEMPO_MAXIMO_MS = 120000;

let recursosCache;

/**
 * Busca lo que dejo el build. En desarrollo esta en firmware-build/ del repo;
 * en la aplicacion instalada, en resources/firmware.
 */
function recursos() {
    if (recursosCache !== undefined) return recursosCache;

    const candidatos = [
        path.join(__dirname, '..', '..', 'firmware-build'),
        path.join(__dirname, '..', '..', '..', 'firmware')
    ];

    for (const dir of candidatos) {
        const descriptor = path.join(dir, 'firmware.json');
        if (!fs.existsSync(descriptor)) continue;

        try {
            const info = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
            const hex = path.join(dir, info.hex);
            const avrdude = path.join(dir, 'avrdude', 'avrdude.exe');
            const conf = path.join(dir, 'avrdude', 'avrdude.conf');

            if (!fs.existsSync(hex) || !fs.existsSync(avrdude) || !fs.existsSync(conf)) {
                logger.warn(`Firmware incompleto en ${dir}, se ignora`);
                continue;
            }

            recursosCache = { dir, version: String(info.version), hex, avrdude, conf, fqbn: info.fqbn };
            logger.info(`Firmware empaquetado: version ${recursosCache.version} (${dir})`);
            return recursosCache;
        } catch (error) {
            logger.warn(`No se pudo leer ${descriptor}: ${error.message}`);
        }
    }

    // Sin firmware empaquetado la aplicacion funciona igual, solo que no ofrece
    // actualizar la placa. Pasa al correr desde el codigo sin compilar antes.
    logger.info('No hay firmware empaquetado; la actualizacion del Arduino queda deshabilitada');
    recursosCache = null;
    return recursosCache;
}

function hayFirmwareEmpaquetado() {
    return recursos() !== null;
}

function versionEmpaquetada() {
    return recursos()?.version ?? null;
}

/**
 * Decide si hay que grabar. Un firmware anterior a esta funcion no sabe
 * responder "FW?": ese silencio (versionEnPlaca === null) cuenta como version
 * vieja, que es justo el caso que hay que poder arreglar en remoto.
 */
function necesitaActualizar(versionEnPlaca) {
    const empaquetada = versionEmpaquetada();
    if (!empaquetada) return false;
    return String(versionEnPlaca ?? '') !== empaquetada;
}

/**
 * Corre avrdude contra el puerto. El puerto serial tiene que estar cerrado:
 * mientras la aplicacion lo tenga abierto, avrdude no puede reiniciar la placa.
 */
function grabar(puerto, alAvanzar = () => {}) {
    const recurso = recursos();
    if (!recurso) {
        return Promise.reject(new Error('Esta version no trae firmware empaquetado'));
    }
    if (!puerto) {
        return Promise.reject(new Error('No se sabe en que puerto esta el Arduino'));
    }

    const argumentos = [
        '-C', recurso.conf,
        '-c', 'wiring',
        '-p', 'atmega2560',
        '-P', puerto,
        '-b', '115200',
        '-D',                                   // no borrar la EEPROM: ver arriba
        '-U', `flash:w:${recurso.hex}:i`
    ];

    logger.info(`Grabando firmware ${recurso.version} en ${puerto}`);

    return new Promise((resolve, reject) => {
        const proceso = execFile(recurso.avrdude, argumentos, {
            timeout: TIEMPO_MAXIMO_MS,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024
        }, (error, stdout, stderr) => {
            const salida = `${stdout || ''}${stderr || ''}`.trim();

            if (error) {
                logger.error(`avrdude fallo: ${salida || error.message}`);
                reject(new Error(salida || error.message));
                return;
            }

            logger.info(`Firmware ${recurso.version} grabado en ${puerto}`);
            resolve({ version: recurso.version, salida });
        });

        // avrdude escribe el progreso en stderr, en lineas con "#". Se reenvia
        // para poder mostrar algo mientras tanto en vez de una pantalla muerta.
        proceso.stderr?.on('data', (trozo) => {
            String(trozo).split(/\r?\n/).forEach((linea) => {
                const texto = linea.trim();
                if (texto) alAvanzar(texto);
            });
        });
    });
}

module.exports = {
    hayFirmwareEmpaquetado,
    versionEmpaquetada,
    necesitaActualizar,
    grabar
};
