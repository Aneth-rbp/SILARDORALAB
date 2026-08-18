/**
 * Recupera el foco del teclado despues de un dialogo nativo.
 *
 * confirm(), alert() y prompt() no son ventanas de la pagina: Electron las abre
 * como dialogos de Windows, encima de la aplicacion. Al cerrarse, la ventana
 * vuelve a estar al frente pero su contenido web se queda sin el foco del
 * teclado. La pantalla se ve normal y responde al raton, y aun asi no se puede
 * escribir en ningun campo, porque las teclas ya no llegan a la pagina. Se nota
 * sobre todo al parar un proceso, que es el confirm() que mas se usa.
 *
 * En vez de tocar los once sitios que llaman a confirm(), se envuelven las tres
 * funciones aqui. Siguen siendo sincronas y devolviendo lo mismo, asi que quien
 * las llama no cambia en nada.
 *
 * Este archivo se carga antes que las pantallas para que ningun confirm() se
 * escape sin envolver.
 *
 * Fuera de Electron -la aplicacion tambien se abre en un navegador normal
 * contra localhost:3001- no existe electronAPI y esto se queda solo en el
 * retoque del DOM, que ahi no hace falta pero tampoco estorba.
 */
(function () {
    'use strict';

    /**
     * Vuelve a enfocar el campo que estaba activo antes del dialogo.
     *
     * Despues del dialogo ese campo sigue siendo document.activeElement, pero
     * sin foco de verdad. Sacarlo y volverlo a poner es lo que hace que acepte
     * teclas otra vez; solo reasignarlo no basta, porque para el navegador
     * nunca lo perdio.
     */
    function reenfocarElemento(elementoActivo) {
        if (!elementoActivo || elementoActivo === document.body) return;
        if (typeof elementoActivo.focus !== 'function') return;
        if (!elementoActivo.isConnected) return;

        elementoActivo.blur();
        elementoActivo.focus();
    }

    function devolverElFoco() {
        const elementoActivo = document.activeElement;

        window.focus();

        // El proceso principal es el unico que puede devolverle el foco al
        // contenido web; desde la pagina no se llega a eso. Se hace primero y
        // el campo se reenfoca despues, cuando la ventana ya escucha el
        // teclado: al reves el foco del campo se pierde otra vez.
        const api = window.electronAPI;
        if (api && typeof api.restaurarFoco === 'function') {
            api.restaurarFoco()
                .then(() => reenfocarElemento(elementoActivo))
                .catch(() => reenfocarElemento(elementoActivo));
            return;
        }

        reenfocarElemento(elementoActivo);
    }

    ['confirm', 'alert', 'prompt'].forEach(function (nombre) {
        const original = window[nombre];
        if (typeof original !== 'function') return;

        window[nombre] = function () {
            try {
                return original.apply(window, arguments);
            } finally {
                // En finally y no despues del return para que el foco se
                // recupere igual si el dialogo falla por lo que sea. El valor
                // que devuelve el dialogo no se altera.
                devolverElFoco();
            }
        };
    });
})();
