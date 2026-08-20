/**
 * Configuration Screen - Configuración del sistema SILAR
 * Equivale a las pantallas 7 del diseño original
 * Solo administradores pueden modificar la configuración
 */

class ConfigurationScreen {
    // Lo que se muestra si la configuración todavía no tiene los topes: el mismo
    // valor que siembra la migración 008, para que el formulario no proponga
    // guardar un número distinto del que ya está vigente.
    static LIMITE_VELOCIDAD_POR_DEFECTO_MMS = 50;

    // Lo que cada eje da de verdad, en mm/s, según el firmware (MAX_SPEED_Y y
    // MAX_SPEED_Z, 2000 pasos/s, entre los pasos/mm de cada eje). No se usan
    // como tope del formulario: se enseñan al administrador para que sepa a
    // partir de qué número el firmware va a recortar por su cuenta.
    static VELOCIDAD_MECANICA_Y_MMS = 26;
    static VELOCIDAD_MECANICA_Z_MMS = 100;

    constructor(app) {
        this.app = app;
        this.config = {};
        this.configData = {};
        this.isAdmin = false;

        // Estado del asistente de calibración del eje Z.
        // puntos: [{ pasos, alturaMM }] medidos por el operador con la regla.
        this.calZ = {
            calibracion: null,
            tamanoPaso: 1000,
            pasosAcumulados: 0,
            puntos: [],
            ajuste: null,
            ocupado: false
        };

        // Estado del asistente de geometría del eje Y.
        // puntos: [{ pasos, distanciaMM }] medidos por el operador con la regla.
        // vasos: posición capturada de cada vaso, en PASOS (null = sin capturar).
        this.calY = {
            calibracion: null,
            tamanoPaso: 1000,
            pasosActuales: 0,
            puntos: [],
            ajuste: null,
            vasos: [null, null, null, null],
            ocupado: false
        };

        this.init();
    }

    init() {
        this.checkAdminPermissions();
        this.loadConfiguration();
        this.bindEvents();
        this.loadZCalibration();
        this.loadYCalibration();
    }

    destroy() {
        // bindEvents cuelga de document, no del contenedor de la pantalla: sin
        // esto cada visita a Configuración dejaba un listener más y los botones
        // acababan disparando varias veces.
        if (this.clickHandler) {
            document.removeEventListener('click', this.clickHandler);
            this.clickHandler = null;
        }
    }

    checkAdminPermissions() {
        // Verificar si el usuario actual es administrador
        this.isAdmin = this.app.userSession?.role === 'admin';

        if (!this.isAdmin) {
            console.warn('Usuario no es administrador - acceso de solo lectura');
        }
    }

    bindEvents() {
        // Usar delegación de eventos para asegurar que funcionen tras el renderizado
        this.clickHandler = (e) => {
            if (e.target.closest('#save-config-btn')) {
                this.saveConfiguration();
            }
            if (e.target.closest('#reset-config-btn')) {
                this.resetConfiguration();
            }

            // --- Asistente de calibración del eje Z ---
            if (e.target.closest('#calz-home-btn')) this.calZHome();
            if (e.target.closest('#calz-down-btn')) this.calZBajar();
            if (e.target.closest('#calz-measure-btn')) this.calZRegistrarMedida();
            if (e.target.closest('#calz-undo-btn')) this.calZDeshacerMedida();
            if (e.target.closest('#calz-apply-btn')) this.calZAplicar();
            if (e.target.closest('#calz-verify-btn')) this.calZVerificar();
            if (e.target.closest('#calz-save-btn')) this.calZGuardar();
            if (e.target.closest('#calz-factory-btn')) this.calZRestaurarFabrica();

            // --- Asistente de geometría del eje Y ---
            if (e.target.closest('#caly-home-btn')) this.calYHome();
            if (e.target.closest('#caly-fwd-btn')) this.calYMover(1);
            if (e.target.closest('#caly-back-btn')) this.calYMover(-1);
            if (e.target.closest('#caly-measure-btn')) this.calYRegistrarMedida();
            if (e.target.closest('#caly-undo-btn')) this.calYDeshacerMedida();
            if (e.target.closest('#caly-apply-btn')) this.calYAplicar();
            if (e.target.closest('#caly-save-btn')) this.calYGuardar();
            if (e.target.closest('#caly-factory-btn')) this.calYRestaurarFabrica();

            // Los cuatro vasos comparten manejador: el índice viaja en el
            // data- del botón, que es lo único que los distingue.
            const capturar = e.target.closest('[data-caly-capturar]');
            if (capturar) this.calYCapturarVaso(Number(capturar.dataset.calyCapturar));
            const ir = e.target.closest('[data-caly-ir]');
            if (ir) this.calYIrAVaso(Number(ir.dataset.calyIr));
        };

        document.addEventListener('click', this.clickHandler);
    }

    async loadConfiguration() {
        try {
            const response = await this.app.apiCall('/config');

            if (response.success) {
                this.configData = response.config || {};
                this.config = {};

                // Convertir configuraciones agrupadas a objeto plano
                Object.values(this.configData).forEach(category => {
                    category.forEach(item => {
                        this.config[item.key] = item.value;
                    });
                });

                this.updateConfigurationForm();
            } else {
                if (response.message && response.message.includes('administradores')) {
                    this.showReadOnlyMessage();
                } else {
                    this.app.showError(response.message || 'Error cargando la configuración');
                }
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            this.app.showError('Error cargando la configuración');
        }
    }

    updateConfigurationForm() {
        const formFields = {
            'config-report-path': this.config.report_path || '',
            'config-max-transfer-speed': this.config.max_transfer_speed || ConfigurationScreen.LIMITE_VELOCIDAD_POR_DEFECTO_MMS,
            'config-max-dip-speed': this.config.max_dip_speed || ConfigurationScreen.LIMITE_VELOCIDAD_POR_DEFECTO_MMS,
            'config-humidity-offset': this.config.humidity_offset || 0,
            'config-temperature-offset': this.config.temperature_offset || 0
        };

        Object.entries(formFields).forEach(([fieldId, value]) => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.value = value;
                if (!this.isAdmin) {
                    field.disabled = true;
                    field.classList.add('bg-light');
                }
            }
        });

        const saveBtn = document.getElementById('save-config-btn');
        if (saveBtn) {
            saveBtn.disabled = !this.isAdmin;
            if (!this.isAdmin) {
                saveBtn.classList.add('opacity-50');
            }
        }

