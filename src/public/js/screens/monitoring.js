/**
 * Monitoring Screen - Monitoreo en tiempo real de variables del sistema SILAR
 * Equivale a las pantallas 6 y 7 del diseño original
 * Incluye las 46 variables documentadas del sistema
 */

class MonitoringScreen {
    constructor(app) {
        this.app = app;
        this.variables = {};
        this.charts = {};
        this.updateInterval = null;

        this.handleArduinoUpdate = this.handleArduinoUpdate.bind(this);

        this.init();
    }

    init() {
        this.bindEvents();
        this.startMonitoring();

        // Listen for Arduino data updates
        document.addEventListener('arduino-data-update', this.handleArduinoUpdate);
    }

    handleArduinoUpdate(e) {
        this.updateVariables(e.detail);
    }

    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        document.removeEventListener('arduino-data-update', this.handleArduinoUpdate);
    }

    bindEvents() {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target.closest('.filter-btn');
                const filter = target.getAttribute('data-filter');
                this.switchTab(filter, target);
            });
        });

        // Export data button
        document.getElementById('export-data-btn')?.addEventListener('click', () => {
            this.exportData();
        });

        // Emergency stop button
        document.getElementById('emergency-stop-btn')?.addEventListener('click', () => {
            this.emergencyStop();
        });
    }

    startMonitoring() {
        // Update display every 500ms
        this.updateInterval = setInterval(() => {
            this.updateDisplay();
        }, 500);
    }

    updateVariables(newData) {
        // Merge new data with existing variables
        this.variables = { ...this.variables, ...newData };

        // Add timestamp if not present
        if (!this.variables.lastUpdate) {
            this.variables.lastUpdate = new Date().toISOString();
        }
    }

    updateDisplay() {
        const variableCards = document.querySelectorAll('.variable-card-premium');

        variableCards.forEach(card => {
            const varName = card.getAttribute('data-variable');
            const valueElement = card.querySelector('.variable-value');
            const statusElement = card.querySelector('.variable-status');

            if (this.variables[varName] !== undefined) {
                const value = this.variables[varName];
                const formattedValue = this.formatValue(value, varName);

                if (valueElement) {
                    valueElement.textContent = formattedValue;
                }

                if (statusElement) {
                    statusElement.className = `variable-status ${this.getVariableStatus(varName, value)}`;
                }

                // Add update animation
                card.classList.add('updated');
                setTimeout(() => card.classList.remove('updated'), 200);
            }
        });

        // Update last update time
        const lastUpdateElement = document.getElementById('last-update-time');
        if (lastUpdateElement) {
            lastUpdateElement.textContent = new Date().toLocaleTimeString('es-ES');
        }
    }

    formatValue(value, varName) {
        if (typeof value === 'boolean') {
            return value ? 'Activo' : 'Inactivo';
        }

        if (typeof value === 'number') {
            // La unidad ya se pinta en el span .variable-unit de la tarjeta;
            // añadirla también aquí la duplicaba en pantalla ("25.5°C °C")
            if (varName === 'timeStamp') {
                return new Date(value).toLocaleTimeString('es-ES');
            }

            if (Number.isInteger(value)) {
                return String(value);
            }

            return value.toFixed(1);
        }

        return String(value);
    }

    getVariableStatus(varName, value) {
        // Define status rules based on variable type and value
        if (typeof value === 'boolean') {
            if (varName.includes('emergencia') || varName.includes('error')) {
                return value ? 'status-error' : 'status-ok';
            }
            return value ? 'status-active' : 'status-inactive';
        }

        if (typeof value === 'number') {
            // Temperature monitoring
            if (varName.includes('Temp') || varName.includes('temp')) {
                if (value < 15 || value > 40) return 'status-warning';
                return 'status-ok';
            }

            // Humidity monitoring
            if (varName.includes('Humidity') || varName.includes('humidity')) {
                if (value < 30 || value > 70) return 'status-warning';
                return 'status-ok';
            }

            // Speed monitoring
            if (varName.includes('Speed') || varName.includes('Velocity')) {
                if (value < 10 || value > 200) return 'status-warning';
                return 'status-ok';
            }
        }

        return 'status-ok';
    }

    switchTab(filter, btn) {
        // Update active tab button
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update visibility of cards with animation
        const grid = document.getElementById('variables-grid');
        grid.style.opacity = '0';

        setTimeout(() => {
            const cards = document.querySelectorAll('.variable-card-premium');
            cards.forEach(card => {
                const category = card.getAttribute('data-category');
                if (filter === 'all' || category === filter) {
                    card.closest('.col-card').style.display = 'block';
                } else {
                    card.closest('.col-card').style.display = 'none';
                }
            });
            grid.style.opacity = '1';
        }, 200);
    }

    async exportData() {
        try {
            const data = {
                timestamp: new Date().toISOString(),
                variables: this.variables,
                systemStatus: this.app.systemStatus,
                userSession: this.app.userSession?.username || 'unknown'
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: 'application/json'
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `silar-data-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.app.showSuccess('Datos exportados correctamente');

        } catch (error) {
            this.app.showError('Error exportando los datos');
        }
    }

    async emergencyStop() {
        if (confirm('¿Está seguro que desea realizar una parada de emergencia?')) {
            try {
                await this.app.apiCall('/process/emergency-stop', {
                    method: 'POST'
                });

                this.app.sendArduinoCommand('EMERGENCY_STOP');
                this.app.showSuccess('Parada de emergencia ejecutada');

            } catch (error) {
                this.app.showError('Error ejecutando parada de emergencia');
            }
        }
    }

    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
    }

    static getTemplate() {
        return `
            <div class="row">
                <!-- Header -->
                <div class="col-12 mb-4">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h3 class="mb-1">
                                <i class="bi bi-graph-up me-2 text-primary"></i>
                                Monitoreo en Tiempo Real
                            </h3>
                            <p class="text-muted mb-0">
                                Variables del proceso SILAR - Control de deposición en tiempo real
                                <span class="badge bg-success ms-2">En Vivo</span>
                            </p>
                        </div>
                        <div class="d-flex gap-2">
                            <button class="btn btn-outline-primary" id="export-data-btn">
                                <i class="bi bi-download me-2"></i>Exportar Datos
                            </button>
                            <button class="btn btn-danger" id="emergency-stop-btn">
                                <i class="bi bi-stop-fill me-2"></i>Parada Emergencia
                            </button>
                        </div>
                    </div>
                <!-- Tabbed Navigation -->
                <div class="col-12 mb-4">
                    <div class="monitoring-tabs-container">
                        <div class="nav nav-pills custom-monitoring-tabs" id="monitoring-tabs">
                            <button class="nav-link active filter-btn" data-filter="all">
                                <i class="bi bi-grid-fill"></i><span>Todas</span>
                            </button>
                            <button class="nav-link filter-btn" data-filter="position">
                                <i class="bi bi-arrows-move"></i><span>Posición</span>
                            </button>
                            <button class="nav-link filter-btn" data-filter="speed">
                                <i class="bi bi-speedometer"></i><span>Velocidad</span>
                            </button>
                            <button class="nav-link filter-btn" data-filter="sensors">
                                <i class="bi bi-thermometer-half"></i><span>Sensores</span>
                            </button>
                            <button class="nav-link filter-btn" data-filter="process">
                                <i class="bi bi-cpu"></i><span>Proceso</span>
                            </button>
                            <button class="nav-link filter-btn" data-filter="safety">
                                <i class="bi bi-shield-lock"></i><span>Seguridad</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Variables Grid -->
                <div class="col-12">
                    <div class="monitoring-grid-wrapper">
                        <div class="row g-3" id="variables-grid" style="transition: all 0.3s ease;">
                            ${this.generateVariablesGrid()}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    static generateVariablesGrid() {
        // Variables based on the documentation provided
        const variables = [
            // Posición y Movimiento
            { name: 'dipStartPosition', label: 'Posición Inicial Z', unit: 'mm', category: 'position', description: 'Posición inicial Z con sustrato' },
            { name: 'dippingLength', label: 'Longitud de Inmersión', unit: 'mm', category: 'position', description: 'Longitud de inmersión de sustrato' },
            // travelY / setY* vienen del firmware en pasos del motor, no en mm
            { name: 'travelY', label: 'Posición Y', unit: 'pasos', category: 'position', description: 'Indicador de posición en Y' },
            { name: 'travelZ', label: 'Altura Z', unit: 'mm', category: 'position', description: 'Altura actual del portamuestras' },
            { name: 'setHomeX', label: 'Home X', unit: 'mm', category: 'position', description: 'Posición inicial para pruebas del eje X' },
            { name: 'setHomeY', label: 'Home Y', unit: 'pasos', category: 'position', description: 'Posición inicial para pruebas del eje Y' },
            { name: 'setY1', label: 'Posición Y1', unit: 'pasos', category: 'position', description: 'Posición deseada de Y1' },
            { name: 'setY2', label: 'Posición Y2', unit: 'pasos', category: 'position', description: 'Posición deseada de Y2' },
            { name: 'setY3', label: 'Posición Y3', unit: 'pasos', category: 'position', description: 'Posición deseada de Y3' },
            { name: 'setY4', label: 'Posición Y4', unit: 'pasos', category: 'position', description: 'Posición deseada de Y4' },

            // Velocidades y Tiempo
            // Estas dos van en mm/s, no en rpm: es la unidad en la que se escriben
            // en la receta y la que el firmware convierte a pasos del motor
            { name: 'transferSpeed', label: 'Velocidad Y', unit: 'mm/s', category: 'speed', description: 'Velocidad Y de transferencia entre vasos, también en el regreso al vaso 1' },
            { name: 'dipSpeed', label: 'Velocidad Z', unit: 'mm/s', category: 'speed', description: 'Velocidad Z de inmersión y de emersión del sustrato' },
            { name: 'setStir1', label: 'Velocidad Removedor 1', unit: 'rpm', category: 'speed', description: 'Velocidad del removedor en la parrilla 1' },
            { name: 'setStir2', label: 'Velocidad Removedor 2', unit: 'rpm', category: 'speed', description: 'Velocidad del removedor en la parrilla 2' },
            { name: 'setStir3', label: 'Velocidad Removedor 3', unit: 'rpm', category: 'speed', description: 'Velocidad del removedor en la parrilla 3' },
            { name: 'setStir4', label: 'Velocidad Removedor 4', unit: 'rpm', category: 'speed', description: 'Velocidad del removedor en la parrilla 4' },

            // Tiempos de Espera
            { name: 'dippingWait0', label: 'Tiempo Inmersión 1', unit: 'ms', category: 'process', description: 'Tiempo de inmersión 1' },
            { name: 'dippingWait1', label: 'Tiempo Inmersión 2', unit: 'ms', category: 'process', description: 'Tiempo de inmersión 2' },
            { name: 'dippingWait2', label: 'Tiempo Inmersión 3', unit: 'ms', category: 'process', description: 'Tiempo de inmersión 3' },
            { name: 'dippingWait3', label: 'Tiempo Inmersión 4', unit: 'ms', category: 'process', description: 'Tiempo de inmersión 4' },
            { name: 'transferWait', label: 'Tiempo Espera Y', unit: 'ms', category: 'process', description: 'Tiempo de espera para cambio de posición en Y' },

            // Sensores Ambientales y de Parrilla
            { name: 'envTemp', label: 'Temperatura Ambiental', unit: '°C', category: 'sensors', description: 'Registro de temperatura ambiental' },
            { name: 'envHumidity', label: 'Humedad Ambiental', unit: '%', category: 'sensors', description: 'Registro de humedad ambiental' },
            { name: 'setTemp1', label: 'Temperatura Parrilla 1', unit: '°C', category: 'sensors', description: 'Configurar temperatura deseada en la parrilla 1' },
            { name: 'setTemp2', label: 'Temperatura Parrilla 2', unit: '°C', category: 'sensors', description: 'Configurar temperatura deseada en la parrilla 2' },
            { name: 'setTemp3', label: 'Temperatura Parrilla 3', unit: '°C', category: 'sensors', description: 'Configurar temperatura deseada en la parrilla 3' },
            { name: 'setTemp4', label: 'Temperatura Parrilla 4', unit: '°C', category: 'sensors', description: 'Configurar temperatura deseada en la parrilla 4' },
            { name: 'measTemp1', label: 'Lectura Temp. Sol. 1', unit: '°C', category: 'sensors', description: 'Lectura de temperatura de la solución 1' },
            { name: 'measTemp2', label: 'Lectura Temp. Sol. 2', unit: '°C', category: 'sensors', description: 'Lectura de temperatura de la solución 2' },
            { name: 'measTemp3', label: 'Lectura Temp. Sol. 3', unit: '°C', category: 'sensors', description: 'Lectura de temperatura de la solución 3' },
            { name: 'measTemp4', label: 'Lectura Temp. Sol. 4', unit: '°C', category: 'sensors', description: 'Lectura de temperatura de la solución 4' },

            // Control de Proceso
            { name: 'cycles', label: 'Ciclos Restantes', unit: '', category: 'process', description: 'Cantidad de ciclos por prueba' },
            { name: 'cycleCount', label: 'Contador Ciclos', unit: '', category: 'process', description: 'Contador de ciclos durante la prueba' },
            { name: 'stage', label: 'Etapa', unit: '', category: 'process', description: 'Etapa en curso de una receta por etapas (n/N)' },
            { name: 'timeStamp', label: 'Última Lectura', unit: '', category: 'process', description: 'Hora de la última trama recibida del Arduino' },
            { name: 'fan', label: 'Ventilador', unit: '', category: 'process', description: 'Ventilador encendido/apagado' },
            { name: 'lamp', label: 'Lámpara', unit: '', category: 'process', description: 'Lámpara encendida/apagada' },
            { name: 'exceptDripping1', label: 'Excluir Inmersión Y1', unit: '', category: 'process', description: 'Excluir inmersión en Y1' },
            { name: 'exceptDripping2', label: 'Excluir Inmersión Y2', unit: '', category: 'process', description: 'Excluir inmersión en Y2' },
            { name: 'exceptDripping3', label: 'Excluir Inmersión Y3', unit: '', category: 'process', description: 'Excluir inmersión en Y3' },
            { name: 'exceptDripping4', label: 'Excluir Inmersión Y4', unit: '', category: 'process', description: 'Excluir inmersión en Y4' },

            // Sensores de Seguridad
            { name: 'doorOpen', label: 'Puerta Abierta', unit: '', category: 'safety', description: 'Registro de estado de la puerta durante la prueba' },
            { name: 'inicioCarreraX', label: 'Sensor Inicio X', unit: '', category: 'safety', description: 'Sensor de inicio de carrera en X' },
            { name: 'finCarreraY', label: 'Sensor Fin Y', unit: '', category: 'safety', description: 'Sensor de fin de carrera en Y' },
            { name: 'inicioCarreraZ', label: 'Sensor Inicio Z', unit: '', category: 'safety', description: 'Sensor de inicio de carrera en Z' },
            { name: 'finCarreraZ', label: 'Sensor Fin Z', unit: '', category: 'safety', description: 'Sensor de fin de carrera en Z' },
            { name: 'pardEmergencia', label: 'Parada Emergencia', unit: '', category: 'safety', description: 'Botón físico para detener el sistema en caso de emergencia' },

            // Control de Ciclos
            { name: 'pauseCycle', label: 'Pausar Ciclo', unit: '', category: 'process', description: 'Botón en la UI para pausar el ciclo' },
            { name: 'restartCycle', label: 'Reiniciar Ciclo', unit: '', category: 'process', description: 'Botón en la UI para reiniciar el ciclo después de una pausa' }
        ];

        return variables.map(variable => `
            <div class="col-xl-3 col-lg-4 col-md-6 col-card">
                <div class="variable-card-premium card h-100" data-variable="${variable.name}" data-category="${variable.category}">
                    <div class="card-body p-3">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <div class="category-tag">
                                <i class="bi ${MonitoringScreen.getCategoryIcon(variable.category)}"></i>
                                <span>${variable.category}</span>
                            </div>
                            <div class="status-dot status-ok"></div>
                        </div>
                        
                        <div class="variable-info">
                            <h6 class="variable-label" title="${variable.description}">${variable.label}</h6>
                            <div class="variable-value-container">
                                <span class="variable-value">--</span>
                                <span class="variable-unit">${variable.unit || ''}</span>
                            </div>
                        </div>
                        
                        <div class="variable-footer">
                            <p class="variable-desc">${variable.description}</p>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    static getCategoryIcon(category) {
        const icons = {
            'position': 'bi-arrows-move',
            'speed': 'bi-speedometer',
            'sensors': 'bi-thermometer-half',
            'process': 'bi-cpu',
            'safety': 'bi-shield-lock'
        };
        return icons[category] || 'bi-gear';
    }
}

// Register the screen globally
window.MonitoringScreen = MonitoringScreen;
