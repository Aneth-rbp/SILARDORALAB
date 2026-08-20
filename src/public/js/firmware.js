/**
 * Actualiza el firmware del Arduino al abrir el sistema.
 *
 * El instalador trae el .hex compilado (scripts/compilar-firmware.js) y la placa
 * dice qué versión tiene cuando se le pregunta "FW?". Si no coinciden, aquí se
 * le avisa al operador y, si acepta, el servidor graba la placa con avrdude
 * (src/firmware/actualizador.js). Así un cambio en el .ino llega al laboratorio
 * por la misma actualización automática que ya baja sola la aplicación, sin que
 * nadie tenga que abrir el Arduino IDE allí.
 *
 * Se pregunta en vez de grabar sin más porque grabar reinicia la placa: si
 * alguien está a punto de correr una receta, es su decisión cuándo hacerlo.
 * Decir que no sólo aplaza: la próxima vez que abra el sistema vuelve a salir.
 *
 * Si la grabación falla a la mitad, el bootloader sigue intacto y se puede
 * reintentar desde el mismo aviso; la placa no queda inservible.
 */
(function () {
    'use strict';

    const ID = 'modal-firmware';

    // Cuántas líneas de avrdude se ven a la vez. Suficiente para notar que
    // avanza sin convertir el modal en una consola.
    const LINEAS_VISIBLES = 6;

    let elemento = null;
    let modal = null;
    let yaRevisado = false;
    let historial = [];

    function construir() {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="${ID}" tabindex="-1" aria-hidden="true"
                 data-bs-backdrop="static" data-bs-keyboard="false">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="bi bi-cpu me-2 text-primary"></i>
                                Actualizando el Arduino
                            </h5>
                        </div>
                        <div class="modal-body">
                            <p class="mb-3" id="${ID}-mensaje"></p>
                            <div class="progress mb-3" style="height: 6px;">
                                <div class="progress-bar progress-bar-striped progress-bar-animated w-100"></div>
                            </div>
                            <pre class="small text-muted mb-0" id="${ID}-salida"
                                 style="white-space: pre-wrap; min-height: 5rem;"></pre>
                        </div>
                    </div>
                </div>
            </div>
        `);

        elemento = document.getElementById(ID);
        // focus: false, igual que el resto de los modales: en la pantalla táctil
        // mover el foco levanta el teclado en pantalla encima del contenido.
        modal = new bootstrap.Modal(elemento, { focus: false });
    }

    function abrirProgreso(mensaje) {
        if (!elemento) construir();
        historial = [];
        document.getElementById(`${ID}-mensaje`).textContent = mensaje;
        document.getElementById(`${ID}-salida`).textContent = '';
        modal.show();
    }

    function apuntar(linea) {
        if (!elemento) return;
        historial.push(linea);
        if (historial.length > LINEAS_VISIBLES) historial.shift();
        document.getElementById(`${ID}-salida`).textContent = historial.join('\n');
    }

    function cerrarProgreso() {
        modal?.hide();
    }

    /**
     * Graba la placa y devuelve el resultado ya interpretado. No lanza: quien
     * llama decide si ofrecer reintentar.
     */
    async function grabar(app) {
        abrirProgreso('No apague el equipo ni desconecte el Arduino. Tarda menos de un minuto.');

        const escucha = (datos) => apuntar(datos?.linea || '');
        app.socket?.on('firmware-progreso', escucha);

        try {
            const respuesta = await app.apiCall('/arduino/flash', { method: 'POST' });
            return { ok: true, respuesta };
        } catch (error) {
            return { ok: false, mensaje: error.message };
        } finally {
            app.socket?.off('firmware-progreso', escucha);
            cerrarProgreso();
        }
    }

    function anunciarExito(respuesta) {
        return avisar(`El Arduino quedó con la versión ${respuesta.versionPlaca}.`,
            { titulo: 'Firmware actualizado' });
    }

    function motivoDelFallo(resultado) {
        return resultado.ok ? 'La placa no confirmó la versión nueva.' : resultado.mensaje;
    }

    async function ofrecer(app, info) {
        const detalle = info.versionPlaca
            ? `La placa tiene la versión ${info.versionPlaca} y esta actualización trae la ${info.versionEmpaquetada}.`
            : `Esta actualización trae la versión ${info.versionEmpaquetada} del firmware y la placa tiene una anterior.`;

        const aceptado = await confirmar(
            `${detalle}\n\nActualizar tarda menos de un minuto y reinicia el Arduino. ` +
            'Las calibraciones guardadas no se pierden.\n\n¿Actualizar ahora?',
            { titulo: 'Firmware del Arduino', aceptar: 'Actualizar', cancelar: 'Ahora no', tipo: 'aviso' }
        );

        if (!aceptado) return;

        const resultado = await grabar(app);

        if (resultado.ok && resultado.respuesta?.verificado) {
            await anunciarExito(resultado.respuesta);
            return;
        }

        // Sin verificar: o avrdude falló, o grabó pero la placa no contestó. En
        // los dos casos el bootloader sigue vivo, así que reintentar es seguro.
        const reintentar = await confirmar(
            `No se pudo completar la actualización.\n\n${motivoDelFallo(resultado)}\n\n¿Reintentar?`,
            { titulo: 'Firmware del Arduino', aceptar: 'Reintentar', cancelar: 'Cerrar', tipo: 'peligro' }
        );

        if (reintentar) await reintentarUnaVez(app);
    }

    async function reintentarUnaVez(app) {
        const resultado = await grabar(app);

        if (resultado.ok && resultado.respuesta?.verificado) {
            await anunciarExito(resultado.respuesta);
            return;
        }

        // Se reintenta una sola vez: si vuelve a fallar es algo que no se
        // arregla insistiendo -cable, puerto ocupado, placa distinta-.
        await avisar(
            `La actualización volvió a fallar.\n\n${motivoDelFallo(resultado)}\n\n` +
            'El sistema sigue funcionando con el firmware que tenga la placa.',
            { titulo: 'Firmware del Arduino', tipo: 'peligro' }
        );
    }

    /**
     * Se llama al terminar de arrancar la aplicación. Si el Arduino todavía no
     * se conectó, espera al aviso del servidor en vez de dar por hecho que no
     * hay placa.
     */
    async function revisar(app) {
        if (!app || app.isDemoMode || yaRevisado) return;

        let info;
        try {
            info = await app.apiCall('/arduino/flash/info');
        } catch (error) {
            // Que no se pueda consultar no es motivo para molestar al operador:
            // el sistema funciona igual con el firmware que ya tenga la placa.
            console.warn('No se pudo consultar el firmware:', error.message);
            return;
        }

        if (!info?.disponible) return;

        if (!info.conectado) {
            app.socket?.once('arduino-connected', () => {
                // Un respiro: la placa acaba de reiniciar y tarda en contestar.
                setTimeout(() => revisar(app), 3000);
            });
            return;
        }

        yaRevisado = true;
        if (info.necesitaActualizar) await ofrecer(app, info);
    }

    window.revisarFirmwareDelArduino = revisar;
})();
