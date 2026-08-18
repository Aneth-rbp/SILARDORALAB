/**
 * Configuration Screen - Configuración del sistema SILAR
 * Equivale a las pantallas 7 del diseño original
 * Solo administradores pueden modificar la configuración
 */

class ConfigurationScreen {
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

        // Estado de la geometría del eje Y: separación entre vasos y escala.
        this.calY = {
            calibracion: null,
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
            if (e.target.closest('#caly-apply-btn')) this.calYAplicar();
            if (e.target.closest('#caly-save-btn')) this.calYGuardar();
            if (e.target.closest('#caly-factory-btn')) this.calYRestaurarFabrica();
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
            'config-max-velocity-y': this.config.max_velocity_y || 1000,
            'config-max-velocity-z': this.config.max_velocity_z || 1000,
            'config-max-accel-y': this.config.max_accel_y || 100,
            'config-max-accel-z': this.config.max_accel_z || 100,
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
        const calzContainer = document.getElementById('calz-container');
        if (calzContainer && !this.isAdmin) {
            calzContainer.classList.add('d-none');
        }
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

        const configToSave = {
            report_path: document.getElementById('config-report-path')?.value || '',
            max_velocity_y: parseFloat(document.getElementById('config-max-velocity-y')?.value) || 0,
            max_velocity_z: parseFloat(document.getElementById('config-max-velocity-z')?.value) || 0,
            max_accel_y: parseFloat(document.getElementById('config-max-accel-y')?.value) || 0,
            max_accel_z: parseFloat(document.getElementById('config-max-accel-z')?.value) || 0,
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

    resetConfiguration() {
        if (!this.isAdmin) return;
        if (confirm('¿Está seguro que desea restablecer los cambios?')) {
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
        const cm = parseFloat(campo?.value);
        if (!Number.isFinite(cm) || cm <= 0) {
            this.calZEstado('Escribe la altura medida en cm', 'warning');
            return;
        }

        const yaMedido = this.calZ.puntos.find(p => p.pasos === this.calZ.pasosAcumulados);
        if (yaMedido) {
            yaMedido.alturaMM = cm * 10;
        } else {
            this.calZ.puntos.push({ pasos: this.calZ.pasosAcumulados, alturaMM: cm * 10 });
            this.calZ.puntos.sort((a, b) => a.pasos - b.pasos);
        }

        if (campo) campo.value = '';
        this.calZ.ajuste = this.calZAjustar();
        this.calZEstado(`Punto registrado: ${this.calZ.pasosAcumulados} pasos → ${cm.toFixed(1)} cm`, 'success');
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

        const cm = parseFloat(document.getElementById('calz-verify-height')?.value);
        if (!Number.isFinite(cm) || cm <= 0) {
            this.calZEstado('Escribe la altura de verificación en cm', 'warning');
            return;
        }

        this.calZOcupado(true, `Moviendo el eje a ${cm.toFixed(1)} cm...`);
        try {
            const respuesta = await this.calZApi('/goto', {
                method: 'POST',
                body: JSON.stringify({ heightMm: cm * 10 })
            });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calZEstado(`Movimiento terminado. Mide con la regla: debe dar ${cm.toFixed(1)} cm exactos.`, 'info');
        } catch (error) {
            this.calZEstado(`Error moviendo el eje: ${error.message}`, 'danger');
        } finally {
            this.calZOcupado(false);
        }
    }

    async calZGuardar() {
        if (!this.isAdmin || this.calZ.ocupado) return;

        if (!confirm('¿Guardar esta calibración en la memoria de la máquina?\n\nSustituye a la anterior y se usará en todas las recetas.')) {
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

        if (!confirm('¿Restaurar la calibración de fábrica?\n\nSe pierde la calibración guardada actualmente.')) {
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
                    <div class="col-6 col-md-3"><span class="text-muted x-small d-block">Altura en home</span><strong>${(cal.homeHeightMm / 10).toFixed(1)} cm</strong></div>
                    <div class="col-6 col-md-3"><span class="text-muted x-small d-block">Altura mínima</span><strong>${(cal.minHeightMm / 10).toFixed(1)} cm</strong></div>
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
                            <td>${(p.alturaMM / 10).toFixed(1)} cm</td>
                            <td class="${fuera ? 'fw-bold' : 'text-muted'}">${residuo === null ? '—' : `${residuo >= 0 ? '+' : ''}${residuo.toFixed(1)} mm`}</td>
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
                        <div class="col-6"><span class="text-muted x-small d-block">Altura en home calculada</span><strong class="fs-5">${(ajuste.alturaHomeMM / 10).toFixed(1)} cm</strong></div>
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
    // Dos valores independientes que antes estaban clavados en el firmware:
    //
    //   - Posición de cada vaso: dónde para el eje para cada uno de los cuatro,
    //     medido desde el home. Van una a una y no como una separación única
    //     porque los vasos no tienen por qué estar igualmente espaciados; en
    //     cuanto se reubica uno, una separación deja de describir el banco.
    //   - Pasos por mm: la mecánica del eje. Solo se toca si se cambia la
    //     transmisión, y de ella depende que transferSpeed en mm/s signifique
    //     lo que dice (y cuál es la velocidad máxima del eje).
    //
    // No hay asistente de medición como en Z: aquí basta con medir con la regla
    // desde el home hasta el centro de cada vaso, porque el firmware ya sabe
    // cuántos pasos por mm da el eje.
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

    calYEstado(mensaje, tipo = 'info') {
        const caja = document.getElementById('caly-status');
        if (!caja) return;
        caja.className = `alert alert-${tipo} py-2 px-3 small mb-3`;
        caja.textContent = mensaje;
        caja.classList.remove('d-none');
    }

    calYOcupado(ocupado, mensaje) {
        this.calY.ocupado = ocupado;
        ['caly-apply-btn', 'caly-save-btn', 'caly-factory-btn'].forEach((id) => {
            const boton = document.getElementById(id);
            if (boton) boton.disabled = ocupado;
        });
        if (ocupado && mensaje) this.calYEstado(mensaje, 'info');
    }

    async calYAplicar() {
        if (!this.isAdmin || this.calY.ocupado) return;

        const pasosPorMM = parseFloat(document.getElementById('caly-steps-per-mm')?.value);

        // El vaso 1 puede quedarse en 0 (el home), así que aquí solo se exige
        // que sea un número y no negativo. Que quepa en el eje lo comprueba el
        // firmware, que es quien conoce el final de carrera.
        const posiciones = [];
        for (let i = 1; i <= 4; i++) {
            const mm = parseFloat(document.getElementById(`caly-pos-${i}`)?.value);
            if (!Number.isFinite(mm) || mm < 0) {
                this.calYEstado(`Escribe la posición del vaso ${i} en mm (desde el home)`, 'warning');
                return;
            }
            posiciones.push(Number(mm.toFixed(2)));
        }

        if (!Number.isFinite(pasosPorMM) || pasosPorMM <= 0) {
            this.calYEstado('Escribe los pasos por mm del eje', 'warning');
            return;
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
            this.calYEstado('Geometría aplicada en memoria. Lanza un home y comprueba que el eje para centrado en cada vaso antes de guardar.', 'success');
        } catch (error) {
            this.calYEstado(`Error aplicando la geometría: ${error.message}`, 'danger');
        } finally {
            this.calYOcupado(false);
            this.renderYCalibration();
        }
    }

    async calYGuardar() {
        if (!this.isAdmin || this.calY.ocupado) return;

        if (!confirm('¿Guardar esta geometría en la memoria de la máquina?\n\nSustituye a la anterior y se usará en todas las recetas.')) {
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

        if (!confirm('¿Restaurar la geometría de fábrica?\n\nVuelve a los vasos en 0 / 55 / 110 / 165 mm y se pierde la guardada actualmente.')) {
            return;
        }

        this.calYOcupado(true, 'Restaurando valores de fábrica...');
        try {
            const respuesta = await this.calYApi('/reset', { method: 'POST' });
            if (!respuesta.success) throw new Error(respuesta.message);

            this.calY.calibracion = respuesta.calibration;
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

        // Los campos se rellenan con lo que hay en la máquina, no con un valor
        // fijo: así el operador ve de dónde parte antes de tocar nada.
        if (cal) {
            cal.vesselPositionsMm.forEach((mm, i) => {
                const campo = document.getElementById(`caly-pos-${i + 1}`);
                if (campo && document.activeElement !== campo) campo.value = mm.toFixed(1);
            });
            const pasos = document.getElementById('caly-steps-per-mm');
            if (pasos && document.activeElement !== pasos) {
                pasos.value = cal.stepsPerMm.toFixed(4);
            }
        }

        // Hasta dónde llega el eje con la escala actual. Pasarse es el error más
        // fácil de cometer aquí, y el firmware rechaza el conjunto entero.
        const limite = document.getElementById('caly-limit');
        if (limite) {
            limite.textContent = cal && cal.axisLimitSteps && cal.stepsPerMm
                ? `Con esta escala, ningún vaso puede pasar de ${(cal.axisLimitSteps / cal.stepsPerMm).toFixed(1)} mm (final de carrera).`
                : '';
        }

        const aplicar = document.getElementById('caly-apply-btn');
        if (aplicar) aplicar.disabled = !this.isAdmin || this.calY.ocupado;
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

                                        <!-- Velocidades y Aceleraciones -->
                                        <div class="row g-4 mb-4">
                                            <div class="col-md-3">
                                                <h6 class="text-primary fw-bold x-small mb-2">Vel. Y (rpm)</h6>
                                                <input type="number" class="form-control" id="config-max-velocity-y">
                                            </div>
                                            <div class="col-md-3">
                                                <h6 class="text-primary fw-bold x-small mb-2">Vel. Z (rpm)</h6>
                                                <input type="number" class="form-control" id="config-max-velocity-z">
                                            </div>
                                            <div class="col-md-3">
                                                <h6 class="text-primary fw-bold x-small mb-2">Accel. Y (rpm/s)</h6>
                                                <input type="number" class="form-control" id="config-max-accel-y">
                                            </div>
                                            <div class="col-md-3">
                                                <h6 class="text-primary fw-bold x-small mb-2">Accel. Z (rpm/s)</h6>
                                                <input type="number" class="form-control" id="config-max-accel-z">
                                            </div>
                                        </div>

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
                                        <label class="form-label x-small text-muted mb-1">Altura medida (cm)</label>
                                        <input type="number" step="0.1" class="form-control" id="calz-measure-input" placeholder="p. ej. 22.5">
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
                                        <label class="form-label x-small text-muted mb-1">Verificar a (cm)</label>
                                        <input type="number" step="0.1" class="form-control" id="calz-verify-height" value="15">
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

                                <p class="text-muted small mb-3">
                                    Mide con la regla desde el <strong>home del eje Y</strong> hasta el centro de cada vaso.
                                    Cada vaso va por su cuenta, así que no hace falta que estén igualmente separados: si se
                                    reubica uno, se corrige solo ese. Los <em>pasos por mm</em> son la mecánica del eje y
                                    solo se tocan si se cambia la transmisión; de ellos depende que la velocidad de
                                    transferencia en mm/s de las recetas signifique lo que dice.
                                </p>

                                <div class="row g-3 align-items-end">
                                    <div class="col-6 col-md-3">
                                        <label class="form-label x-small text-muted mb-1">Vaso 1 (mm)</label>
                                        <input type="number" step="0.1" min="0" class="form-control" id="caly-pos-1" value="0">
                                    </div>
                                    <div class="col-6 col-md-3">
                                        <label class="form-label x-small text-muted mb-1">Vaso 2 (mm)</label>
                                        <input type="number" step="0.1" min="0" class="form-control" id="caly-pos-2" value="55">
                                    </div>
                                    <div class="col-6 col-md-3">
                                        <label class="form-label x-small text-muted mb-1">Vaso 3 (mm)</label>
                                        <input type="number" step="0.1" min="0" class="form-control" id="caly-pos-3" value="110">
                                    </div>
                                    <div class="col-6 col-md-3">
                                        <label class="form-label x-small text-muted mb-1">Vaso 4 (mm)</label>
                                        <input type="number" step="0.1" min="0" class="form-control" id="caly-pos-4" value="165">
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label x-small text-muted mb-1">Pasos por mm del eje</label>
                                        <input type="number" step="0.0001" min="1" class="form-control" id="caly-steps-per-mm" value="76.3636">
                                    </div>
                                    <div class="col-md-4">
                                        <button class="btn btn-warning w-100" type="button" id="caly-apply-btn">
                                            1. Aplicar (sin guardar)
                                        </button>
                                    </div>
                                    <div class="col-md-4">
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
