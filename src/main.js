/**
 * SILAR System - Aplicación Electron Principal
 * Maneja la ventana principal y la comunicación con el servidor web
 */

const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { initUpdater, checkForUpdates } = require('./updater');
const isDev = process.argv.includes('--dev');

// Habilitar soporte para teclado virtual en pantallas táctiles de Windows
app.commandLine.appendSwitch('enable-virtual-keyboard');

// Variable para el proceso del servidor
let serverProcess = null;

// Distingue un cierre intencional del servidor (salida o actualización) de una
// caída, para que el watchdog de 'close' no lo vuelva a levantar
let shuttingDownServer = false;

// Mantener una referencia global del objeto de ventana
let mainWindow;

// Cargar datos de la aplicación dinámicamente desde el package.json
const pkg = require('../package.json');
const systemConfig = require('../config/app.config');

const serverPort = systemConfig.app?.port || 3001;
const serverUrl = `http://localhost:${serverPort}`;

// Configuración de la aplicación
const appConfig = {
  name: pkg.build?.productName || pkg.name || 'SILAR System',
  version: pkg.version || '2.1.0',
  width: 1400,
  height: 900,
  minWidth: 1200,
  minHeight: 800,
  icon: path.join(__dirname, 'public', 'assets', 'dora-logo.png')
};

// En el laboratorio la app es lo unico que corre en ese equipo, asi que arranca
// en modo kiosko: pantalla completa, sin barra de titulo, sin barra de tareas y
// sin F11 para salirse. En desarrollo se queda en ventana para no pelear con el
// editor y las devtools.
//
// La salida es Ctrl+Shift+K (menu Ver > "Salir de modo kiosko"). Sin ese atajo
// el operador se queda encerrado si la app se cuelga, asi que no lo quites.
// Para forzarlo en cualquier sentido: SILAR_KIOSK=1 o SILAR_KIOSK=0.
const modoKiosko = process.env.SILAR_KIOSK !== undefined
  ? process.env.SILAR_KIOSK === '1'
  : !isDev;

function createWindow() {
  // Crear la ventana del navegador
  mainWindow = new BrowserWindow({
    width: appConfig.width,
    height: appConfig.height,
    minWidth: appConfig.minWidth,
    minHeight: appConfig.minHeight,
    icon: appConfig.icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false, // No mostrar hasta que esté listo
    kiosk: modoKiosko,
    titleBarStyle: 'default',
    autoHideMenuBar: !isDev
  });

  // Manejar el cierre de la ventana
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Manejar errores de carga
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Error cargando la aplicación:', errorDescription);

    if (errorCode === -6 || errorCode === -105) {
      // Error de conexión - servidor no disponible
      console.log('Servidor no disponible, esperando a que se inicie...');
      // Reintentar cargar después de un momento
      setTimeout(() => {
        loadApplication();
      }, 2000);
    }
  });

  // Iniciar servidor primero, luego cargar la aplicación (tanto en desarrollo como producción)
  startServerAndLoad();
}

function startServerAndLoad() {
  // Iniciar el servidor primero
  startServer();

  // Esperar a que el servidor esté disponible antes de cargar
  waitForServer(() => {
    loadApplication();
  });
}

function waitForServer(callback, attempts = 0) {
  const maxAttempts = 30; // 30 intentos = 15 segundos máximo

  if (attempts >= maxAttempts) {
    console.error('Timeout esperando al servidor. Forzando apertura de la ventana de la aplicación.');
    callback();
    return;
  }

  const { net } = require('electron');
  const request = net.request(`${serverUrl}/api/system/status`);

  request.on('response', () => {
    console.log('Servidor disponible, cargando aplicación...');
    callback();
  });

  request.on('error', () => {
    // Servidor aún no está listo, esperar y reintentar
    setTimeout(() => {
      waitForServer(callback, attempts + 1);
    }, 500);
  });

  request.end();
}

function loadApplication() {
  if (!mainWindow) return;

  // Cargar siempre desde el servidor local de Node.js
  // Esto asegura que las llamadas API relativas (/api) y WebSockets conecten de forma nativa
  mainWindow.loadURL(serverUrl);

  if (isDev) {
    // Abrir las herramientas de desarrollador en modo desarrollo
    mainWindow.webContents.openDevTools();
  }

  // Mostrar la ventana cuando esté lista
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

function checkServerStatus() {
  const { net } = require('electron');

  const request = net.request(`${serverUrl}/api/system/status`);
  request.on('response', (response) => {
    console.log('Servidor web disponible');
  });

  request.on('error', (error) => {
    console.error('Servidor web no disponible:', error);
    showServerError();
  });

  request.end();
}

let errorDialogShowing = false;
let serverErrorOutput = '';

function showServerError() {
  if (errorDialogShowing) return;
  errorDialogShowing = true;

  dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Servidor No Disponible',
    message: 'El servidor de fondo de SILAR System no pudo iniciarse correctamente.',
    detail: serverErrorOutput 
      ? `Detalles del error del servidor:\n\n${serverErrorOutput}` 
      : '¿Desea intentar iniciar el servidor de fondo de nuevo automáticamente? Asegúrese de que no haya otra instancia corriendo.',
    buttons: ['Cancelar', 'Iniciar Servidor'],
    defaultId: 1
  }).then((result) => {
    errorDialogShowing = false;
    if (result.response === 1) {
      startServer();
    }
  });
}

