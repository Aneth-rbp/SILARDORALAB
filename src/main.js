/**
 * SILAR System - Aplicación Electron Principal
 * Maneja la ventana principal y la comunicación con el servidor web
 */

const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const isDev = process.argv.includes('--dev');

// Variable para el proceso del servidor
let serverProcess = null;

// Mantener una referencia global del objeto de ventana
let mainWindow;

// Configuración de la aplicación
const appConfig = {
  name: 'SILAR System',
  version: '2.0.0',
  width: 1400,
  height: 900,
  minWidth: 1200,
  minHeight: 800,
  icon: path.join(__dirname, 'public', 'assets', 'dora-logo.png')
};

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

  // Iniciar servidor primero, luego cargar la aplicación
  if (isDev) {
    startServerAndLoad();
  } else {
    // En producción, cargar desde archivos locales
    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      startServer();
    });
  }
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
    console.error('Timeout esperando al servidor');
    showServerError();
    return;
  }

  const { net } = require('electron');
  const request = net.request('http://localhost:3000/api/system/status');
  
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
  
  if (isDev) {
    // En desarrollo, cargar desde el servidor web
    mainWindow.loadURL('http://localhost:3000');
    
    // Abrir las herramientas de desarrollador
    mainWindow.webContents.openDevTools();
  } else {
    // En producción, cargar desde archivos locales
    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
  }

  // Mostrar la ventana cuando esté lista
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

function checkServerStatus() {
  const { net } = require('electron');
  
  const request = net.request('http://localhost:3000/api/system/status');
  request.on('response', (response) => {
    console.log('Servidor web disponible');
  });
  
  request.on('error', (error) => {
    console.error('Servidor web no disponible:', error);
    showServerError();
  });
  
  request.end();
}

function showServerError() {
  dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Servidor No Disponible',
    message: 'El servidor web de SILAR System no está ejecutándose.',
    detail: '¿Desea iniciar el servidor automáticamente?',
    buttons: ['Cancelar', 'Iniciar Servidor'],
    defaultId: 1
  }).then((result) => {
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
  
  console.log(`Iniciando servidor desde: ${serverPath}`);
  console.log(`Directorio de trabajo: ${serverCwd}`);
  
  // Iniciar el servidor web como proceso hijo
  serverProcess = spawn('node', [serverPath], {
    cwd: serverCwd,
    stdio: 'pipe',
    detached: false,
    env: {
      ...process.env,
      NODE_ENV: isDev ? 'development' : 'production',
      ELECTRON_RUN_AS_NODE: '1'
    }
  });

  serverProcess.stdout.on('data', (data) => {
    console.log('Servidor:', data.toString());
  });

  serverProcess.stderr.on('data', (data) => {
    console.error('Error del servidor:', data.toString());
  });

  serverProcess.on('close', (code) => {
    console.log('Servidor cerrado con código:', code);
    // Intentar reiniciar si se cierra inesperadamente (solo en producción)
    if (code !== 0 && !isDev) {
      console.log('Reintentando iniciar servidor en 3 segundos...');
      setTimeout(() => {
        startServer();
      }, 3000);
    }
  });

  // Esperar un momento para que el servidor se inicie
  setTimeout(() => {
    checkServerStatus();
  }, 3000);
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
        { role: 'togglefullscreen' }
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
    const request = net.request('http://localhost:3000/api/system/status');
    
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
