/**
 * foco-ventana.js
 * Devuelve el foco del teclado al contenido web tras un diálogo nativo.
 *
 * Los diálogos de Windows -los de dialog.showMessageBox de aquí y los
 * confirm()/alert() de la página- se abren encima de la ventana y se llevan el
 * foco. Al cerrarse, la ventana vuelve al frente pero su contenido web se queda
 * sin foco de teclado: la pantalla se ve normal y responde al ratón, y aun así
 * no se puede escribir en ningún campo. En el equipo del laboratorio, que corre
 * en modo kiosko a pantalla completa, la única salida es reiniciar la app.
 *
 * mainWindow.on('focus') no sirve para esto: no se dispara con los diálogos
 * modales de la propia ventana, solo cuando el foco vuelve desde otra ventana
 * del sistema.
 */

const { dialog } = require('electron');

/**
 * Reintentos del reenfoque, en ms desde que se cierra el diálogo.
 *
 * El primero va en el acto y casi siempre basta. Windows a veces todavía está
 * cerrando el diálogo en ese momento y descarta el cambio de foco, así que se
 * repite en el siguiente tick y una vez más un poco después. Reenfocar de más
 * no molesta: si la ventana ya tiene el foco, no pasa nada.
 */
const REINTENTOS_MS = [0, 200];

/**
 * @param {import('electron').BrowserWindow} ventana
 */
function devolverFocoAlContenido(ventana) {
  if (!ventana || ventana.isDestroyed()) return false;

  const enfocar = () => {
    if (!ventana || ventana.isDestroyed()) return;

    // La ventana primero y el contenido después: al revés el contenido se
    // queda sin foco otra vez cuando la ventana lo recupera.
    if (!ventana.isFocused()) ventana.focus();
    ventana.webContents.focus();
  };

  enfocar();
  REINTENTOS_MS.forEach((ms) => setTimeout(enfocar, ms));
  return true;
}

/**
 * dialog.showMessageBox, pero recuperando el foco al cerrarse.
 *
 * Devuelve lo mismo que showMessageBox, así que se usa igual. Es el último
 * recurso: lo normal es llamar a mostrarDialogo() de src/dialogos.js, que
 * pregunta dentro de la propia aplicación y solo cae aquí cuando la página no
 * está en condiciones de contestar.
 *
 * @param {import('electron').BrowserWindow} ventana
 * @param {Electron.MessageBoxOptions} opciones
 */
function mostrarDialogoNativo(ventana, opciones) {
  return dialog.showMessageBox(ventana, opciones)
    .finally(() => devolverFocoAlContenido(ventana));
}

module.exports = { devolverFocoAlContenido, mostrarDialogoNativo };