function startServer() {
  // En producción, usar la ruta correcta del ejecutable
  const isDev = process.argv.includes('--dev');

  // Determinar la ruta del servidor según el entorno
  let serverPath, serverCwd;

  if (isDev) {
    // Modo desarrollo: usar rutas relativas
    serverPath = path.join(__dirname, '..', 'server.js');
    serverCwd = path.join(__dirname, '..');
  } else {
    // Modo producción: usar rutas desde resourcesPath
    // En Electron empaquetado, los archivos están en resources/app o resources/app.asar
    const appPath = app.getAppPath();
    serverPath = path.join(appPath, 'server.js');
    serverCwd = appPath;
  }

  shuttingDownServer = false;

  console.log(`Iniciando servidor desde: ${serverPath}`);
  console.log(`Directorio de trabajo: ${serverCwd}`);

  // Iniciar el servidor web como proceso hijo usando el propio ejecutable de Electron
  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: serverCwd,
    stdio: 'pipe',
    detached: false,
    env: {
      ...process.env,
      NODE_ENV: isDev ? 'development' : 'production',
      ELECTRON_RUN_AS_NODE: '1',
      USER_DATA_PATH: app.getPath('userData')
    }
  });

  // Reiniciar acumulador de errores
  serverErrorOutput = '';

  serverProcess.stdout.on('data', (data) => {
    console.log('Servidor:', data.toString());
  });

  serverProcess.stderr.on('data', (data) => {
    const chunk = data.toString();
    console.error('Error del servidor:', chunk);
    serverErrorOutput += chunk;
  });

  serverProcess.on('error', (err) => {
    console.error('Error al spawnear el proceso del servidor:', err);
    serverErrorOutput += `Error del sistema: ${err.message}\n`;
  });

  serverProcess.on('close', (code) => {
    console.log('Servidor cerrado con código:', code);
    // Intentar reiniciar si se cierra inesperadamente (solo en producción, máx 3 reintentos)
    if (code !== 0 && !isDev && !shuttingDownServer) {
      if (typeof global.serverStartAttempts === 'undefined') {
        global.serverStartAttempts = 0;
      }
      if (global.serverStartAttempts < 3) {
        global.serverStartAttempts++;
        console.log(`Reintentando iniciar servidor (Intento ${global.serverStartAttempts}/3) en 3 segundos...`);
        setTimeout(() => {
          startServer();
        }, 3000);
      } else {
        console.error('Se excedió el número máximo de reintentos para iniciar el servidor de fondo.');
      }
    }
  });
}

/**
 * Cierra el proceso hijo del servidor y espera a que termine.
 * Necesario antes de instalar una actualización: mientras siga vivo mantiene
 * tomados el puerto serial y el binario nativo de serialport, y el instalador
 * NSIS no puede reemplazar esos archivos.
 */
function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    shuttingDownServer = true;

    const child = serverProcess;
    serverProcess = null;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    child.once('close', finish);
    child.kill();

    // Si no cerró por las buenas, forzarlo para no bloquear la instalación
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (error) {
        console.error('No se pudo forzar el cierre del servidor:', error.message);
      }
      finish();
    }, 5000);
  });
}

function createMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Nueva Ventana',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            createWindow();
          }
        },
        {
          label: 'Cerrar',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            mainWindow.close();
          }
        },
        { type: 'separator' },
        {
          label: 'Salir',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          // Unica forma de llegar al escritorio con la app en kiosko. El menu
          // esta oculto (autoHideMenuBar), pero el acelerador funciona igual.
          label: 'Salir de modo kiosko',
          accelerator: 'Ctrl+Shift+K',
          click: () => {
            if (mainWindow) {
              mainWindow.setKiosk(!mainWindow.isKiosk());
            }
          }
        }
      ]
    },
    {
      label: 'Sistema',
      submenu: [
        {
          label: 'Iniciar Servidor',
          click: () => {
            startServer();
          }
        },
        {
          label: 'Configurar Base de Datos',
          click: () => {
            const { spawn } = require('child_process');
            spawn('setup-database.bat', [], {
              cwd: path.join(__dirname, '..'),
              stdio: 'inherit'
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Buscar Actualizaciones',
          click: () => {
            checkForUpdates(true);
          }
        },
        {
          label: 'Acerca de SILAR System',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Acerca de SILAR System',
              message: `${appConfig.name} v${appConfig.version}`,
              detail: 'Sistema de control para procesos químicos SILAR\nDesarrollado por DORA Lab'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Eventos de la aplicación
app.whenReady().then(() => {
  createWindow();
  createMenu();

  initUpdater({
    serverUrl,
    getWindow: () => mainWindow,
    stopServer
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cerrar el servidor cuando se cierre la aplicación
app.on('before-quit', () => {
  if (serverProcess) {
    shuttingDownServer = true;
    serverProcess.kill();
  }
});

// Manejar eventos IPC
ipcMain.handle('get-app-info', () => {
  return {
    name: appConfig.name,
    version: appConfig.version,
    isDev: isDev
  };
});

ipcMain.handle('check-server', async () => {
  return new Promise((resolve) => {
    const { net } = require('electron');
    const request = net.request(`${serverUrl}/api/system/status`);

    request.on('response', () => {
      resolve({ available: true });
    });

    request.on('error', () => {
      resolve({ available: false });
    });

    request.end();
  });
});

// Prevenir múltiples instancias
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
