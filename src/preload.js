/**
 * Preload script para SILAR System Electron
 * Proporciona APIs seguras para la comunicación entre procesos
 */

const { contextBridge, ipcRenderer } = require('electron');

// Exponer APIs seguras al proceso de renderizado
contextBridge.exposeInMainWorld('electronAPI', {
  // Información de la aplicación
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  
  // Verificar estado del servidor
  checkServer: () => ipcRenderer.invoke('check-server'),
  
  // Notificaciones del sistema
  showNotification: (title, body) => {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification(title, { body });
          }
        });
      }
    }
  },
  
  // Información del sistema
  getSystemInfo: () => ({
    platform: process.platform,
    arch: process.arch,
    version: process.version,
    electronVersion: process.versions.electron
  })
});

// Interceptar errores de red para mejor manejo
window.addEventListener('error', (event) => {
  if (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK') {
    // Error silencioso de carga de recursos
  }
});

// Detectar cuando la aplicación está lista
window.addEventListener('DOMContentLoaded', () => {
  // Aplicación cargada
});
