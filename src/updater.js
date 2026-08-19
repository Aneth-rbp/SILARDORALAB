/**
 * updater.js
 * Actualizaciones OTA del cliente Electron.
 *
 * El feed son los Releases de GitHub del propio repositorio (ver "publish" en
 * package.json). La app consulta el latest.yml publicado, compara contra la
 * versión de package.json y descarga en segundo plano. Con target NSIS la
 * descarga es diferencial: solo bajan los bloques que cambiaron respecto al
 * instalador ya instalado, así que un cambio de puro JS pesa unos pocos MB.
 */

const { app } = require('electron');
const { mostrarDialogo } = require('./dialogos');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const http = require('http');

// El equipo del laboratorio queda encendido días entre procesos, así que
// además del chequeo al arrancar se revisa periódicamente.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas
const FIRST_CHECK_DELAY_MS = 15 * 1000;       // dar tiempo a que levante el servidor
const BUSY_RETRY_MS = 10 * 60 * 1000;         // reintento si hay proceso SILAR corriendo

let deps = null;
let manualCheck = false;
let pendingUpdate = null;   // info de la versión ya descargada, esperando reinicio
let installing = false;
let busyRetryTimer = null;
let logFile = null;

/**
 * Log propio del updater.
 * No reutiliza src/utils/logger porque en instalación perMachine la carpeta de
 * la app vive en Program Files y no es escribible sin elevación.
 */
function log(level, message) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  console.log(`Updater: ${line}`);

  try {
    if (!logFile) {
      const dir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, 'updater.log');
    }
    fs.appendFileSync(logFile, line + '\n');
  } catch (error) {
    console.error('Updater: no se pudo escribir el log:', error.message);
  }
}

function describe(error) {
  if (!error) return 'error desconocido';
  return error.stack || error.message || String(error);
}

/**
 * Pregunta al servidor local si hay una receta en ejecución.
 * Reiniciar la app a media corrida abortaría el proceso químico, así que la
 * instalación se pospone mientras haya algo corriendo o en pausa.
 */
function isProcessRunning() {
  return new Promise((resolve) => {
    const request = http.get(`${deps.serverUrl}/api/system/busy`, { timeout: 3000 }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(Boolean(JSON.parse(body).busy));
        } catch (error) {
          // Si no se puede saber, se asume ocupado: nunca interrumpir a ciegas
          log('warn', `Respuesta inválida de /api/system/busy: ${describe(error)}`);
          resolve(true);
        }
      });
    });

    request.on('timeout', () => {
      request.destroy();
      log('warn', 'Timeout consultando /api/system/busy, se asume proceso activo');
      resolve(true);
    });

    request.on('error', (error) => {
      // Servidor caído: no hay proceso que proteger, se puede instalar
      log('warn', `No se pudo consultar /api/system/busy: ${error.message}`);
      resolve(false);
    });
  });
}

/**
 * Cierra el servidor de fondo y lanza el instalador.
 * El proceso hijo mantiene abierto el puerto serial y el binario nativo de
 * serialport; si sigue vivo, NSIS no puede reemplazar los archivos.
 */
async function applyUpdate() {
  if (installing) return;
  installing = true;

  log('info', `Instalando actualización ${pendingUpdate?.version || ''}...`);

  try {
    await deps.stopServer();
  } catch (error) {
    log('error', `Error cerrando el servidor antes de instalar: ${describe(error)}`);
  }

  // Margen para que el sistema libere los handles del proceso recién cerrado
  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true);
  }, 1500);
}

/**
 * Ofrece reiniciar para instalar. Si hay un proceso SILAR activo se reprograma.
 */
async function promptInstall() {
  if (installing || !pendingUpdate) return;

  if (busyRetryTimer) {
    clearTimeout(busyRetryTimer);
    busyRetryTimer = null;
  }

  if (await isProcessRunning()) {
    log('info', 'Proceso SILAR activo: se pospone la instalación');
    busyRetryTimer = setTimeout(promptInstall, BUSY_RETRY_MS);
    return;
  }

  const window = deps.getWindow();
  const result = await mostrarDialogo(window, {
    type: 'info',
    title: 'Actualización disponible',
    message: `SILAR System ${pendingUpdate.version} está listo para instalarse.`,
    detail: 'La aplicación se cerrará y volverá a abrirse. Windows pedirá permiso de administrador para completar la instalación.',
    buttons: ['Más tarde', 'Reiniciar e instalar'],
    defaultId: 1,
    cancelId: 0
  });

  if (result.response === 1) {
    applyUpdate();
  } else {
    log('info', 'Instalación pospuesta por el usuario (se aplicará al cerrar la app)');
  }
}

