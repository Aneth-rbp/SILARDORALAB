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
        this.init();
    }

    init() {
        this.bindEvents();
        this.startMonitoring();
        
        // Listen for Arduino data updates
        document.addEventListener('arduino-data-update', (e) => {
            this.updateVariables(e.detail);
        });
    }

    bindEvents() {
        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filter = e.target.getAttribute('data-filter');
                this.filterVariables(filter);
                
                // Update active button
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
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
        const variableCards = document.querySelectorAll('.variable-monitor-card');
        
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
            // Format based on variable type
            if (varName.includes('Temp') || varName.includes('temp')) {
                return `${value.toFixed(1)}°C`;
            }
            if (varName.includes('Humidity') || varName.includes('humidity')) {
                return `${value.toFixed(1)}%`;
            }
            if (varName.includes('Speed') || varName.includes('Velocity')) {
                return `${value.toFixed(1)} rpm`;
            }
            if (varName.includes('Position') || varName.includes('Length')) {
                return `${value.toFixed(1)} mm`;
            }
            if (varName.includes('Wait') || varName.includes('Time')) {
                return `${value} ms`;
            }
            if (varName.includes('cycles') || varName.includes('Count')) {
                return `${Math.floor(value)}`;
            }
            
            return value.toFixed(2);
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

    filterVariables(filter) {
        const cards = document.querySelectorAll('.variable-monitor-card');
        
        cards.forEach(card => {
            const category = card.getAttribute('data-category');
            
            if (filter === 'all' || category === filter) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
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
                </div>

                <!-- Status Summary -->
                <div class="col-12 mb-4">
                    <div class="card">
                        <div class="card-body">
                            <div class="row g-3">
                                <div class="col-md-3">
                                    <div class="d-flex align-items-center">
                                        <div class="status-indicator status-running me-2"></div>
                                        <div>
                                            <div class="fw-bold">Sistema Activo</div>
                                            <small class="text-muted">Estado operacional</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="d-flex align-items-center">
                                        <i class="bi bi-clock text-primary me-2 fs-5"></i>
                                        <div>
                                            <div class="fw-bold" id="last-update-time">--:--:--</div>
                                            <small class="text-muted">Última actualización</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="d-flex align-items-center">
                                        <i class="bi bi-thermometer text-warning me-2 fs-5"></i>
                                        <div>
                                            <div class="fw-bold" id="env-temp-display">--°C</div>
                                            <small class="text-muted">Temperatura ambiente</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="d-flex align-items-center">
                                        <i class="bi bi-droplet text-info me-2 fs-5"></i>
                                        <div>
                                            <div class="fw-bold" id="env-humidity-display">--%</div>
                                            <small class="text-muted">Humedad ambiente</small>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Filter Buttons -->
                <div class="col-12 mb-4">
                    <div class="card">
                        <div class="card-body">
                            <h6 class="card-title mb-3">
                                <i class="bi bi-funnel me-2"></i>Filtrar Variables
                            </h6>
                            <div class="btn-group" role="group">
                                <button class="btn btn-outline-primary filter-btn active" data-filter="all">
                                    <i class="bi bi-list-ul me-1"></i>Todas
                                </button>
                                <button class="btn btn-outline-primary filter-btn" data-filter="position">
                                    <i class="bi bi-arrows-move me-1"></i>Posición
                                </button>
                                <button class="btn btn-outline-primary filter-btn" data-filter="speed">
                                    <i class="bi bi-speedometer me-1"></i>Velocidad
                                </button>
                                <button class="btn btn-outline-primary filter-btn" data-filter="sensors">
                                    <i class="bi bi-thermometer me-1"></i>Sensores
                                </button>
                                <button class="btn btn-outline-primary filter-btn" data-filter="process">
                                    <i class="bi bi-gear me-1"></i>Proceso
                                </button>
                                <button class="btn btn-outline-primary filter-btn" data-filter="safety">
                                    <i class="bi bi-shield me-1"></i>Seguridad
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Variables Grid -->
                <div class="col-12">
                    <div class="row g-3" id="variables-grid">
                        ${this.generateVariablesGrid()}
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
            { name: 'travelY', label: 'Posición Y', unit: 'mm', category: 'position', description: 'Indicador de posición en Y' },
            { name: 'setHomeX', label: 'Home X', unit: 'mm', category: 'position', description: 'Posición inicial para pruebas del eje X' },
            { name: 'setHomeY', label: 'Home Y', unit: 'mm', category: 'position', description: 'Posición inicial para pruebas del eje Y' },
            { name: 'setY1', label: 'Posición Y1', unit: 'mm', category: 'position', description: 'Posición deseada de Y1' },
            { name: 'setY2', label: 'Posición Y2', unit: 'mm', category: 'position', description: 'Posición deseada de Y2' },
            { name: 'setY3', label: 'Posición Y3', unit: 'mm', category: 'position', description: 'Posición deseada de Y3' },
            { name: 'setY4', label: 'Posición Y4', unit: 'mm', category: 'position', description: 'Posición deseada de Y4' },

            // Velocidades y Tiempo
            { name: 'transferSpeed', label: 'Velocidad Y', unit: 'rpm', category: 'speed', description: 'Velocidad Y cambio de posición' },
            { name: 'dipSpeed', label: 'Velocidad Z', unit: 'rpm', category: 'speed', description: 'Velocidad Z inmersión sustrato a solución' },
            // Variables Pendiente (COMENTADAS - No implementadas aún)
            // { name: 'setStir1', label: 'Velocidad Removedor 1', unit: 'rpm', category: 'speed', description: '*Pendiente* Velocidad del removedor en la parrilla 1' },
            // { name: 'setStir2', label: 'Velocidad Removedor 2', unit: 'rpm', category: 'speed', description: '*Pendiente* Velocidad del removedor en la parrilla 2' },
            // { name: 'setStir3', label: 'Velocidad Removedor 3', unit: 'rpm', category: 'speed', description: '*Pendiente* Velocidad del removedor en la parrilla 3' },
            // { name: 'setStir4', label: 'Velocidad Removedor 4', unit: 'rpm', category: 'speed', description: '*Pendiente* Velocidad del removedor en la parrilla 4' },

            // Tiempos de Espera
            { name: 'dippingWait0', label: 'Tiempo Inmersión 1', unit: 'ms', category: 'process', description: 'Tiempo de inmersión 1' },
            { name: 'dippingWait1', label: 'Tiempo Inmersión 2', unit: 'ms', category: 'process', description: 'Tiempo de inmersión 2' },
            { name: 'dippingWait2', label: 'Tiempo Inmersión 3', unit: 'ms', category: 'process', description: 'Tiempo de inmersión 3' },
            { name: 'dippingWait3', label: 'Tiempo Inmersión 4', unit: 'ms', category: 'process', description: 'Tiempo de inmersión 4' },
            { name: 'transferWait', label: 'Tiempo Espera Y', unit: 'ms', category: 'process', description: 'Tiempo de espera para cambio de posición en Y' },

            // Sensores Ambientales
            { name: 'envTemp', label: 'Temperatura Ambiental', unit: '°C', category: 'sensors', description: 'Registro de temperatura ambiental' },
            { name: 'envHumidity', label: 'Humedad Ambiental', unit: '%', category: 'sensors', description: 'Registro de humedad ambiental' },
            // Variables Pendiente (COMENTADAS - No implementadas aún)
            // { name: 'setTemp1', label: 'Temperatura Parrilla 1', unit: '°C', category: 'sensors', description: '*Pendiente* Configurar temperatura deseada en la parrilla 1' },
            // { name: 'setTemp2', label: 'Temperatura Parrilla 2', unit: '°C', category: 'sensors', description: '*Pendiente* Configurar temperatura deseada en la parrilla 2' },
            // { name: 'setTemp3', label: 'Temperatura Parrilla 3', unit: '°C', category: 'sensors', description: '*Pendiente* Configurar temperatura deseada en la parrilla 3' },
            // { name: 'setTemp4', label: 'Temperatura Parrilla 4', unit: '°C', category: 'sensors', description: '*Pendiente* Configurar temperatura deseada en la parrilla 4' },
            // { name: 'setStirr1', label: 'Velocidad Removedor Parrilla 1', unit: 'rpm', category: 'sensors', description: '*Pendiente* Configurar la velocidad del removedor en la parrilla 1' },
            // { name: 'setStirr2', label: 'Velocidad Removedor Parrilla 2', unit: 'rpm', category: 'sensors', description: '*Pendiente* Configurar la velocidad del removedor en la parrilla 2' },
            // { name: 'setStirr3', label: 'Velocidad Removedor Parrilla 3', unit: 'rpm', category: 'sensors', description: '*Pendiente* Configurar la velocidad del removedor en la parrilla 3' },
            // { name: 'setStirr4', label: 'Velocidad Removedor Parrilla 4', unit: 'rpm', category: 'sensors', description: '*Pendiente* Configurar la velocidad del removedor en la parrilla 4' },
            // { name: 'measTemp1', label: 'Lectura Temp. Sol. 1', unit: '°C', category: 'sensors', description: '*Pendiente* Lectura de temperatura de la solución 1' },
            // { name: 'measTemp2', label: 'Lectura Temp. Sol. 2', unit: '°C', category: 'sensors', description: '*Pendiente* Lectura de temperatura de la solución 2' },
            // { name: 'measTemp3', label: 'Lectura Temp. Sol. 3', unit: '°C', category: 'sensors', description: '*Pendiente* Lectura de temperatura de la solución 3' },
            // { name: 'measTemp4', label: 'Lectura Temp. Sol. 4', unit: '°C', category: 'sensors', description: '*Pendiente* Lectura de temperatura de la solución 4' },

            // Control de Proceso
            { name: 'cycles', label: 'Ciclos Restantes', unit: '', category: 'process', description: 'Cantidad de ciclos por prueba' },
            { name: 'cycleCount', label: 'Contador Ciclos', unit: '', category: 'process', description: 'Contador de ciclos durante la prueba' },
            { name: 'timeStamp', label: 'Tiempo Global', unit: 'ms', category: 'process', description: 'Registro de tiempo global en el sistema' },
            { name: 'userId', label: 'ID Usuario', unit: '', category: 'process', description: 'Código de identificación de usuario utilizado para reactivar la información generada en el equipo durante su sesión' },

            // Estado de Ventilador y Excepciones
            { name: 'fan', label: 'Ventilador', unit: '', category: 'process', description: 'Ventilador encendido/apagado' },
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
            { name: 'pauseCycle', label: 'Pausar Ciclo', unit: '', category: 'process', description: 'Botón en la UI para pausar el ciclo. Se puede reiniciar donde se quedó' },
            { name: 'restartCycle', label: 'Reiniciar Ciclo', unit: '', category: 'process', description: 'Botón en la UI para reiniciar el ciclo después de una pausa' }
        ];

        return variables.map(variable => `
            <div class="col-lg-3 col-md-4 col-sm-6">
                <div class="variable-monitor-card card" data-variable="${variable.name}" data-category="${variable.category}">
                    <div class="card-body p-3">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div class="variable-status status-ok"></div>
                            <span class="badge bg-light text-dark">${variable.category}</span>
                        </div>
                        <h6 class="card-title text-truncate mb-1" title="${variable.label}">
                            ${variable.label}
                        </h6>
                        <div class="variable-value h5 mb-1 text-primary">--</div>
                        <small class="text-muted d-block text-truncate" title="${variable.description}">
                            ${variable.description}
                        </small>
                    </div>
                </div>
            </div>
        `).join('');
    }
}

// Register the screen globally
window.MonitoringScreen = MonitoringScreen;
