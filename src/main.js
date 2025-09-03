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

  // Cargar la aplicación
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
    
    // Iniciar automáticamente el servidor en modo desarrollo
    if (isDev) {
      startServer();
    } else {
      // En producción, solo verificar si está ejecutándose
      checkServerStatus();
    }
  });

  // Manejar el cierre de la ventana
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Manejar errores de carga
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Error cargando la aplicación:', errorDescription);
    
    if (errorCode === -6) {
      // Error de conexión - servidor no disponible
      showServerError();
    }
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

function startServer() {
  console.log('Iniciando servidor web...');
  
  // Iniciar el servidor web como proceso hijo
  serverProcess = spawn('node', ['server.js'], {
    stdio: 'pipe',
    detached: false
  });

  serverProcess.stdout.on('data', (data) => {
    console.log('Servidor:', data.toString());
  });

  serverProcess.stderr.on('data', (data) => {
    console.error('Error del servidor:', data.toString());
  });

  serverProcess.on('close', (code) => {
    console.log('Servidor cerrado con código:', code);
  });

  // Esperar un momento para que el servidor se inicie
  setTimeout(() => {
    checkServerStatus();
  }, 3000);
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
  const { spawn } = require('child_process');
  
  const serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe'
  });
  
  serverProcess.stdout.on('data', (data) => {
    console.log('Servidor:', data.toString());
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error('Error del servidor:', data.toString());
  });
  
  serverProcess.on('close', (code) => {
    console.log('Servidor cerrado con código:', code);
  });
  
  // Esperar un momento y recargar la ventana
  setTimeout(() => {
    mainWindow.reload();
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
    console.log('Cerrando servidor web...');
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