        // La calibración no se muestra en solo lectura: mueve el eje de verdad.
        ['calz-container', 'caly-container'].forEach((id) => {
            const contenedor = document.getElementById(id);
            if (contenedor && !this.isAdmin) {
                contenedor.classList.add('d-none');
            }
        });
    }

    showReadOnlyMessage() {
        const configContainer = document.getElementById('config-container');
        if (configContainer) {
            configContainer.innerHTML = `
                <div class="alert alert-warning d-flex align-items-center" role="alert">
                    <i class="bi bi-shield-lock me-3" style="font-size: 2rem;"></i>
                    <div>
                        <h5 class="alert-heading mb-1">Acceso Restringido</h5>
                        <p class="mb-0">Solo los administradores pueden ver y modificar la configuración del sistema.</p>
                    </div>
                </div>
            `;
        }
    }

    async saveConfiguration() {
        if (!this.isAdmin) {
            this.app.showError('Solo los administradores pueden guardar la configuración');
            return;
        }

        const maxTransferSpeed = parseFloat(document.getElementById('config-max-transfer-speed')?.value) || 0;
        const maxDipSpeed = parseFloat(document.getElementById('config-max-dip-speed')?.value) || 0;

        // Un tope en 0 se rechaza antes de mandarlo: dejaría la máquina sin poder
        // guardar ninguna receta. Por arriba no se corrige nada; si el número
        // pasa de lo que el eje da, el firmware recorta en marcha y lo avisa.
        const topes = [
            ['transferencia Y', maxTransferSpeed],
            ['inmersión Z', maxDipSpeed]
        ];

        for (const [eje, valor] of topes) {
            if (valor <= 0) {
                this.app.showError(`La velocidad máxima de ${eje} tiene que ser mayor que 0 mm/s`);
                return;
            }
        }

        const configToSave = {
            report_path: document.getElementById('config-report-path')?.value || '',
            max_transfer_speed: maxTransferSpeed,
            max_dip_speed: maxDipSpeed,
            humidity_offset: parseFloat(document.getElementById('config-humidity-offset')?.value) || 0,
            temperature_offset: parseFloat(document.getElementById('config-temperature-offset')?.value) || 0
        };

        const saveBtn = document.getElementById('save-config-btn');
        const originalContent = saveBtn.innerHTML;

        try {
            saveBtn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Guardando...';
            saveBtn.disabled = true;

            const response = await this.app.apiCall('/config', {
                method: 'PUT',
                body: JSON.stringify({ config: configToSave })
            });

            if (response.success) {
                this.app.showSuccess('Configuración guardada correctamente');
                await this.loadConfiguration();
            } else {
                throw new Error(response.message);
            }
        } catch (error) {
            this.app.showError(error.message || 'Error guardando la configuración');
        } finally {
            saveBtn.innerHTML = originalContent;
            saveBtn.disabled = false;
        }
    }

    async resetConfiguration() {
        if (!this.isAdmin) return;

        const restablecer = await confirmar('¿Está seguro que desea restablecer los cambios?', {
            titulo: 'Restablecer cambios',
            aceptar: 'Restablecer',
            tipo: 'aviso'
        });

        if (restablecer) {
            this.loadConfiguration();
        }
    }

    // =====================================================================
    // Calibración del eje Z
    //
    // Reproduce el procedimiento que resultó fiable en la máquina: un solo
    // home y varias bajadas IGUALES, midiendo la altura del sustrato sobre el
    // suelo después de cada una. Las diferencias entre lecturas dan la escala
    // sin depender de acertar dónde está el cero; medir la altura de home a ojo
    // fue justo lo que descuadró la calibración anterior por 2 cm.
    // =====================================================================

    async calZApi(ruta, opciones = {}) {
        return await this.app.apiCall(`/arduino/calibration/z${ruta}`, opciones);
    }

    async loadZCalibration() {
        if (!this.isAdmin) return;

        try {
            const respuesta = await this.calZApi('');
            if (respuesta.success) {
                this.calZ.calibracion = respuesta.calibration;
            } else {
                this.calZ.calibracion = null;
                this.calZEstado(respuesta.message || 'No se pudo leer la calibración', 'warning');
            }
        } catch (error) {
            // apiCall lanza con el mensaje del servidor: repetirlo tal cual, que
            // distingue "no conectado" de "firmware antiguo" o "timeout".
            this.calZ.calibracion = null;
            this.calZEstado(error.message || 'No se pudo leer la calibración', 'warning');
        }

        this.renderZCalibration();
    }

    calZEstado(mensaje, tipo = 'info') {
        const caja = document.getElementById('calz-status');
        if (!caja) return;
        caja.className = `alert alert-${tipo} py-2 px-3 small mb-3`;
        caja.textContent = mensaje;
        caja.classList.remove('d-none');
    }

    calZOcupado(ocupado, mensaje) {
        this.calZ.ocupado = ocupado;
        ['calz-home-btn', 'calz-down-btn', 'calz-measure-btn', 'calz-apply-btn',
            'calz-verify-btn', 'calz-save-btn', 'calz-factory-btn'].forEach((id) => {
                const boton = document.getElementById(id);
                if (boton) boton.disabled = ocupado;
            });
        if (ocupado && mensaje) this.calZEstado(mensaje, 'info');
    }

    async calZHome() {
        if (!this.isAdmin || this.calZ.ocupado) return;

        this.calZOcupado(true, 'Ejecutando home... el eje sube hasta el final de carrera.');
        try {
            const respuesta = await this.calZApi('/home', { method: 'POST' });
            if (!respuesta.success) throw new Error(respuesta.message);

            // El home redefine el cero, así que las medidas anteriores ya no
            // pertenecen a la misma serie.
            this.calZ.pasosAcumulados = 0;
            this.calZ.puntos = [];
            this.calZ.ajuste = null;
            this.calZEstado('Home completado. Mide la altura del sustrato y regístrala como primer punto.', 'success');
        } catch (error) {
            this.calZEstado(`Error ejecutando home: ${error.message}`, 'danger');
        } finally {
            this.calZOcupado(false);
            this.renderZCalibration();
        }
    }

    async calZBajar() {
        if (!this.isAdmin || this.calZ.ocupado) return;

        const tamano = parseInt(document.getElementById('calz-step-size')?.value, 10);
        if (!Number.isInteger(tamano) || tamano <= 0) {
            this.calZEstado('El tamaño de paso debe ser un entero positivo', 'warning');
            return;
        }
        this.calZ.tamanoPaso = tamano;

        this.calZOcupado(true, `Bajando ${tamano} pasos...`);
        try {
            const respuesta = await this.calZApi('/jog', {
                method: 'POST',
                body: JSON.stringify({ steps: -tamano })
            });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calZ.pasosAcumulados += tamano;
            this.calZEstado(`Bajada completada (${this.calZ.pasosAcumulados} pasos desde home). Mide y registra.`, 'success');
        } catch (error) {
            this.calZEstado(`Error bajando el eje: ${error.message}`, 'danger');
        } finally {
            this.calZOcupado(false);
            this.renderZCalibration();
        }
    }

    calZRegistrarMedida() {
        if (!this.isAdmin) return;

        const campo = document.getElementById('calz-measure-input');
        const mm = parseFloat(campo?.value);
        if (!Number.isFinite(mm) || mm <= 0) {
            this.calZEstado('Escribe la altura medida en mm', 'warning');
            return;
        }

        const yaMedido = this.calZ.puntos.find(p => p.pasos === this.calZ.pasosAcumulados);
        if (yaMedido) {
            yaMedido.alturaMM = mm;
        } else {
            this.calZ.puntos.push({ pasos: this.calZ.pasosAcumulados, alturaMM: mm });
            this.calZ.puntos.sort((a, b) => a.pasos - b.pasos);
        }

        if (campo) campo.value = '';
        this.calZ.ajuste = this.calZAjustar();
        this.calZEstado(`Punto registrado: ${this.calZ.pasosAcumulados} pasos → ${mm.toFixed(1)} mm`, 'success');
        this.renderZCalibration();
    }

    calZDeshacerMedida() {
        if (!this.calZ.puntos.length) return;
        this.calZ.puntos.pop();
        this.calZ.ajuste = this.calZAjustar();
        this.renderZCalibration();
    }

    /**
     * Recta de mínimos cuadrados altura = A + B·pasos, con los pasos contados
     * hacia abajo desde home. B sale negativo y su inverso es la escala:
     *   pasos/mm = -1/B     altura de home = A
     * Se devuelven también los residuos: si un punto se desvía milímetros del
     * ajuste es que esa lectura está mal, y eso hay que verlo ANTES de aplicar.
     */
    calZAjustar() {
        const puntos = this.calZ.puntos;
        if (puntos.length < 2) return null;

        const n = puntos.length;
        const sumaX = puntos.reduce((acc, p) => acc + p.pasos, 0);
        const sumaY = puntos.reduce((acc, p) => acc + p.alturaMM, 0);
        const sumaXY = puntos.reduce((acc, p) => acc + p.pasos * p.alturaMM, 0);
        const sumaXX = puntos.reduce((acc, p) => acc + p.pasos * p.pasos, 0);

        const denominador = n * sumaXX - sumaX * sumaX;
        if (denominador === 0) return null;

        const B = (n * sumaXY - sumaX * sumaY) / denominador;
        const A = (sumaY - B * sumaX) / n;

        // B tiene que ser negativo: bajar pasos reduce la altura. Si sale
        // positivo, las medidas están al revés o hay un error de tecleo.
        if (!(B < 0)) {
            return { error: 'Las alturas no bajan al bajar el eje. Revisa las medidas.' };
        }

        const pasosPorMM = -1 / B;
        const residuos = puntos.map(p => ({
            pasos: p.pasos,
            alturaMM: p.alturaMM,
            residuoMM: p.alturaMM - (A + B * p.pasos)
        }));
        const peorResiduo = Math.max(...residuos.map(r => Math.abs(r.residuoMM)));

        return { pasosPorMM, alturaHomeMM: A, residuos, peorResiduo };
    }

    async calZAplicar() {
        if (!this.isAdmin || this.calZ.ocupado) return;

        const ajuste = this.calZ.ajuste;
        if (!ajuste || ajuste.error) {
            this.calZEstado('Necesitas al menos dos medidas válidas antes de aplicar', 'warning');
            return;
        }

        const alturaMinima = parseFloat(document.getElementById('calz-min-height')?.value);

        this.calZOcupado(true, 'Aplicando calibración en la máquina...');
        try {
            const respuesta = await this.calZApi('', {
                method: 'PUT',
                body: JSON.stringify({
                    stepsPerMm: Number(ajuste.pasosPorMM.toFixed(4)),
                    homeHeightMm: Number(ajuste.alturaHomeMM.toFixed(2)),
                    minHeightMm: Number.isFinite(alturaMinima) ? alturaMinima : undefined
                })
            });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calZ.calibracion = respuesta.calibration;
            this.calZEstado('Calibración aplicada en memoria. Verifícala con la regla y luego guárdala.', 'success');
        } catch (error) {
            this.calZEstado(`Error aplicando la calibración: ${error.message}`, 'danger');
        } finally {
            this.calZOcupado(false);
            this.renderZCalibration();
        }
    }

    async calZVerificar() {
        if (!this.isAdmin || this.calZ.ocupado) return;

        const mm = parseFloat(document.getElementById('calz-verify-height')?.value);
        if (!Number.isFinite(mm) || mm <= 0) {
            this.calZEstado('Escribe la altura de verificación en mm', 'warning');
            return;
        }

        this.calZOcupado(true, `Moviendo el eje a ${mm.toFixed(1)} mm...`);
        try {
            const respuesta = await this.calZApi('/goto', {
                method: 'POST',
                body: JSON.stringify({ heightMm: mm })
            });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calZEstado(`Movimiento terminado. Mide con la regla: debe dar ${mm.toFixed(1)} mm exactos.`, 'info');
        } catch (error) {
            this.calZEstado(`Error moviendo el eje: ${error.message}`, 'danger');
        } finally {
            this.calZOcupado(false);
        }
    }

    async calZGuardar() {
        if (!this.isAdmin || this.calZ.ocupado) return;

        const guardar = await confirmar('¿Guardar esta calibración en la memoria de la máquina?\n\nSustituye a la anterior y se usará en todas las recetas.', {
            titulo: 'Guardar calibración',
            aceptar: 'Guardar',
            tipo: 'aviso'
        });

        if (!guardar) {
            return;
        }

        this.calZOcupado(true, 'Guardando en la máquina...');
        try {
            const respuesta = await this.calZApi('/save', { method: 'POST' });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calZ.calibracion = respuesta.calibration;
            this.app.showSuccess('Calibración guardada en la máquina');
            this.calZEstado('Calibración guardada. Sobrevive al reinicio del Arduino.', 'success');
        } catch (error) {
            this.calZEstado(`Error guardando la calibración: ${error.message}`, 'danger');
        } finally {
            this.calZOcupado(false);
            this.renderZCalibration();
        }
    }

    async calZRestaurarFabrica() {
        if (!this.isAdmin || this.calZ.ocupado) return;

        const restaurar = await confirmar('¿Restaurar la calibración de fábrica?\n\nSe pierde la calibración guardada actualmente.', {
            titulo: 'Restaurar calibración de fábrica',
            aceptar: 'Restaurar',
            tipo: 'peligro'
        });

        if (!restaurar) {
            return;
        }

        this.calZOcupado(true, 'Restaurando valores de fábrica...');
        try {
            const respuesta = await this.calZApi('/reset', { method: 'POST' });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calZ.calibracion = respuesta.calibration;
            this.calZ.puntos = [];
            this.calZ.ajuste = null;
            this.calZEstado('Calibración de fábrica restaurada.', 'success');
        } catch (error) {
            this.calZEstado(`Error restaurando la calibración: ${error.message}`, 'danger');
        } finally {
            this.calZOcupado(false);
            this.renderZCalibration();
        }
    }

    renderZCalibration() {
        const actual = document.getElementById('calz-current');
        if (actual) {
            const cal = this.calZ.calibracion;
            actual.innerHTML = cal
                ? `
                    <div class="col-6 col-md-3"><span class="text-muted x-small d-block">Pasos por mm</span><strong>${cal.stepsPerMm.toFixed(3)}</strong></div>
                    <div class="col-6 col-md-3"><span class="text-muted x-small d-block">Altura en home</span><strong>${cal.homeHeightMm.toFixed(1)} mm</strong></div>
                    <div class="col-6 col-md-3"><span class="text-muted x-small d-block">Altura mínima</span><strong>${cal.minHeightMm.toFixed(1)} mm</strong></div>
                    <div class="col-6 col-md-3"><span class="text-muted x-small d-block">Fondo del eje</span><strong>${cal.floorSteps} pasos</strong></div>
                  `
                : '<div class="col-12 text-muted small">Sin datos: conecta el Arduino para leer la calibración.</div>';
        }

        const contador = document.getElementById('calz-accumulated');
        if (contador) contador.textContent = `${this.calZ.pasosAcumulados} pasos desde home`;

        const tabla = document.getElementById('calz-points');
        if (tabla) {
            if (!this.calZ.puntos.length) {
                tabla.innerHTML = '<tr><td colspan="3" class="text-muted small text-center py-3">Aún no hay medidas</td></tr>';
            } else {
                const ajuste = this.calZ.ajuste;
                tabla.innerHTML = this.calZ.puntos.map((p, i) => {
                    const residuo = ajuste && !ajuste.error ? ajuste.residuos[i].residuoMM : null;
                    const fuera = residuo !== null && Math.abs(residuo) > 2;
                    return `
                        <tr class="${fuera ? 'table-warning' : ''}">
                            <td>${p.pasos}</td>
                            <td>${p.alturaMM.toFixed(1)} mm</td>
                            <td class="${fuera ? 'fw-bold' : 'text-muted'}">${ConfigurationScreen.formatearResiduo(residuo)}</td>
                        </tr>
                    `;
                }).join('');
            }
        }

        const resultado = document.getElementById('calz-result');
        if (resultado) {
            const ajuste = this.calZ.ajuste;
            if (!ajuste) {
                resultado.innerHTML = '<span class="text-muted small">Registra al menos dos medidas para calcular la escala.</span>';
            } else if (ajuste.error) {
                resultado.innerHTML = `<span class="text-danger small fw-bold">${ajuste.error}</span>`;
            } else {
                const aviso = ajuste.peorResiduo > 2
                    ? `<div class="text-warning small mt-2"><i class="bi bi-exclamation-triangle me-1"></i>Hay medidas que se desvían hasta ${ajuste.peorResiduo.toFixed(1)} mm del ajuste. Repite las marcadas antes de aplicar.</div>`
                    : `<div class="text-success small mt-2"><i class="bi bi-check-circle me-1"></i>Las medidas encajan en una recta (desviación máxima ${ajuste.peorResiduo.toFixed(1)} mm).</div>`;
                resultado.innerHTML = `
                    <div class="row g-3">
                        <div class="col-6"><span class="text-muted x-small d-block">Pasos por mm calculados</span><strong class="fs-5">${ajuste.pasosPorMM.toFixed(3)}</strong></div>
                        <div class="col-6"><span class="text-muted x-small d-block">Altura en home calculada</span><strong class="fs-5">${ajuste.alturaHomeMM.toFixed(1)} mm</strong></div>
                    </div>
                    ${aviso}
                `;
            }
        }

        const aplicar = document.getElementById('calz-apply-btn');
        if (aplicar) aplicar.disabled = !this.isAdmin || !this.calZ.ajuste || !!this.calZ.ajuste.error;
    }

    // =====================================================================
    // Geometría del eje Y
    //
    // Mismo asistente que el de Z, por el mismo motivo: medir a ojo dónde está
    // el cero fue lo que descuadró la calibración de Z por 2 cm, y aquí el
    // problema es idéntico. Así que la escala sale de las DIFERENCIAS entre
    // lecturas -home, mover una cantidad conocida de pasos, medir con la regla,
    // repetir- y no de acertar desde dónde mide la regla.
    //
    // Lo que se calibra son dos cosas independientes:
    //
    //   - Pasos por mm: la mecánica del eje. Solo cambia si se toca la
    //     transmisión, y de ella depende que transferSpeed en mm/s signifique
    //     lo que dice (y cuál es la velocidad máxima del eje).
    //   - Posición de cada vaso: dónde para el eje para cada uno de los cuatro.
    //     No se miden con la regla: se mueve el eje hasta que el sustrato queda
    //     centrado sobre el vaso y se captura la posición REAL que reporta el
    //     firmware. Van una a una porque los vasos no tienen por qué estar
    //     igualmente separados; en cuanto se reubica uno, una separación única
    //     deja de describir el banco.
    //
    // Los vasos se guardan en PASOS, no en mm, y se convierten a mm solo al
    // aplicar. Así, si además se recalcula la escala, los vasos siguen cayendo
    // en el mismo sitio físico: no se han movido, solo se miden distinto.
    // =====================================================================

    async calYApi(ruta, opciones = {}) {
        return await this.app.apiCall(`/arduino/calibration/y${ruta}`, opciones);
    }

    async loadYCalibration() {
        if (!this.isAdmin) return;

        try {
            const respuesta = await this.calYApi('');
            if (respuesta.success) {
                this.calY.calibracion = respuesta.calibration;
                this.calYSincronizarConMaquina();
            } else {
                this.calY.calibracion = null;
                this.calYEstado(respuesta.message || 'No se pudo leer la geometría', 'warning');
            }
        } catch (error) {
            this.calY.calibracion = null;
            this.calYEstado(error.message || 'No se pudo leer la geometría', 'warning');
        }

        this.renderYCalibration();
    }

    /**
     * Parte de lo que la máquina tiene cargado ahora mismo: la posición real
     * del eje y los cuatro vasos ya convertidos a pasos por el firmware. Así se
     * puede recalcular solo la escala, o recapturar solo un vaso, sin que el
     * resto se quede en blanco.
     */
    calYSincronizarConMaquina() {
        const cal = this.calY.calibracion;
        if (!cal) return;

        if (Number.isFinite(cal.currentSteps)) {
            this.calY.pasosActuales = cal.currentSteps;
        }
        this.calY.vasos = this.calY.vasos.map((pasos, i) => (
            pasos === null && Number.isFinite(cal.positions[i]) ? cal.positions[i] : pasos
        ));
    }

    calYEstado(mensaje, tipo = 'info') {
        const caja = document.getElementById('caly-status');
        if (!caja) return;
        caja.className = `alert alert-${tipo} py-2 px-3 small mb-3`;
        caja.textContent = mensaje;
        caja.classList.remove('d-none');
    }

    calYOcupado(ocupado, mensaje) {
        this.calY.ocupado = ocupado;
        ['caly-home-btn', 'caly-fwd-btn', 'caly-back-btn', 'caly-measure-btn',
            'caly-apply-btn', 'caly-save-btn', 'caly-factory-btn'].forEach((id) => {
                const boton = document.getElementById(id);
                if (boton) boton.disabled = ocupado;
            });
        document.querySelectorAll('[data-caly-capturar], [data-caly-ir]').forEach((boton) => {
            boton.disabled = ocupado;
        });
        if (ocupado && mensaje) this.calYEstado(mensaje, 'info');
    }

    async calYHome() {
        if (!this.isAdmin || this.calY.ocupado) return;

        this.calYOcupado(true, 'Ejecutando home... los ejes van hasta el final de carrera.');
        try {
            const respuesta = await this.calYApi('/home', { method: 'POST' });
            if (!respuesta.success) throw new Error(respuesta.message);

            // El home redefine el cero del eje, así que las medidas anteriores
            // ya no pertenecen a la misma serie.
            this.calY.pasosActuales = 0;
            this.calY.puntos = [];
            this.calY.ajuste = null;
            this.calYEstado('Home completado. Mide desde el home hasta el sustrato y registra ese primer punto.', 'success');
        } catch (error) {
            this.calYEstado(`Error ejecutando home: ${error.message}`, 'danger');
        } finally {
            this.calYOcupado(false);
            this.renderYCalibration();
        }
    }

    /**
     * signo = +1 aleja del home, -1 lo acerca. La posición no se acumula aquí:
     * se toma la que devuelve el firmware, que es la única que sabe si el eje
     * llegó o se paró antes contra un final de carrera.
     */
    async calYMover(signo) {
        if (!this.isAdmin || this.calY.ocupado) return;

        const tamano = parseInt(document.getElementById('caly-step-size')?.value, 10);
        if (!Number.isInteger(tamano) || tamano <= 0) {
            this.calYEstado('El tamaño de paso debe ser un entero positivo', 'warning');
            return;
        }
        this.calY.tamanoPaso = tamano;

        this.calYOcupado(true, `Moviendo ${signo > 0 ? '+' : '-'}${tamano} pasos...`);
        try {
            const respuesta = await this.calYApi('/jog', {
                method: 'POST',
                body: JSON.stringify({ steps: signo * tamano })
            });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calY.pasosActuales = respuesta.result.currentSteps;
            this.calYEstado(`Movimiento completado (${this.calY.pasosActuales} pasos desde home). Mide y registra.`, 'success');
        } catch (error) {
            this.calYEstado(`Error moviendo el eje: ${error.message}`, 'danger');
        } finally {
            this.calYOcupado(false);
            this.renderYCalibration();
        }
    }

    calYRegistrarMedida() {
        if (!this.isAdmin) return;

        const campo = document.getElementById('caly-measure-input');
        const mm = parseFloat(campo?.value);
        if (!Number.isFinite(mm)) {
            this.calYEstado('Escribe la distancia medida en mm', 'warning');
            return;
        }

        const yaMedido = this.calY.puntos.find(p => p.pasos === this.calY.pasosActuales);
        if (yaMedido) {
            yaMedido.distanciaMM = mm;
        } else {
            this.calY.puntos.push({ pasos: this.calY.pasosActuales, distanciaMM: mm });
            this.calY.puntos.sort((a, b) => a.pasos - b.pasos);
        }

        if (campo) campo.value = '';
        this.calY.ajuste = this.calYAjustar();
        this.calYEstado(`Punto registrado: ${this.calY.pasosActuales} pasos → ${mm.toFixed(1)} mm`, 'success');
        this.renderYCalibration();
    }

    calYDeshacerMedida() {
        if (!this.calY.puntos.length) return;
        this.calY.puntos.pop();
        this.calY.ajuste = this.calYAjustar();
        this.renderYCalibration();
    }

    /**
     * Recta de mínimos cuadrados distancia = A + B·pasos, con los pasos
     * contados desde el home. B sale positivo -alejarse del home aumenta la
     * distancia- y su inverso es la escala:
     *   pasos/mm = 1/B
     * A es el desplazamiento del cero de la regla y no se usa para nada: ahí
     * está justo la gracia del método, que ese error se queda fuera de B.
     * Se devuelven también los residuos: si un punto se desvía milímetros del
     * ajuste es que esa lectura está mal, y eso hay que verlo ANTES de aplicar.
     */
    calYAjustar() {
        const puntos = this.calY.puntos;
        if (puntos.length < 2) return null;

        const n = puntos.length;
        const sumaX = puntos.reduce((acc, p) => acc + p.pasos, 0);
        const sumaY = puntos.reduce((acc, p) => acc + p.distanciaMM, 0);
        const sumaXY = puntos.reduce((acc, p) => acc + p.pasos * p.distanciaMM, 0);
        const sumaXX = puntos.reduce((acc, p) => acc + p.pasos * p.pasos, 0);

        const denominador = n * sumaXX - sumaX * sumaX;
        if (denominador === 0) return null;

        const B = (n * sumaXY - sumaX * sumaY) / denominador;
        const A = (sumaY - B * sumaX) / n;

        // B tiene que ser positivo: alejarse del home aumenta la distancia. Si
        // sale negativo, las medidas están al revés o hay un error de tecleo.
        if (!(B > 0)) {
            return { error: 'Las distancias no crecen al alejarse del home. Revisa las medidas.' };
        }

        const pasosPorMM = 1 / B;
        const residuos = puntos.map(p => ({
            pasos: p.pasos,
            distanciaMM: p.distanciaMM,
            residuoMM: p.distanciaMM - (A + B * p.pasos)
        }));
        const peorResiduo = Math.max(...residuos.map(r => Math.abs(r.residuoMM)));

        return { pasosPorMM, origenMM: A, residuos, peorResiduo };
    }

    /**
     * La escala con la que se traducen los vasos a mm: la recién medida si la
     * hay, y si no la que la máquina ya tiene cargada.
     */
    calYPasosPorMM() {
        const ajuste = this.calY.ajuste;
        if (ajuste && !ajuste.error) return ajuste.pasosPorMM;
        return this.calY.calibracion?.stepsPerMm ?? null;
    }

    calYCapturarVaso(indice) {
        if (!this.isAdmin || this.calY.ocupado) return;

        this.calY.vasos[indice] = this.calY.pasosActuales;
        const ppm = this.calYPasosPorMM();
        const enMM = ppm ? ` (${(this.calY.pasosActuales / ppm).toFixed(1)} mm)` : '';
        this.calYEstado(`Vaso ${indice + 1} capturado en ${this.calY.pasosActuales} pasos${enMM}.`, 'success');
        this.renderYCalibration();
    }

    /**
     * Lleva el eje a la distancia en mm que se haya escrito para ese vaso, para
     * poder MIRAR si acierta antes de capturar nada. Es también la verificación
     * del conjunto: tras aplicar, el sustrato debe quedar centrado sobre el vaso.
     *
     * El campo arranca con lo que ya está capturado, así que sin tocarlo el
     * botón hace justo lo de antes: volver a la posición guardada.
     */
    async calYIrAVaso(indice) {
        if (!this.isAdmin || this.calY.ocupado) return;

        const ppm = this.calYPasosPorMM();
        if (!Number.isFinite(ppm) || ppm <= 0) {
            this.calYEstado('Sin la escala del eje no se pueden traducir los mm a pasos', 'warning');
            return;
        }

        const mm = parseFloat(document.getElementById(`caly-goto-${indice + 1}`)?.value);
        if (!Number.isFinite(mm) || mm < 0) {
            this.calYEstado(`Escribe a cuántos mm del home quieres llevar el eje para el vaso ${indice + 1}`, 'warning');
            return;
        }

        const diferencia = Math.round(mm * ppm) - this.calY.pasosActuales;
        if (diferencia === 0) {
            this.calYEstado(`El eje ya está en ${mm.toFixed(1)} mm.`, 'info');
            return;
        }

        this.calYOcupado(true, `Moviendo a ${mm.toFixed(1)} mm...`);
        try {
            const respuesta = await this.calYApi('/jog', {
                method: 'POST',
                body: JSON.stringify({ steps: diferencia })
            });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calY.pasosActuales = respuesta.result.currentSteps;
            this.calYEstado(`Eje en ${mm.toFixed(1)} mm. Si el sustrato queda centrado sobre el vaso ${indice + 1}, pulsa Capturar.`, 'info');
        } catch (error) {
            this.calYEstado(`Error moviendo el eje: ${error.message}`, 'danger');
        } finally {
            this.calYOcupado(false);
            this.renderYCalibration();
        }
    }

    async calYAplicar() {
        if (!this.isAdmin || this.calY.ocupado) return;

        const pasosPorMM = this.calYPasosPorMM();
        if (!Number.isFinite(pasosPorMM) || pasosPorMM <= 0) {
            this.calYEstado('Falta la escala del eje: registra al menos dos medidas', 'warning');
            return;
        }

        // El vaso 1 puede quedarse en 0 (el home), así que aquí solo se exige
        // que esté capturado y no sea negativo. Que quepa en el eje lo comprueba
        // el firmware, que es quien conoce el final de carrera.
        const posiciones = [];
        for (let i = 0; i < 4; i++) {
            const pasos = this.calY.vasos[i];
            if (!Number.isFinite(pasos) || pasos < 0) {
                this.calYEstado(`Falta capturar la posición del vaso ${i + 1}`, 'warning');
                return;
            }
            posiciones.push(Number((pasos / pasosPorMM).toFixed(2)));
        }

        this.calYOcupado(true, 'Aplicando geometría en la máquina...');
        try {
            const respuesta = await this.calYApi('', {
                method: 'PUT',
                body: JSON.stringify({
                    vesselPositionsMm: posiciones,
                    stepsPerMm: Number(pasosPorMM.toFixed(4))
                })
            });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calY.calibracion = respuesta.calibration;
            this.calYEstado('Geometría aplicada en memoria. Comprueba con «Ir» que el eje para centrado en cada vaso antes de guardar.', 'success');
        } catch (error) {
            this.calYEstado(`Error aplicando la geometría: ${error.message}`, 'danger');
        } finally {
            this.calYOcupado(false);
            this.renderYCalibration();
        }
    }

    async calYGuardar() {
        if (!this.isAdmin || this.calY.ocupado) return;

        const guardar = await confirmar('¿Guardar esta geometría en la memoria de la máquina?\n\nSustituye a la anterior y se usará en todas las recetas.', {
            titulo: 'Guardar geometría',
            aceptar: 'Guardar',
            tipo: 'aviso'
        });

        if (!guardar) {
            return;
        }

        this.calYOcupado(true, 'Guardando en la máquina...');
        try {
            const respuesta = await this.calYApi('/save', { method: 'POST' });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calY.calibracion = respuesta.calibration;
            this.app.showSuccess('Geometría guardada en la máquina');
            this.calYEstado('Geometría guardada. Sobrevive al reinicio del Arduino.', 'success');
        } catch (error) {
            this.calYEstado(`Error guardando la geometría: ${error.message}`, 'danger');
        } finally {
            this.calYOcupado(false);
            this.renderYCalibration();
        }
    }

    async calYRestaurarFabrica() {
        if (!this.isAdmin || this.calY.ocupado) return;

        const restaurar = await confirmar('¿Restaurar la geometría de fábrica?\n\nVuelve a los vasos en 0 / 55 / 110 / 165 mm y se pierde la guardada actualmente.', {
            titulo: 'Restaurar geometría de fábrica',
            aceptar: 'Restaurar',
            tipo: 'peligro'
        });

        if (!restaurar) {
            return;
        }

        this.calYOcupado(true, 'Restaurando valores de fábrica...');
        try {
            const respuesta = await this.calYApi('/reset', { method: 'POST' });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calY.calibracion = respuesta.calibration;
            // La medición en curso ya no describe esta geometría: se descarta
            // entera, igual que tras un home, en vez de dejar media serie viva.
            this.calY.puntos = [];
            this.calY.ajuste = null;
            this.calY.vasos = [null, null, null, null];
            this.calYSincronizarConMaquina();
            this.calYEstado('Geometría de fábrica restaurada.', 'success');
        } catch (error) {
            this.calYEstado(`Error restaurando la geometría: ${error.message}`, 'danger');
        } finally {
            this.calYOcupado(false);
            this.renderYCalibration();
        }
    }

    renderYCalibration() {
        const cal = this.calY.calibracion;

        const actual = document.getElementById('caly-current');
        if (actual) {
            actual.innerHTML = cal
                ? `
                    <div class="col-12 col-md-6"><span class="text-muted x-small d-block">Posición de los vasos</span><strong>${cal.vesselPositionsMm.map((mm) => mm.toFixed(1)).join(' · ')} mm</strong></div>
                    <div class="col-6 col-md-3"><span class="text-muted x-small d-block">Pasos por mm</span><strong>${cal.stepsPerMm.toFixed(3)}</strong></div>
                    <div class="col-6 col-md-3"><span class="text-muted x-small d-block">Velocidad máxima</span><strong>${cal.maxSpeedMms.toFixed(1)} mm/s</strong></div>
                    <div class="col-12"><span class="text-muted x-small d-block">Posiciones (pasos)</span><strong>${cal.positions.join(' · ')}</strong></div>
                  `
                : '<div class="col-12 text-muted small">Sin datos: conecta el Arduino para leer la geometría.</div>';
        }

        const contador = document.getElementById('caly-position');
        if (contador) contador.textContent = `${this.calY.pasosActuales} pasos desde home`;

        const tabla = document.getElementById('caly-points');
        if (tabla) {
            if (!this.calY.puntos.length) {
                tabla.innerHTML = '<tr><td colspan="3" class="text-muted small text-center py-3">Aún no hay medidas</td></tr>';
            } else {
                const ajuste = this.calY.ajuste;
                tabla.innerHTML = this.calY.puntos.map((p, i) => {
                    const residuo = ajuste && !ajuste.error ? ajuste.residuos[i].residuoMM : null;
                    const fuera = residuo !== null && Math.abs(residuo) > 2;
                    return `
                        <tr class="${fuera ? 'table-warning' : ''}">
                            <td>${p.pasos}</td>
                            <td>${p.distanciaMM.toFixed(1)} mm</td>
                            <td class="${fuera ? 'fw-bold' : 'text-muted'}">${ConfigurationScreen.formatearResiduo(residuo)}</td>
                        </tr>
                    `;
                }).join('');
            }
        }

        const resultado = document.getElementById('caly-result');
        if (resultado) {
            const ajuste = this.calY.ajuste;
            if (!ajuste) {
                const actualPPM = cal
                    ? `<div class="text-muted small mt-2">Mientras tanto se usa la escala cargada en la máquina: <strong>${cal.stepsPerMm.toFixed(3)}</strong> pasos/mm.</div>`
                    : '';
                resultado.innerHTML = `<span class="text-muted small">Registra al menos dos medidas para recalcular la escala.</span>${actualPPM}`;
            } else if (ajuste.error) {
                resultado.innerHTML = `<span class="text-danger small fw-bold">${ajuste.error}</span>`;
            } else {
                const aviso = ajuste.peorResiduo > 2
                    ? `<div class="text-warning small mt-2"><i class="bi bi-exclamation-triangle me-1"></i>Hay medidas que se desvían hasta ${ajuste.peorResiduo.toFixed(1)} mm del ajuste. Repite las marcadas antes de aplicar.</div>`
                    : `<div class="text-success small mt-2"><i class="bi bi-check-circle me-1"></i>Las medidas encajan en una recta (desviación máxima ${ajuste.peorResiduo.toFixed(1)} mm).</div>`;
                resultado.innerHTML = `
                    <div class="row g-3">
                        <div class="col-6"><span class="text-muted x-small d-block">Pasos por mm calculados</span><strong class="fs-5">${ajuste.pasosPorMM.toFixed(3)}</strong></div>
                        <div class="col-6"><span class="text-muted x-small d-block">Recorrido por ${this.calY.tamanoPaso} pasos</span><strong class="fs-5">${(this.calY.tamanoPaso / ajuste.pasosPorMM).toFixed(1)} mm</strong></div>
                    </div>
                    ${aviso}
                `;
            }
        }

        // Los vasos se guardan en pasos y se muestran en mm con la escala que se
        // vaya a aplicar: si se recalcula la escala, los mm cambian solos sin
        // que haya que recapturar nada, porque el vaso sigue donde estaba.
        const ppm = this.calYPasosPorMM();
        this.calY.vasos.forEach((pasos, i) => {
            const celda = document.getElementById(`caly-pos-${i + 1}`);
            if (celda) {
                if (!Number.isFinite(pasos)) {
                    celda.innerHTML = '<span class="text-muted">sin capturar</span>';
                } else {
                    const mm = ppm ? `${(pasos / ppm).toFixed(1)} mm` : '—';
                    celda.innerHTML = `<strong>${mm}</strong> <span class="text-muted x-small">(${pasos} pasos)</span>`;
                }
            }

            // El campo de «Ir» parte de lo capturado, para que sirva tanto de
            // punto de partida al tantear como de vuelta a lo ya guardado. No se
            // pisa mientras se está escribiendo en él.
            const destino = document.getElementById(`caly-goto-${i + 1}`);
            if (destino && document.activeElement !== destino) {
                destino.value = Number.isFinite(pasos) && ppm ? (pasos / ppm).toFixed(1) : '';
            }
        });

        // «Ir» ya no depende de que el vaso esté capturado -su razón de ser es
        // justo mirar antes de capturar-, solo de que haya escala con la que
        // traducir los mm a pasos.
        document.querySelectorAll('[data-caly-ir]').forEach((boton) => {
            boton.disabled = this.calY.ocupado || !Number.isFinite(ppm);
        });

        // Hasta dónde llega el eje con la escala actual. Pasarse es el error más
        // fácil de cometer aquí, y el firmware rechaza el conjunto entero.
        const limite = document.getElementById('caly-limit');
        if (limite) {
            limite.textContent = cal && cal.axisLimitSteps && ppm
                ? `Con esta escala, ningún vaso puede pasar de ${(cal.axisLimitSteps / ppm).toFixed(1)} mm (final de carrera).`
                : '';
        }

        const aplicar = document.getElementById('caly-apply-btn');
        if (aplicar) {
            aplicar.disabled = !this.isAdmin || this.calY.ocupado
                || !Number.isFinite(ppm)
                || this.calY.vasos.some(pasos => !Number.isFinite(pasos));
        }
    }

    /**
     * Residuo del ajuste con su signo. Redondea ANTES de mirar el signo: sin
     * eso, un residuo de -1e-15 se imprimía como "-0.0 mm" y parecía un sesgo.
     */
    static formatearResiduo(residuoMM) {
        if (residuoMM === null) return '—';
        const redondeado = Math.round(residuoMM * 10) / 10 || 0;
        return `${redondeado > 0 ? '+' : ''}${redondeado.toFixed(1)} mm`;
    }

    static getTemplate() {
        return `
            <div class="configuration-container">
                <div class="row">
                    <div class="col-12 mb-3">
                        <h4 class="mb-1">
                            <i class="bi bi-gear me-2 text-primary"></i>
                            Configuración del Sistema
                        </h4>
                    </div>

                    <div class="col-12" id="config-container">
                        <div class="card shadow-sm border-0">
                            <div class="card-header bg-primary text-white py-2">
                                <h6 class="mb-0 small fw-bold">
                                    <i class="bi bi-sliders me-2"></i>Parámetros del Sistema
                                </h6>
                            </div>
                            <div class="card-body p-0">
                                <div class="config-scroll-wrapper p-4">
                                    <form id="configuration-form">
                                        <!-- Reportes -->
                                        <div class="row g-2 align-items-center mb-4">
                                            <div class="col-auto">
                                                <label class="form-label fw-bold small mb-0" style="min-width: 80px;">Reportes:</label>
                                            </div>
                                            <div class="col">
                                                <input type="text" class="form-control" id="config-report-path">
                                            </div>
                                        </div>

                                        <hr class="my-4 opacity-10">

                                        <!-- Límites de velocidad de las recetas -->
                                        <div class="row g-4 mb-2">
                                            <div class="col-md-6">
                                                <h6 class="text-primary fw-bold x-small mb-2">Vel. máx. transferencia Y (mm/s)</h6>
                                                <input type="number" step="0.1" min="0.1"
                                                       class="form-control" id="config-max-transfer-speed"
                                                       title="Máximo que se podrá pedir en una receta para el eje Y">
                                            </div>
                                            <div class="col-md-6">
                                                <h6 class="text-primary fw-bold x-small mb-2">Vel. máx. inmersión Z (mm/s)</h6>
                                                <input type="number" step="0.1" min="0.1"
                                                       class="form-control" id="config-max-dip-speed"
                                                       title="Máximo que se podrá pedir en una receta para el eje Z">
                                            </div>
                                        </div>
                                        <p class="text-muted x-small mb-4">
                                            Es el máximo que se puede pedir en una receta; la velocidad de emersión usa el mismo límite que la de
                                            inmersión. Por encima de ${ConfigurationScreen.VELOCIDAD_MECANICA_Y_MMS} mm/s en Y y de
                                            ${ConfigurationScreen.VELOCIDAD_MECANICA_Z_MMS} mm/s en Z el firmware recorta por su cuenta, porque es lo
                                            que dan los motores. La aceleración no se configura: la fija el firmware según lo que aguanta la mecánica.
                                        </p>

                                        <hr class="my-4 opacity-10">

                                        <!-- Offsets -->
                                        <div class="row g-4">
                                            <div class="col-md-4">
                                                <h6 class="text-primary fw-bold x-small mb-2">Offset Humedad (%)</h6>
                                                <input type="number" step="0.1" class="form-control" id="config-humidity-offset">
                                            </div>
                                            <div class="col-md-4">
                                                <h6 class="text-primary fw-bold x-small mb-2">Offset Temp. (°C)</h6>
                                                <input type="number" step="0.1" class="form-control" id="config-temperature-offset">
                                            </div>
                                            <div class="col-md-4">
                                                <h6 class="text-primary fw-bold x-small mb-2">Sync (seg)</h6>
                                                <input type="number" class="form-control" value="5" readonly disabled>
                                            </div>
                                        </div>
                                    </form>
                                </div>
                                
                                <div class="card-footer bg-light p-3 d-flex justify-content-end gap-2">
                                    <button class="btn btn-outline-secondary" type="button" id="reset-config-btn">
                                        Restablecer
                                    </button>
                                    <button class="btn btn-primary px-5" type="button" id="save-config-btn">
                                        Guardar Cambios
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Calibración del eje Z (solo administrador) -->
                    <div class="col-12 mt-3" id="calz-container">
                        <div class="card shadow-sm border-0">
                            <div class="card-header bg-dark text-white py-2 d-flex justify-content-between align-items-center">
                                <h6 class="mb-0 small fw-bold">
                                    <i class="bi bi-rulers me-2"></i>Calibración del Eje Z
                                </h6>
                                <button class="btn btn-sm btn-outline-light py-0" type="button" id="calz-factory-btn">
                                    Valores de fábrica
                                </button>
                            </div>
                            <div class="card-body p-4">

                                <div id="calz-status" class="alert alert-info py-2 px-3 small mb-3 d-none"></div>

                                <h6 class="text-primary fw-bold x-small mb-2">Calibración cargada en la máquina</h6>
                                <div class="row g-3 mb-4" id="calz-current">
                                    <div class="col-12 text-muted small">Leyendo...</div>
                                </div>

                                <hr class="my-4 opacity-10">

                                <h6 class="text-primary fw-bold x-small mb-1">Asistente de medición</h6>
                                <p class="text-muted small mb-3">
                                    Haz <strong>Home</strong>, mide la altura del sustrato sobre el suelo y regístrala.
                                    Después baja el eje y vuelve a medir, al menos tres veces. La escala sale de las
                                    <em>diferencias</em> entre medidas, así que no depende de acertar dónde está el cero.
                                </p>

                                <div class="row g-3 align-items-end mb-3">
                                    <div class="col-md-2">
                                        <button class="btn btn-outline-primary w-100" type="button" id="calz-home-btn">
                                            <i class="bi bi-house me-1"></i>Home
                                        </button>
                                    </div>
                                    <div class="col-md-3">
                                        <label class="form-label x-small text-muted mb-1">Tamaño de bajada (pasos)</label>
                                        <input type="number" class="form-control" id="calz-step-size" value="1000" min="1" step="100">
                                    </div>
                                    <div class="col-md-2">
                                        <button class="btn btn-outline-primary w-100" type="button" id="calz-down-btn">
                                            <i class="bi bi-arrow-down me-1"></i>Bajar
                                        </button>
                                    </div>
                                    <div class="col-md-3">
                                        <label class="form-label x-small text-muted mb-1">Altura medida (mm)</label>
                                        <input type="number" step="0.1" class="form-control" id="calz-measure-input" placeholder="p. ej. 225">
                                    </div>
                                    <div class="col-md-2">
                                        <button class="btn btn-primary w-100" type="button" id="calz-measure-btn">
                                            Registrar
                                        </button>
                                    </div>
                                </div>

                                <div class="row g-3">
                                    <div class="col-md-6">
                                        <div class="d-flex justify-content-between align-items-center mb-1">
                                            <span class="x-small text-muted" id="calz-accumulated">0 pasos desde home</span>
                                            <button class="btn btn-sm btn-link text-decoration-none py-0" type="button" id="calz-undo-btn">
                                                Quitar última
                                            </button>
                                        </div>
                                        <table class="table table-sm mb-0 border">
                                            <thead class="table-light">
                                                <tr>
                                                    <th class="x-small">Pasos</th>
                                                    <th class="x-small">Altura</th>
                                                    <th class="x-small">Desviación</th>
                                                </tr>
                                            </thead>
                                            <tbody id="calz-points">
                                                <tr><td colspan="3" class="text-muted small text-center py-3">Aún no hay medidas</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="border rounded p-3 h-100 bg-light" id="calz-result">
                                            <span class="text-muted small">Registra al menos dos medidas para calcular la escala.</span>
                                        </div>
                                    </div>
                                </div>

                                <hr class="my-4 opacity-10">

                                <div class="row g-3 align-items-end">
                                    <div class="col-md-3">
                                        <label class="form-label x-small text-muted mb-1">Altura mínima permitida (mm)</label>
                                        <input type="number" step="1" class="form-control" id="calz-min-height" value="25">
                                    </div>
                                    <div class="col-md-3">
                                        <button class="btn btn-warning w-100" type="button" id="calz-apply-btn" disabled>
                                            1. Aplicar (sin guardar)
                                        </button>
                                    </div>
                                    <div class="col-md-2">
                                        <label class="form-label x-small text-muted mb-1">Verificar a (mm)</label>
                                        <input type="number" step="0.1" class="form-control" id="calz-verify-height" value="150">
                                    </div>
                                    <div class="col-md-2">
                                        <button class="btn btn-outline-secondary w-100" type="button" id="calz-verify-btn">
                                            2. Mover y medir
                                        </button>
                                    </div>
                                    <div class="col-md-2">
                                        <button class="btn btn-success w-100" type="button" id="calz-save-btn">
                                            3. Guardar
                                        </button>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>

                    <!-- Geometría del eje Y (solo administrador) -->
                    <div class="col-12 mt-3" id="caly-container">
                        <div class="card shadow-sm border-0">
                            <div class="card-header bg-dark text-white py-2 d-flex justify-content-between align-items-center">
                                <h6 class="mb-0 small fw-bold">
                                    <i class="bi bi-arrows-collapse-vertical me-2"></i>Geometría del Eje Y (vasos)
                                </h6>
                                <button class="btn btn-sm btn-outline-light py-0" type="button" id="caly-factory-btn">
                                    Valores de fábrica
                                </button>
                            </div>
                            <div class="card-body p-4">

                                <div id="caly-status" class="alert alert-info py-2 px-3 small mb-3 d-none"></div>

                                <h6 class="text-primary fw-bold x-small mb-2">Geometría cargada en la máquina</h6>
                                <div class="row g-3 mb-4" id="caly-current">
                                    <div class="col-12 text-muted small">Leyendo...</div>
                                </div>

                                <hr class="my-4 opacity-10">

                                <h6 class="text-primary fw-bold x-small mb-1">Asistente de medición</h6>
                                <p class="text-muted small mb-3">
                                    Haz <strong>Home</strong>, mide con la regla la distancia hasta el sustrato y
                                    regístrala. Después mueve el eje y vuelve a medir, al menos tres veces. La escala
                                    sale de las <em>diferencias</em> entre medidas, así que no depende de acertar desde
                                    dónde mide la regla. Solo hay que rehacerla si se cambia la transmisión del eje.
                                </p>

                                <div class="row g-3 align-items-end mb-3">
                                    <div class="col-md-2">
                                        <button class="btn btn-outline-primary w-100" type="button" id="caly-home-btn">
                                            <i class="bi bi-house me-1"></i>Home
                                        </button>
                                    </div>
                                    <div class="col-md-3">
                                        <label class="form-label x-small text-muted mb-1">Tamaño del movimiento (pasos)</label>
                                        <input type="number" class="form-control" id="caly-step-size" value="1000" min="1" step="100">
                                    </div>
                                    <div class="col-md-2">
                                        <div class="btn-group w-100" role="group">
                                            <button class="btn btn-outline-primary" type="button" id="caly-back-btn" title="Acercar al home">
                                                <i class="bi bi-arrow-left"></i>
                                            </button>
                                            <button class="btn btn-outline-primary" type="button" id="caly-fwd-btn" title="Alejar del home">
                                                <i class="bi bi-arrow-right"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="col-md-3">
                                        <label class="form-label x-small text-muted mb-1">Distancia medida (mm)</label>
                                        <input type="number" step="0.1" class="form-control" id="caly-measure-input" placeholder="p. ej. 55">
                                    </div>
                                    <div class="col-md-2">
                                        <button class="btn btn-primary w-100" type="button" id="caly-measure-btn">
                                            Registrar
                                        </button>
                                    </div>
                                </div>

                                <div class="row g-3">
                                    <div class="col-md-6">
                                        <div class="d-flex justify-content-between align-items-center mb-1">
                                            <span class="x-small text-muted" id="caly-position">0 pasos desde home</span>
                                            <button class="btn btn-sm btn-link text-decoration-none py-0" type="button" id="caly-undo-btn">
                                                Quitar última
                                            </button>
                                        </div>
                                        <table class="table table-sm mb-0 border">
                                            <thead class="table-light">
                                                <tr>
                                                    <th class="x-small">Pasos</th>
                                                    <th class="x-small">Distancia</th>
                                                    <th class="x-small">Desviación</th>
                                                </tr>
                                            </thead>
                                            <tbody id="caly-points">
                                                <tr><td colspan="3" class="text-muted small text-center py-3">Aún no hay medidas</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="border rounded p-3 h-100 bg-light" id="caly-result">
                                            <span class="text-muted small">Registra al menos dos medidas para recalcular la escala.</span>
                                        </div>
                                    </div>
                                </div>

                                <hr class="my-4 opacity-10">

                                <h6 class="text-primary fw-bold x-small mb-1">Posición de los vasos</h6>
                                <p class="text-muted small mb-3">
                                    Escribe a cuántos mm del home crees que está el vaso y pulsa <strong>Ir</strong>:
                                    el eje se planta ahí y decides mirándolo. Si el sustrato no queda centrado, corrige
                                    el número o remátalo con los botones de movimiento de arriba. Cuando esté, pulsa
                                    <strong>Capturar</strong>: la posición se toma de los pasos reales del eje, sin
                                    regla de por medio. Cada vaso va por su cuenta, así que si se reubica uno se
                                    recaptura solo ese. El campo arranca con lo que ya está capturado, así que
                                    <strong>Ir</strong> sin tocar nada devuelve el eje a lo guardado.
                                </p>

                                <div class="row g-3">
                                    <div class="col-12 col-md-6">
                                        <div class="border rounded px-3 py-2">
                                            <div class="d-flex align-items-center justify-content-between mb-2">
                                                <span class="x-small text-muted fw-bold">VASO 1</span>
                                                <span class="small" id="caly-pos-1">sin capturar</span>
                                            </div>
                                            <div class="input-group input-group-sm">
                                                <input type="number" step="0.1" min="0" class="form-control" id="caly-goto-1" placeholder="mm desde el home">
                                                <span class="input-group-text">mm</span>
                                                <button class="btn btn-outline-secondary" type="button" data-caly-ir="0">Ir</button>
                                                <button class="btn btn-outline-primary" type="button" data-caly-capturar="0">Capturar</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6">
                                        <div class="border rounded px-3 py-2">
                                            <div class="d-flex align-items-center justify-content-between mb-2">
                                                <span class="x-small text-muted fw-bold">VASO 2</span>
                                                <span class="small" id="caly-pos-2">sin capturar</span>
                                            </div>
                                            <div class="input-group input-group-sm">
                                                <input type="number" step="0.1" min="0" class="form-control" id="caly-goto-2" placeholder="mm desde el home">
                                                <span class="input-group-text">mm</span>
                                                <button class="btn btn-outline-secondary" type="button" data-caly-ir="1">Ir</button>
                                                <button class="btn btn-outline-primary" type="button" data-caly-capturar="1">Capturar</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6">
                                        <div class="border rounded px-3 py-2">
                                            <div class="d-flex align-items-center justify-content-between mb-2">
                                                <span class="x-small text-muted fw-bold">VASO 3</span>
                                                <span class="small" id="caly-pos-3">sin capturar</span>
                                            </div>
                                            <div class="input-group input-group-sm">
                                                <input type="number" step="0.1" min="0" class="form-control" id="caly-goto-3" placeholder="mm desde el home">
                                                <span class="input-group-text">mm</span>
                                                <button class="btn btn-outline-secondary" type="button" data-caly-ir="2">Ir</button>
                                                <button class="btn btn-outline-primary" type="button" data-caly-capturar="2">Capturar</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6">
                                        <div class="border rounded px-3 py-2">
                                            <div class="d-flex align-items-center justify-content-between mb-2">
                                                <span class="x-small text-muted fw-bold">VASO 4</span>
                                                <span class="small" id="caly-pos-4">sin capturar</span>
                                            </div>
                                            <div class="input-group input-group-sm">
                                                <input type="number" step="0.1" min="0" class="form-control" id="caly-goto-4" placeholder="mm desde el home">
                                                <span class="input-group-text">mm</span>
                                                <button class="btn btn-outline-secondary" type="button" data-caly-ir="3">Ir</button>
                                                <button class="btn btn-outline-primary" type="button" data-caly-capturar="3">Capturar</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <hr class="my-4 opacity-10">

                                <div class="row g-3">
                                    <div class="col-md-6">
                                        <button class="btn btn-warning w-100" type="button" id="caly-apply-btn" disabled>
                                            1. Aplicar (sin guardar)
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btn btn-success w-100" type="button" id="caly-save-btn">
                                            2. Guardar
                                        </button>
                                    </div>
                                </div>

                                <div class="text-muted x-small mt-2" id="caly-limit"></div>

                            </div>
                        </div>
                    </div>

                </div>
            </div>
        `;
    }
}

window.ConfigurationScreen = ConfigurationScreen;
