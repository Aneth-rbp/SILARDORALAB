/**
 * Muestra en la página los diálogos que pide el proceso principal.
 *
 * Los avisos del updater ("Actualización disponible", "Sin actualizaciones",
 * errores de descarga) y los de main.js salían como ventanas de Windows, y al
 * cerrarlas la página se quedaba sin foco de teclado. Ahora el proceso
 * principal los manda por aquí y se preguntan con los mismos modales que el
 * resto del sistema (js/confirmar.js).
 *
 * El trato con src/dialogos.js es: se acusa recibo en cuanto llega -si no, allá
 * se da la página por dormida y saca el diálogo nativo- y se responde con el
 * índice del botón elegido, que es lo que espera showMessageBox.
 *
 * Fuera de Electron no hay electronAPI y esto no hace nada, que es lo correcto:
 * en el navegador no existe el updater.
 */
(function () {
    'use strict';

    const api = window.electronAPI;
    if (!api || typeof api.alPedirDialogo !== 'function') return;

    // Los tipos de showMessageBox no coinciden con los nuestros.
    const TIPOS = {
        error: 'peligro',
        warning: 'aviso',
        question: 'normal',
        info: 'normal',
        none: 'normal'
    };

    function aceptarPorDefecto(datos) {
        if (Number.isInteger(datos.indiceAceptar)) return datos.indiceAceptar;
        // Sin defaultId, showMessageBox trata el último botón como el principal.
        return datos.botones.length - 1;
    }

    function cancelarPorDefecto(datos, indiceAceptar) {
        if (Number.isInteger(datos.indiceCancelar)) return datos.indiceCancelar;
        return datos.botones.findIndex((_, i) => i !== indiceAceptar);
    }

    function texto(datos) {
        return datos.detalle ? `${datos.mensaje}\n\n${datos.detalle}` : datos.mensaje;
    }

    api.alPedirDialogo(async (datos) => {
        // Primero el acuse: el proceso principal está esperándolo para decidir
        // si esta pantalla puede con el diálogo o hace falta el nativo.
        api.acusarDialogo(datos.id);

        const opciones = {
            titulo: datos.titulo,
            tipo: TIPOS[datos.tipo] || 'normal'
        };

        // Un solo botón es un aviso, no una pregunta.
        if (!datos.botones || datos.botones.length < 2) {
            opciones.aceptar = (datos.botones && datos.botones[0]) || 'Entendido';
            await window.avisar(texto(datos), opciones);
            api.responderDialogo(datos.id, 0);
            return;
        }

        const indiceAceptar = aceptarPorDefecto(datos);
        const indiceCancelar = cancelarPorDefecto(datos, indiceAceptar);

        opciones.aceptar = datos.botones[indiceAceptar];
        opciones.cancelar = datos.botones[indiceCancelar];

        const aceptado = await window.confirmar(texto(datos), opciones);
        api.responderDialogo(datos.id, aceptado ? indiceAceptar : indiceCancelar);
    });
})();