function setupEvents() {
  autoUpdater.on('checking-for-update', () => {
    log('info', 'Buscando actualizaciones...');
  });

  autoUpdater.on('update-available', (info) => {
    log('info', `Actualización encontrada: ${info.version} (instalada: ${app.getVersion()})`);
    if (manualCheck) {
      mostrarDialogo(deps.getWindow(), {
        type: 'info',
        title: 'Actualización disponible',
        message: `Se encontró la versión ${info.version}.`,
        detail: 'Se está descargando en segundo plano. Se avisará cuando esté lista para instalarse.',
        buttons: ['Entendido']
      });
      manualCheck = false;
    }
  });

  autoUpdater.on('update-not-available', () => {
    log('info', `No hay actualizaciones (versión instalada: ${app.getVersion()})`);
    if (manualCheck) {
      mostrarDialogo(deps.getWindow(), {
        type: 'info',
        title: 'Sin actualizaciones',
        message: `SILAR System ${app.getVersion()} ya está actualizado.`,
        buttons: ['Entendido']
      });
      manualCheck = false;
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    log('debug', `Descargando: ${Math.round(progress.percent)}% (${Math.round(progress.transferred / 1024)} KB de ${Math.round(progress.total / 1024)} KB)`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log('info', `Actualización ${info.version} descargada`);
    pendingUpdate = info;
    promptInstall();
  });

  autoUpdater.on('error', (error) => {
    // Un fallo de red no debe estorbar: la app sigue funcionando sin actualizar
    log('error', `Error en la actualización: ${describe(error)}`);
    if (manualCheck) {
      mostrarDialogo(deps.getWindow(), {
        type: 'error',
        title: 'Error buscando actualizaciones',
        message: 'No se pudo consultar el servidor de actualizaciones.',
        detail: error?.message || 'Revise la conexión a internet e intente de nuevo.',
        buttons: ['Entendido']
      });
      manualCheck = false;
    }
  });
}

/**
 * Dispara una revisión del feed.
 * @param {boolean} manual - true cuando lo pidió el usuario desde el menú
 *                           (muestra diálogos de confirmación y de error)
 */
function checkForUpdates(manual = false) {
  if (!deps) return;

  if (!app.isPackaged) {
    log('info', 'Modo desarrollo: actualizaciones deshabilitadas');
    if (manual) {
      mostrarDialogo(deps.getWindow(), {
        type: 'info',
        title: 'Actualizaciones',
        message: 'Las actualizaciones automáticas solo funcionan en la versión instalada.',
        buttons: ['Entendido']
      });
    }
    return;
  }

  manualCheck = manual;

  // Ya se descargó antes y el usuario la pospuso: volver a ofrecerla
  if (pendingUpdate) {
    manualCheck = false;
    promptInstall();
    return;
  }

  autoUpdater.checkForUpdates().catch((error) => {
    log('error', `Fallo al consultar el feed: ${describe(error)}`);
  });
}

/**
 * Inicializa el sistema de actualizaciones.
 * @param {Object} options
 * @param {string} options.serverUrl - URL del servidor local (para saber si hay proceso activo)
 * @param {Function} options.getWindow - devuelve la ventana principal
 * @param {Function} options.stopServer - cierra el proceso hijo del servidor (Promise)
 */
function initUpdater(options) {
  deps = options;

  autoUpdater.logger = {
    info: (message) => log('info', String(message)),
    warn: (message) => log('warn', String(message)),
    error: (message) => log('error', String(message)),
    debug: (message) => log('debug', String(message))
  };

  autoUpdater.autoDownload = true;
  // La instalación la controla promptInstall(), pero si el usuario simplemente
  // cierra la app la actualización se aplica en ese momento
  autoUpdater.autoInstallOnAppQuit = true;

  setupEvents();

  if (!app.isPackaged) {
    log('info', 'Modo desarrollo: no se programan revisiones automáticas');
    return;
  }

  setTimeout(() => checkForUpdates(false), FIRST_CHECK_DELAY_MS);
  setInterval(() => checkForUpdates(false), CHECK_INTERVAL_MS);
}

module.exports = { initUpdater, checkForUpdates };
