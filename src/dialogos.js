/**
 * dialogos.js
 * Diálogos del proceso principal, preguntados dentro de la propia aplicación.
 *
 * dialog.showMessageBox abre una ventana de Windows encima de la aplicación, y
 * al cerrarse el contenido web se queda sin foco de teclado: la pantalla se ve
 * normal, responde al ratón, y ningún campo acepta lo que se escribe. En el
 * equipo del laboratorio, en kiosko a pantalla completa, eso obliga a reiniciar
 * la aplicación. Devolverle el foco a mano (src/foco-ventana.js) ayuda pero
 * Windows no siempre lo suelta.
 *
 * Así que estos diálogos se preguntan en la página, con los mismos modales que
 * usa el resto del sistema (js/confirmar.js). Nunca se abre una ventana del
 * sistema y el foco no sale de la aplicación.
 *
 * El diálogo nativo se queda como respaldo para cuando la página no puede
 * contestar: mientras arranca, si se está recargando o si el servidor no
 * levantó -que es justo cuando avisa showServerError()-. Sin ese respaldo, un
 * aviso que sale antes de que cargue la interfaz no lo vería nadie.
 */

const { ipcMain } = require('electron');
const { mostrarDialogoNativo, devolverFocoAlContenido } = require('./foco-ventana');

// Cuánto se espera a que la página acuse recibo. No es el tiempo que tiene el
// operador para contestar -eso no se limita-, solo el que tarda el renderer en
// decir "lo tengo". Si no llega, se da por dormida y se usa el diálogo nativo.
const ESPERA_ACUSE_MS = 2000;

let siguienteId = 1;
const pendientes = new Map();

ipcMain.on('dialogo-app-recibido', (evento, id) => {
  const pendiente = pendientes.get(id);
  if (pendiente) pendiente.acusar();
});

ipcMain.on('dialogo-app-respuesta', (evento, id, indice) => {
  const pendiente = pendientes.get(id);
  if (!pendiente) return;
  pendientes.delete(id);
  pendiente.responder(indice);
});

function paginaDisponible(ventana) {
  if (!ventana || ventana.isDestroyed()) return false;

  const contenido = ventana.webContents;
  if (contenido.isDestroyed() || contenido.isLoading() || contenido.isCrashed()) return false;

  // Con la interfaz cargada la URL es la del servidor local. Si todavía está en
  // about:blank o en la página de error de Chromium no hay nadie que conteste.
  return contenido.getURL().startsWith('http');
}

function preguntarEnLaPagina(ventana, opciones) {
  return new Promise((resolve, reject) => {
    const id = siguienteId++;
    let acusado = false;

    const temporizador = setTimeout(() => {
      if (acusado) return;
      pendientes.delete(id);
      reject(new Error('la página no acusó recibo del diálogo'));
    }, ESPERA_ACUSE_MS);

    // Si la ventana se recarga o se cierra con la pregunta abierta, nadie va a
    // contestar nunca: se rechaza para que el diálogo salga por el camino
    // nativo en vez de quedarse colgado.
    const alPerderLaPagina = () => {
      if (!pendientes.has(id)) return;
      pendientes.delete(id);
      clearTimeout(temporizador);
      reject(new Error('la página desapareció antes de contestar'));
    };
    ventana.webContents.once('did-start-loading', alPerderLaPagina);
    ventana.once('closed', alPerderLaPagina);

    const limpiar = () => {
      clearTimeout(temporizador);
      ventana.webContents.removeListener('did-start-loading', alPerderLaPagina);
      if (!ventana.isDestroyed()) ventana.removeListener('closed', alPerderLaPagina);
    };

    pendientes.set(id, {
      acusar: () => {
        acusado = true;
        clearTimeout(temporizador);
      },
      responder: (indice) => {
        limpiar();
        resolve({ response: indice });
      }
    });

    ventana.webContents.send('dialogo-app', {
      id,
      tipo: opciones.type,
      titulo: opciones.title,
      mensaje: opciones.message,
      detalle: opciones.detail,
      botones: opciones.buttons || ['Entendido'],
      indiceAceptar: opciones.defaultId,
      indiceCancelar: opciones.cancelId
    });
  });
}

/**
 * Pregunta lo mismo que dialog.showMessageBox y devuelve lo mismo
 * ({ response: <índice del botón> }), pero sin abrir una ventana de Windows
 * mientras la página pueda contestar.
 *
 * @param {import('electron').BrowserWindow} ventana
 * @param {Electron.MessageBoxOptions} opciones
 * @returns {Promise<{response: number}>}
 */
async function mostrarDialogo(ventana, opciones) {
  if (paginaDisponible(ventana)) {
    try {
      return await preguntarEnLaPagina(ventana, opciones);
    } catch (error) {
      console.warn('Diálogo en la aplicación no disponible, se usa el nativo:', error.message);
    }
  }

  return mostrarDialogoNativo(ventana, opciones);
}

module.exports = { mostrarDialogo, devolverFocoAlContenido };
