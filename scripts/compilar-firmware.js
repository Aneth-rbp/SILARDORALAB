/**
 * Compila el sketch del Arduino y deja en firmware-build/ todo lo que la
 * aplicacion necesita para grabar la placa ella sola:
 *
 *   firmware-build/SILAR_Control.ino.hex   el firmware compilado
 *   firmware-build/firmware.json           la version que declara el sketch
 *   firmware-build/avrdude/                el grabador y su configuracion
 *
 * Esa carpeta se empaqueta dentro del instalador (extraResources en
 * package.json), asi que el firmware viaja en la misma actualizacion que ya
 * baja sola la maquina del laboratorio. Lo corre GitHub Actions antes de
 * electron-builder; ver .github/workflows/release.yml.
 *
 * Sin este paso el instalador sale sin firmware: la aplicacion lo detecta y
 * simplemente no ofrece actualizar la placa.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, 'firmware-build');
const HERRAMIENTAS = path.join(SALIDA, '.herramientas');
const SKETCH_ORIGEN = path.join(RAIZ, 'src', 'arduino', 'arduino-sketch', 'SILAR_Control.ino');
const FQBN = 'arduino:avr:mega';

// Version fija a proposito: "latest" resuelve hoy a una release candidate, y de
// esto depende el firmware de una maquina que nadie puede reflashear a mano.
const CLI_VERSION = '1.1.1';
const CLI_URL = `https://downloads.arduino.cc/arduino-cli/arduino-cli_${CLI_VERSION}_Windows_64bit.zip`;

// Las que incluye el sketch. Si se agrega otra libreria, va aqui.
const LIBRERIAS = ['AccelStepper', 'ezButton'];

function log(mensaje) {
    console.log(`[firmware] ${mensaje}`);
}

/**
 * Las herramientas se instalan dentro de firmware-build para no ensuciar el
 * Arduino15 de quien compile ni depender de lo que ya tenga instalado.
 */
function entorno() {
    return {
        ...process.env,
        ARDUINO_DIRECTORIES_DATA: path.join(HERRAMIENTAS, 'data'),
        ARDUINO_DIRECTORIES_DOWNLOADS: path.join(HERRAMIENTAS, 'descargas'),
        ARDUINO_DIRECTORIES_USER: path.join(HERRAMIENTAS, 'usuario')
    };
}

function correr(ejecutable, argumentos) {
    return execFileSync(ejecutable, argumentos, {
        env: entorno(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: 32 * 1024 * 1024
    });
}

function descargar(url, destino) {
    return new Promise((resolve, reject) => {
        const archivo = fs.createWriteStream(destino);
        https.get(url, (respuesta) => {
            if (respuesta.statusCode >= 300 && respuesta.statusCode < 400 && respuesta.headers.location) {
                archivo.close();
                descargar(respuesta.headers.location, destino).then(resolve, reject);
                return;
            }
            if (respuesta.statusCode !== 200) {
                archivo.close();
                reject(new Error(`${url} respondio ${respuesta.statusCode}`));
                return;
            }
            respuesta.pipe(archivo);
            archivo.on('finish', () => archivo.close(resolve));
        }).on('error', reject);
    });
}

async function conseguirArduinoCli() {
    const destino = path.join(HERRAMIENTAS, 'arduino-cli.exe');
    if (fs.existsSync(destino)) {
        log('arduino-cli ya estaba descargado');
        return destino;
    }

    fs.mkdirSync(HERRAMIENTAS, { recursive: true });
    const zip = path.join(HERRAMIENTAS, 'arduino-cli.zip');
    log(`descargando arduino-cli ${CLI_VERSION}`);
    await descargar(CLI_URL, zip);

    // Expand-Archive en vez de una libreria de zip: esto solo corre en Windows,
    // que es donde se compila el instalador.
    execFileSync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${HERRAMIENTAS}' -Force`
    ], { stdio: 'inherit' });
    fs.unlinkSync(zip);

    if (!fs.existsSync(destino)) {
        throw new Error('el zip de arduino-cli no traia arduino-cli.exe');
    }
    return destino;
}

/**
 * arduino-cli exige que la carpeta se llame igual que el .ino, y en
 * arduino-sketch/ conviven dos sketches. Se copia a una carpeta propia.
 */
function prepararSketch() {
    const carpeta = path.join(SALIDA, 'SILAR_Control');
    fs.mkdirSync(carpeta, { recursive: true });
    fs.copyFileSync(SKETCH_ORIGEN, path.join(carpeta, 'SILAR_Control.ino'));
    return carpeta;
}

function versionDelSketch() {
    const fuente = fs.readFileSync(SKETCH_ORIGEN, 'utf8');
    const encontrado = fuente.match(/#define\s+FIRMWARE_VERSION\s+"([^"]+)"/);
    if (!encontrado) {
        throw new Error('el sketch no declara FIRMWARE_VERSION');
    }
    return encontrado[1];
}

/**
 * avrdude viene dentro del core AVR que se acaba de instalar. La version de la
 * carpeta cambia con cada core, asi que se busca en vez de escribirla a mano.
 */
function copiarAvrdude() {
    const base = path.join(HERRAMIENTAS, 'data', 'packages', 'arduino', 'tools', 'avrdude');
    const versiones = fs.readdirSync(base);
    if (versiones.length === 0) {
        throw new Error(`no se encontro avrdude en ${base}`);
    }
    const origen = path.join(base, versiones[versiones.length - 1]);
    const destino = path.join(SALIDA, 'avrdude');

    fs.mkdirSync(destino, { recursive: true });
    fs.copyFileSync(path.join(origen, 'bin', 'avrdude.exe'), path.join(destino, 'avrdude.exe'));
    fs.copyFileSync(path.join(origen, 'etc', 'avrdude.conf'), path.join(destino, 'avrdude.conf'));
    log(`avrdude ${versiones[versiones.length - 1]} copiado`);
}

async function main() {
    fs.mkdirSync(SALIDA, { recursive: true });

    const cli = await conseguirArduinoCli();

    log('instalando el core AVR');
    correr(cli, ['core', 'update-index']);
    correr(cli, ['core', 'install', 'arduino:avr']);

    log(`instalando librerias: ${LIBRERIAS.join(', ')}`);
    correr(cli, ['lib', 'update-index']);
    correr(cli, ['lib', 'install', ...LIBRERIAS]);

    const carpetaSketch = prepararSketch();
    log(`compilando para ${FQBN}`);
    correr(cli, ['compile', '--fqbn', FQBN, '--output-dir', SALIDA, carpetaSketch]);

    const hex = path.join(SALIDA, 'SILAR_Control.ino.hex');
    if (!fs.existsSync(hex)) {
        throw new Error('la compilacion no dejo el .hex');
    }

    copiarAvrdude();

    const version = versionDelSketch();
    fs.writeFileSync(path.join(SALIDA, 'firmware.json'), JSON.stringify({
        version,
        fqbn: FQBN,
        hex: 'SILAR_Control.ino.hex',
        bytes: fs.statSync(hex).size
    }, null, 2) + '\n', 'utf8');

    log(`listo: firmware ${version}, ${fs.statSync(hex).size} bytes`);
}

main().catch((error) => {
    console.error(`[firmware] fallo: ${error.message}`);
    process.exit(1);
});
