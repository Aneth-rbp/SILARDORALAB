/**
 * Confirmaciones dentro de la aplicación, sin diálogos de Windows.
 *
 * confirm() y alert() no son ventanas de la página: Electron las abre como
 * diálogos del sistema, y al cerrarse el contenido web se queda sin foco de
 * teclado. La pantalla se ve normal y responde al ratón, pero ya no se puede
 * escribir en ningún campo. En el equipo del laboratorio, en modo kiosko a
 * pantalla completa, eso obliga a reiniciar la aplicación. Se intentó devolver
 * el foco a mano (js/foco-dialogos.js y src/foco-ventana.js) y Windows no
 * siempre lo suelta, así que el camino bueno es no abrir esos diálogos.
 *
 * Aquí van dos reemplazos, con la misma pinta que el resto de los modales del
 * sistema:
 *
 *   await confirmar('¿Detener el proceso?')      -> true / false
 *   await avisar('La receta terminó.')           -> se resuelve al cerrarse
 *
 * La diferencia con confirm() es que estas devuelven una promesa: quien las
 * llame tiene que ser async y poner el await. A cambio, el foco nunca sale de
 * la página.
 *
 * Si por lo que sea no hay Bootstrap cargado, se cae al confirm() nativo: más
 * vale un diálogo feo que una confirmación que no aparece y deja al operador
 * sin saber si el proceso se detuvo.
 */
(function () {
    'use strict';

    const ID = 'modal-confirmacion';

    // Colores e icono por tipo de pregunta. 'peligro' es para lo que no tiene
    // vuelta atrás: detener un proceso, borrar un usuario, paro de emergencia.
    const ESTILOS = {
        normal: { boton: 'btn-primary', icono: 'bi-question-circle', color: 'text-primary' },
        aviso: { boton: 'btn-warning', icono: 'bi-exclamation-triangle', color: 'text-warning' },
        peligro: { boton: 'btn-danger', icono: 'bi-exclamation-triangle-fill', color: 'text-danger' }
    };

    let elemento = null;
    let modal = null;
    let resolver = null;

    /**
     * Los mensajes llevan datos de la base -nombres de usuario, de receta- así
     * que se escapan antes de meterlos en el DOM.
     */
    function escapar(texto) {
        const nodo = document.createElement('div');
        nodo.textContent = texto === null || texto === undefined ? '' : String(texto);
        return nodo.innerHTML;
    }

    function aHtml(mensaje) {
        return escapar(mensaje).replace(/\n/g, '<br>');
    }

    function construir() {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="${ID}" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="bi me-2" id="${ID}-icono"></i>
                                <span id="${ID}-titulo"></span>
                            </h5>
                        </div>
                        <div class="modal-body">
                            <p class="mb-0" id="${ID}-mensaje"></p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="${ID}-cancelar" data-bs-dismiss="modal"></button>
                            <button type="button" class="btn" id="${ID}-aceptar"></button>
                        </div>
                    </div>
                </div>
            </div>
        `);

        elemento = document.getElementById(ID);

        // focus: false igual que el resto de los modales del sistema: en la
        // pantalla táctil, que Bootstrap mueva el foco al modal levanta el
        // teclado en pantalla encima de los botones.
        modal = new bootstrap.Modal(elemento, { focus: false });

        // Cerrar por la X, por Escape o tocando fuera cuenta como cancelar, que
        // es siempre la respuesta segura: no se hace nada.
        elemento.addEventListener('hidden.bs.modal', () => responder(false));
        document.getElementById(`${ID}-aceptar`).addEventListener('click', () => {
            responder(true);
            modal.hide();
        });
    }

    function responder(valor) {
        if (!resolver) return;
        const pendiente = resolver;
        resolver = null;
        pendiente(valor);
    }

    function preguntar(mensaje, opciones) {
        const config = opciones || {};
        const estilo = ESTILOS[config.tipo] || ESTILOS.normal;
        const soloAviso = config.soloAviso === true;

        if (typeof bootstrap === 'undefined' || !bootstrap.Modal) {
            console.warn('confirmar: no hay Bootstrap, se usa el diálogo nativo');
            return Promise.resolve(soloAviso ? (window.alert(mensaje), true) : window.confirm(mensaje));
        }

        if (!elemento) construir();

        // Si ya había una pregunta abierta se da por cancelada: dos modales
        // encima no se pueden contestar y la promesa vieja se quedaría colgada.
        responder(false);

        document.getElementById(`${ID}-icono`).className = `bi me-2 ${estilo.icono} ${estilo.color}`;
        document.getElementById(`${ID}-titulo`).textContent = config.titulo || (soloAviso ? 'Aviso' : 'Confirmación');
        document.getElementById(`${ID}-mensaje`).innerHTML = aHtml(mensaje);

        const aceptar = document.getElementById(`${ID}-aceptar`);
        aceptar.className = `btn ${estilo.boton}`;
        aceptar.textContent = config.aceptar || (soloAviso ? 'Entendido' : 'Aceptar');

        const cancelar = document.getElementById(`${ID}-cancelar`);
        cancelar.textContent = config.cancelar || 'Cancelar';
        cancelar.classList.toggle('d-none', soloAviso);

        return new Promise((resolve) => {
            resolver = resolve;
            modal.show();
        });
    }

    /**
     * @returns {Promise<boolean>} true si el operador aceptó.
     */
    window.confirmar = function (mensaje, opciones) {
        return preguntar(mensaje, opciones);
    };

    /**
     * Aviso de un solo botón, el reemplazo de alert().
     * @returns {Promise<void>}
     */
    window.avisar = function (mensaje, opciones) {
        return preguntar(mensaje, Object.assign({}, opciones, { soloAviso: true })).then(() => undefined);
    };
})();
