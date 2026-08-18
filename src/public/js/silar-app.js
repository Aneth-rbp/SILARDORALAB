/**
 * SILAR System - Main Application
 * Maneja la navegación, comunicación con el backend y estado global
 */

class SilarApp {
    constructor() {
        this.socket = null;
        this.currentScreen = 'dashboard';
        this.userSession = null;
        this.isDemoMode = false;
        this.dashboardLoaded = false;
        this.systemStatus = {
            arduino: false,
            database: false,
            processRunning: false
        };
        this.processData = {
            currentRecipe: null,
            startTime: null,
            elapsedTime: 0,
            variables: {}
        };
        this.activeScreenInstance = null; // Instancia de la pantalla activa
        
        // Check authentication first
        if (!this.checkAuthentication()) {
            return;
        }
        
        this.init();
    }

    checkAuthentication() {
        const sessionData = localStorage.getItem('silar_user_session');
        
        if (!sessionData) {
            // No session found, redirect to login
            window.location.href = 'login.html';
            return false;
        }
        
        try {
            this.userSession = JSON.parse(sessionData);
            this.isDemoMode = this.userSession.isDemoMode || false;
            
            // Update page title with user info
            document.title = `SILAR System - ${this.userSession.username}`;
            
            return true;
        } catch (error) {
            console.error('Invalid session data');
            localStorage.removeItem('silar_user_session');
            window.location.href = 'login.html';
            return false;
        }
    }

    async init() {
        // Initialize demo data if in demo mode
        if (this.isDemoMode) {
            this.initDemoMode();
        }
        
        this.initSocket();
        this.initEventListeners();
        this.initLogoutModal();
        this.initClock();
        this.initUserInterface();
        this.checkSystemStatus();
        
        // Bind events for navigation
        this.bindEvents();
        
        this.loadDashboard();
        
        // Verificar estado cada 30 segundos
        setInterval(() => this.checkSystemStatus(), 30000);
        
        // Update demo variables if in demo mode
        if (this.isDemoMode) {
            setInterval(() => this.updateDemoVariables(), 2000);
        }
    }

    initDemoMode() {
        // Simulate Arduino connection
        this.systemStatus.arduino = true;
        this.systemStatus.database = true;
        
        // Initialize demo variables
        this.demoVariables = {
            dipStartPosition: 50.5,
            dippingLength: 120.3,
            transferSpeed: 85.2,
            dipSpeed: 75.8,
            dippingWait0: 1500,
            dippingWait1: 2000,
            dippingWait2: 1800,
            dippingWait3: 2200,
            transferWait: 500,
            cycles: 15,
            fan: true,
            exceptDripping1: false,
            exceptDripping2: true,
            exceptDripping3: false,
            exceptDripping4: false,
            envTemp: 23.5,
            envHumidity: 45.2,
            timeStamp: Date.now(),
            cycleCount: 3,
            travelY: 150.8,
            doorOpen: false,
            inicioCarreraX: false,
            finCarreraY: true,
            inicioCarreraZ: false,
            finCarreraZ: true,
            pardEmergencia: false,
            pauseCycle: false,
            restartCycle: false
        };
    }

    updateDemoVariables() {
        if (!this.isDemoMode) return;
        
        // Simulate changing values
        this.demoVariables.envTemp += (Math.random() - 0.5) * 0.2;
        this.demoVariables.envHumidity += (Math.random() - 0.5) * 0.5;
        this.demoVariables.dipStartPosition += (Math.random() - 0.5) * 0.1;
        this.demoVariables.transferSpeed += (Math.random() - 0.5) * 0.5;
        this.demoVariables.dipSpeed += (Math.random() - 0.5) * 0.3;
        this.demoVariables.timeStamp = Date.now();
        
        // Simulate cycle progression
        if (Math.random() < 0.1) {
            this.demoVariables.cycles = Math.max(0, this.demoVariables.cycles - 1);
            this.demoVariables.cycleCount++;
        }
        
        // Emit demo data
        document.dispatchEvent(new CustomEvent('arduino-data-update', {
            detail: this.demoVariables
        }));
    }

    initUserInterface() {
        // Update user info in header
        this.updateUserInfo();
        
        // Add logout button
        const navContainer = document.querySelector('.navbar .container-fluid .d-flex');
        if (navContainer) {
            const logoutBtn = document.createElement('button');
            logoutBtn.className = 'btn btn-outline-light btn-sm ms-3';
            logoutBtn.innerHTML = '<i class="bi bi-box-arrow-right"></i>';
            logoutBtn.title = 'Cerrar Sesión';
            logoutBtn.onclick = () => this.logout();
            navContainer.appendChild(logoutBtn);
        }
    }

    updateUserInfo() {
        if (this.userSession) {
            // Update user name
            const userNameElement = document.getElementById('user-name');
            if (userNameElement) {
                userNameElement.textContent = this.userSession.fullName || this.userSession.username || 'Usuario';
            }
            
            // Update user role
            const userRoleElement = document.getElementById('user-role');
            if (userRoleElement) {
                const roleText = this.userSession.role === 'admin' ? 'Administrador' : 'Usuario';
                userRoleElement.textContent = roleText;
            }

            // Añadir botón de administración de usuarios al dropdown si es admin
            const userDropdown = document.getElementById('user-dropdown');
            if (userDropdown && this.userSession.role === 'admin') {
                // Verificar si ya existe el botón
                if (!document.getElementById('admin-users-link')) {
                    const adminLink = document.createElement('button');
                    adminLink.id = 'admin-users-link';
                    adminLink.className = 'dropdown-item';
                    adminLink.innerHTML = '<i class="bi bi-people me-2"></i>Administrar Usuarios';
                    adminLink.onclick = () => {
                        this.navigateToScreen('users');
                        document.getElementById('user-dropdown').classList.remove('show');
                    };
                    
                    // Insertar antes del divisor de cerrar sesión
                    const divider = userDropdown.querySelector('.dropdown-divider');
                    if (divider) {
                        userDropdown.insertBefore(adminLink, divider);
                    }
                }
            }
        }
    }

    logout() {
        // Obtener o crear la instancia del modal (Singleton)
        let modalElement = document.getElementById('logoutModal');
        let logoutModal = bootstrap.Modal.getInstance(modalElement);
        
        if (!logoutModal) {
            logoutModal = new bootstrap.Modal(modalElement, { focus: false });
        }
        
        logoutModal.show();
    }

    initLogoutModal() {
        const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
        if (confirmLogoutBtn) {
            confirmLogoutBtn.addEventListener('click', () => {
                this.confirmLogout();
            });
        }
    }

    confirmLogout() {
        const logoutModal = bootstrap.Modal.getInstance(document.getElementById('logoutModal'));
        if (logoutModal) {
            logoutModal.hide();
        }
        
        localStorage.removeItem('silar_user_session');
        window.location.href = 'login.html';
    }

    initSocket() {
        // Skip socket connection in demo mode
        if (this.isDemoMode) {
            return;
        }
        
        try {
            // Intentar conectar con configuración específica
            this.socket = io({
                transports: ['websocket', 'polling'],
                timeout: 20000,
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });
            
            this.socket.on('connect', () => {
                this.updateSystemStatus({ websocket: true });
                // Verificar estado inmediatamente al conectar
                this.checkSystemStatus();
            });

            this.socket.on('disconnect', (reason) => {
                this.updateSystemStatus({ websocket: false });
                
                if (!this.isDemoMode && reason !== 'io client disconnect') {
                    this.showError('Conexión perdida con el servidor. Intentando reconectar...');
                }
            });

            this.socket.on('connect_error', (error) => {
                this.updateSystemStatus({ websocket: false });
                
                if (!this.isDemoMode) {
                    this.showError('Error de conexión con el servidor');
                }
            });

            this.socket.on('arduino-data', (data) => {
                this.handleArduinoData(data);
            });

            this.socket.on('arduino-connected', (data) => {
                console.log('✅ Arduino conectado vía WebSocket:', data);
                this.updateSystemStatus({ arduino: true });
            });

            this.socket.on('arduino-disconnected', () => {
                console.log('❌ Arduino desconectado vía WebSocket');
                this.updateSystemStatus({ arduino: false });
            });

            this.socket.on('arduino-error', (error) => {
                console.error('❌ Error de Arduino vía WebSocket:', error);
                // No cambiar el estado a desconectado por errores de comando o límites
            });

            this.socket.on('process-update', (data) => {
                this.updateProcessData(data);
            });

            // Parámetros de la receta en curso: sus claves ya coinciden con los
            // data-variable de las tarjetas de monitoreo, así que se propagan
            // tal cual. El servidor los emite al iniciar un proceso y también
            // al conectarse un cliente, para que un F5 no vacíe las tarjetas.
            this.socket.on('process-parameters', (parameters) => {
                this.handleProcessParameters(parameters);
            });

            // Etapa en curso de una receta por etapas. El Arduino la anuncia al
            // entrar en cada etapa y el servidor la repite al conectarse un
            // cliente, así que recargar la pantalla a media corrida no deja al
            // operador sin saber por dónde va la secuencia. Llega null cuando el
            // proceso termina o se detiene.
            this.socket.on('process-stage', (etapa) => {
                this.handleProcessStage(etapa);
            });
        } catch (error) {
            this.updateSystemStatus({ websocket: false });
        }
    }

    initEventListeners() {
        // Navigation event listeners
        document.addEventListener('click', (e) => {
            if (e.target.matches('[data-screen]')) {
                e.preventDefault();
                const screen = e.target.getAttribute('data-screen');
                this.navigateToScreen(screen);
            }
        });

        // Global keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey) {
                switch(e.key) {
                    case '1':
                        e.preventDefault();
                        this.navigateToScreen('dashboard');
                        break;
                    case '2':
                        e.preventDefault();
                        this.navigateToScreen('recipes');
                        break;
                    case '3':
                        e.preventDefault();
                        this.navigateToScreen('process');
                        break;
                    case 'q':
                        e.preventDefault();
                        this.confirmExit();
                        break;
                }
            }
        });
    }

    initClock() {
        const updateClock = () => {
            const now = new Date();
            const timeString = now.toLocaleTimeString('es-ES', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const dateString = now.toLocaleDateString('es-ES', {
                weekday: 'short',
                day: 'numeric',
                month: 'short'
            });
            
            const clockElement = document.getElementById('system-clock');
            if (clockElement) {
                clockElement.innerHTML = `${timeString}<br><small>${dateString}</small>`;
            }
        };

        updateClock();
        setInterval(updateClock, 1000);
    }

    async checkSystemStatus() {
        try {
            const response = await fetch('/api/system/status', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const status = await response.json();
            console.log('✅ Estado del sistema:', status);
            
            this.updateSystemStatus(status);
        } catch (error) {
            console.error('❌ Error verificando estado del sistema:', error);
            this.updateSystemStatus({
                arduino: false,
                database: false,
                websocket: this.socket ? this.socket.connected : false
            });
            
            // En modo demo, simular conexión
            if (this.isDemoMode) {
                this.updateSystemStatus({
                    arduino: true,
                    database: true,
                    websocket: true
                });
            }
        }
    }

    updateSystemStatus(status) {
        this.systemStatus = { ...this.systemStatus, ...status };
        
        console.log('🔄 Actualizando estado del sistema:', this.systemStatus);
        
        // Update status indicators
        const arduinoStatus = document.getElementById('arduino-status');
        const dbStatus = document.getElementById('db-status');
        
        if (arduinoStatus) {
            // Usar el estado combinado, no solo el parámetro
            const isConnected = this.systemStatus.arduino || this.isDemoMode;
            arduinoStatus.className = `status-button ${isConnected ? 'arduino-btn connected' : 'arduino-btn disconnected'}`;
            arduinoStatus.innerHTML = `<i class="bi bi-usb"></i> Arduino`;
            arduinoStatus.title = `Arduino: ${isConnected ? 'Conectado' : 'Desconectado'}`;
        }
        
        if (dbStatus) {
            // Usar el estado combinado, no solo el parámetro
            const isConnected = this.systemStatus.database || this.isDemoMode;
            dbStatus.className = `status-button ${isConnected ? 'mysql-btn connected' : 'mysql-btn disconnected'}`;
            dbStatus.innerHTML = `<i class="bi bi-database"></i> MySQL`;
            dbStatus.title = `MySQL: ${isConnected ? 'Conectado' : 'Desconectado'}`;
        }
        
        // Actualizar indicador de WebSocket si existe
        const wsStatus = document.getElementById('websocket-status');
        if (wsStatus) {
            // Usar el estado combinado, no solo el parámetro
            const isConnected = this.systemStatus.websocket || this.isDemoMode;
            wsStatus.className = `status-button ${isConnected ? 'websocket-btn connected' : 'websocket-btn disconnected'}`;
            wsStatus.innerHTML = `<i class="bi bi-wifi"></i> WebSocket`;
            wsStatus.title = `WebSocket: ${isConnected ? 'Conectado' : 'Desconectado'}`;
        }
    }

    handleArduinoData(data) {
        try {
            // Parsear datos del Arduino si es un string, si no, usar el objeto directamente
            let parsed;
            if (typeof data === 'string') {
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    console.log('Raw Arduino data (not JSON):', data);
                    return;
                }
            } else {
                parsed = data;
            }

            // El parser del servidor entrega { type, positionY, limitMaxY, ... },
            // pero las tarjetas de monitoreo usan otros nombres (travelY,
            // finCarreraY, ...). Sin esta traducción las tarjetas nunca
            // encuentran su valor y se quedan en "--".
            const detail = { ...parsed, ...this.mapArduinoVariables(parsed) };

            this.processData.variables = { ...this.processData.variables, ...detail };

            // Emitir evento para que las pantallas se actualicen
            document.dispatchEvent(new CustomEvent('arduino-data-update', {
                detail: detail
            }));
        } catch (error) {
            console.error('Error procesando datos del Arduino:', error);
        }
    }

    /**
     * Propaga los parámetros de la receta en curso a las pantallas.
     * Son valores de configuración (tiempos, velocidades, ciclos, exclusiones)
     * que el sistema ya tenía en base de datos pero nunca llegaban al monitoreo.
     */
    handleProcessStage(etapa) {
        this.processData.currentStage = etapa || null;

        // La tarjeta "stage" de Monitoreo se alimenta como cualquier otra
        // variable; la pantalla de Proceso escucha el evento con el detalle.
        document.dispatchEvent(new CustomEvent('arduino-data-update', {
            detail: { stage: etapa ? `${etapa.stage}/${etapa.totalStages}` : '--' }
        }));

        document.dispatchEvent(new CustomEvent('process-stage-changed', {
            detail: etapa || null
        }));
    }

    handleProcessParameters(parameters) {
        if (!parameters || typeof parameters !== 'object') return;

        this.processData.variables = { ...this.processData.variables, ...parameters };

        document.dispatchEvent(new CustomEvent('arduino-data-update', {
            detail: parameters
        }));
    }

    /**
     * Traduce los datos parseados del Arduino a los nombres de variable que
     * usan las tarjetas de la pantalla de Monitoreo (atributo data-variable).
     * Solo se mapea lo que el firmware realmente reporta; las variables sin
     * hardware asociado (parrillas, removedores, puerta, eje X) se quedan sin
     * valor a propósito.
     */
    mapArduinoVariables(parsed) {
        if (!parsed || typeof parsed !== 'object') return {};

        const vars = {};

        switch (parsed.type) {
            case 'status':
                if (parsed.positionY !== undefined) vars.travelY = parsed.positionY;
                if (parsed.positionZmm !== undefined) vars.travelZ = parsed.positionZmm;
                if (parsed.lamp !== undefined) vars.lamp = parsed.lamp;
                if (parsed.emergencyStop !== undefined) vars.pardEmergencia = parsed.emergencyStop;
                if (parsed.processPaused !== undefined) vars.pauseCycle = parsed.processPaused;
                if (parsed.fan !== undefined) vars.fan = parsed.fan;
                if (parsed.cycleCurrent !== undefined) vars.cycleCount = parsed.cycleCurrent;
                if (parsed.cycleTotal !== undefined && parsed.cycleCurrent !== undefined) {
                    // La tarjeta "cycles" es "Ciclos Restantes"
                    vars.cycles = Math.max(0, parsed.cycleTotal - parsed.cycleCurrent);
                }
                if (parsed.limitMaxY !== undefined) vars.finCarreraY = parsed.limitMaxY;
                if (parsed.homeZ !== undefined) vars.inicioCarreraZ = parsed.homeZ;
                if (parsed.limitMaxZ !== undefined) vars.finCarreraZ = parsed.limitMaxZ;
                vars.timeStamp = Date.now();
                break;

            case 'position':
                if (parsed.axis === 'Y') vars.travelY = parsed.position;
                vars.timeStamp = Date.now();
                break;

            case 'sensors':
                // envTemp / envHumidity ya vienen con el nombre correcto
                if (parsed.envTemp !== undefined) vars.envTemp = parsed.envTemp;
                if (parsed.envHumidity !== undefined) vars.envHumidity = parsed.envHumidity;
                break;

            case 'emergency':
                vars.pardEmergencia = parsed.active;
                break;

            case 'limit':
                if (parsed.axis === 'Y' && parsed.limit === 'MAX') vars.finCarreraY = true;
                if (parsed.axis === 'Z' && parsed.limit === 'MAX') vars.finCarreraZ = true;
                if (parsed.axis === 'Z' && parsed.limit === 'MIN') vars.inicioCarreraZ = true;
                break;

            case 'config':
                // Constantes de la máquina que el firmware envía al arrancar
                if (parsed.setY1 !== undefined) vars.setY1 = parsed.setY1;
                if (parsed.setY2 !== undefined) vars.setY2 = parsed.setY2;
                if (parsed.setY3 !== undefined) vars.setY3 = parsed.setY3;
                if (parsed.setY4 !== undefined) vars.setY4 = parsed.setY4;
                if (parsed.setHomeY !== undefined) vars.setHomeY = parsed.setHomeY;
                break;
        }

        return vars;
    }

    updateProcessData(data) {
        this.processData = { ...this.processData, ...data };
        
        document.dispatchEvent(new CustomEvent('process-data-update', {
            detail: this.processData
        }));
    }

    navigateToScreen(screenName, params = {}) {
        // Validar permisos para pantallas restringidas
        if (screenName === 'configuration') {
            if (this.userSession?.role !== 'admin') {
                this.showError('Solo los administradores pueden acceder a la configuración del sistema');
                return;
            }
        }
        
        // Si es la primera vez que se carga el dashboard, forzar la carga
        if (this.currentScreen === screenName && this.currentScreen === 'dashboard' && !this.dashboardLoaded) {
            this.dashboardLoaded = true;
        } else if (this.currentScreen === screenName) {
            return;
        }
        
        this.showLoading();
        
        setTimeout(() => {
            // Destruir instancia de pantalla anterior si existe
            if (this.activeScreenInstance && typeof this.activeScreenInstance.destroy === 'function') {
                console.log(`Destruyendo pantalla: ${this.currentScreen}`);
                this.activeScreenInstance.destroy();
                this.activeScreenInstance = null;
            }

            this.currentScreen = screenName;
            this.updateBreadcrumb(screenName);
            this.loadScreen(screenName, params);
            this.hideLoading();
        }, 300);
    }

    updateBreadcrumb(screenName) {
        const breadcrumb = document.getElementById('breadcrumb');
        const screens = {
            'dashboard': 'Dashboard',
            'recipes': 'Recetas',
            'recipe-form': 'Nueva Receta',
            'process': 'Proceso',
            'monitoring': 'Monitoreo',
            'configuration': 'Configuración',
            'manual': 'Control Manual',
            'users': 'Administración de Usuarios'
        };
        
        if (breadcrumb) {
            breadcrumb.innerHTML = `
                <li class="breadcrumb-item">
                    <a href="#" data-screen="dashboard">Dashboard</a>
                </li>
                ${screenName !== 'dashboard' ? `<li class="breadcrumb-item active">${screens[screenName]}</li>` : ''}
            `;
        }
    }

    async loadScreen(screenName, params = {}) {
        const container = document.getElementById('screen-container');
        if (!container) {
            return;
        }

        try {
            // Load screen content
            let content = '';
            
            switch (screenName) {
                case 'dashboard':
                    content = await this.loadDashboardContent();
                    break;
                case 'recipes':
                    content = await this.loadRecipesContent();
                    break;
                case 'recipe-form':
                    content = await this.loadRecipeFormContent(params);
                    break;
                case 'process':
                    content = await this.loadProcessContent();
                    break;
                case 'monitoring':
                    content = await this.loadMonitoringContent();
                    break;
                case 'configuration':
                    content = await this.loadConfigurationContent();
                    break;
                case 'manual':
                    content = await this.loadManualContent();
                    break;
                case 'users':
                    content = UsersScreen.getTemplate();
                    break;
                default:
                    content = '<div class="alert alert-warning">Pantalla no encontrada</div>';
            }
            
            container.innerHTML = content;
            container.className = 'fade-in';
            
            // Initialize screen-specific functionality
            this.initScreenFunctionality(screenName);
            
        } catch (error) {
            console.error('Error loading screen:', error);
            container.innerHTML = '<div class="alert alert-danger">Error cargando la pantalla: ' + error.message + '</div>';
        }
    }

    initScreenFunctionality(screenName) {
        switch (screenName) {
            case 'dashboard':
                if (window.DashboardScreen) {
                    this.activeScreenInstance = new DashboardScreen(this);
                } else {
                    console.error('DashboardScreen not available');
                }
                break;
            case 'recipes':
                if (window.RecipesScreen) {
                    this.activeScreenInstance = new RecipesScreen(this);
                }
                break;
            case 'process':
                if (window.ProcessScreen) {
                    this.activeScreenInstance = new ProcessScreen(this);
                }
                break;
            case 'monitoring':
                if (window.MonitoringScreen) {
                    this.activeScreenInstance = new MonitoringScreen(this);
                }
                break;
            case 'configuration':
                if (window.ConfigurationScreen) {
                    this.activeScreenInstance = new ConfigurationScreen(this);
                }
                break;
            case 'manual':
                if (window.ManualScreen) {
                    this.activeScreenInstance = new ManualScreen(this);
                }
                break;
            case 'users':
                if (window.UsersScreen) {
                    this.activeScreenInstance = new UsersScreen(this);
                }
                break;
        }
    }

    // API Methods
    async apiCall(endpoint, options = {}) {
        // Return demo data in demo mode
        if (this.isDemoMode) {
            return this.getDemoApiResponse(endpoint, options);
        }
        
        try {
            // Añadir token de autenticación a todas las llamadas API
            const headers = {
                'Content-Type': 'application/json; charset=utf-8',
                'Accept': 'application/json; charset=utf-8',
                'Accept-Charset': 'utf-8',
                ...options.headers
            };

            if (this.userSession && this.userSession.token) {
                headers['Authorization'] = `Bearer ${this.userSession.token}`;
            }

            const response = await fetch(`/api${endpoint}`, {
                headers,
                ...options
            });
            
            if (response.status === 401) {
                // Token expirado o inválido, redirigir al login
                this.logout();
                return null;
            }
            
            // Obtener el texto y parsear manualmente para asegurar UTF-8
            const text = await response.text();
            
            if (!response.ok) {
                // Intentar parsear el error del servidor
                let errorMessage = `Error del servidor (${response.status})`;
                try {
                    const errorData = JSON.parse(text);
                    errorMessage = errorData.message || errorData.error || errorMessage;
                } catch (e) {
                    // Si no se puede parsear, usar el texto directamente
                    errorMessage = text || errorMessage;
                }
                const error = new Error(errorMessage);
                error.status = response.status;
                error.responseData = text;
                throw error;
            }
            
            return JSON.parse(text);
        } catch (error) {
            console.error('API Call Error:', error);
            
            // In demo mode, fallback to demo data instead of showing error
            if (this.isDemoMode) {
                return this.getDemoApiResponse(endpoint, options);
            }
            
            // Si el error tiene un mensaje específico del servidor (error.responseData),
            // no mostrar error genérico aquí - el código que llama manejará el error específico
            // Solo mostrar error genérico para errores de red/conexión
            if (!error.responseData && (error.message.includes('fetch') || error.message.includes('Failed to fetch'))) {
                this.showError(`Error en la comunicación: No se pudo conectar al servidor`);
            }
            // Para otros errores, el código que llama a apiCall manejará el mensaje específico
            throw error;
        }
    }

    getDemoApiResponse(endpoint, options) {
        console.log(`🔧 Demo API call: ${endpoint}`);
        
        // Simulate API responses
        switch (endpoint) {
            case '/recipes':
                // Si es POST, simular creación de receta
                if (options.method === 'POST') {
                    const newRecipe = {
                        id: Date.now(),
                        name: options.body?.name || 'Nueva Receta',
                        description: options.body?.description || 'Descripción de prueba',
                        type: options.body?.type || 'A',
                        parameters: options.body?.parameters || { duration: 60, temperature: 25 },
                        created_by_name: this.userSession.fullName,
                        creator_role: this.userSession.role,
                        created_by_user_id: this.userSession.userId,
                        created_at: new Date().toISOString()
                    };
                    
                    return Promise.resolve({
                        success: true,
                        message: 'Receta guardada correctamente (modo demo)',
                        recipeId: newRecipe.id
                    });
                }
                
                // Si es PUT, simular actualización de receta
                if (options.method === 'PUT') {
                    return Promise.resolve({
                        success: true,
                        message: 'Receta actualizada correctamente (modo demo)',
                        updatedRecipe: JSON.parse(options.body)
                    });
                }
                
                // Si es DELETE, simular eliminación de receta
                if (options.method === 'DELETE') {
                    return Promise.resolve({
                        success: true,
                        message: 'Receta eliminada correctamente (modo demo)'
                    });
                }
                
                // Si es GET, devolver recetas filtradas
                // Simular filtro por rol en modo demo
                const allDemoRecipes = [
                    {
                        id: 1,
                        name: 'Receta Admin',
                        description: 'Receta del administrador',
                        type: 'A',
                        parameters: {
                            duration: 60,
                            temperature: 25.0,
                            velocityX: 100.0,
                            velocityY: 100.0,
                            accelX: 10.0,
                            accelY: 10.0,
                            humidityOffset: 0.0,
                            temperatureOffset: 0.0
                        },
                        created_by_name: 'Administrador del Sistema',
                        creator_role: 'admin',
                        created_by_user_id: 1,
                        created_at: new Date().toISOString()
                    },
                    {
                        id: 2,
                        name: 'Receta Dr. Martínez',
                        description: 'Receta experimental',
                        type: 'B',
                        parameters: {
                            duration: 90,
                            temperature: 30.0,
                            velocityX: 150.0,
                            velocityY: 150.0,
                            accelX: 15.0,
                            accelY: 15.0,
                            humidityOffset: 2.0,
                            temperatureOffset: 1.0
                        },
                        created_by_name: 'Dr. Juan Martínez',
                        creator_role: 'usuario',
                        created_by_user_id: 2,
                        created_at: new Date().toISOString()
                    },
                    {
                        id: 3,
                        name: 'Receta Sistema',
                        description: 'Receta del sistema',
                        type: 'C',
                        parameters: {
                            duration: 45,
                            temperature: 22.0,
                            velocityX: 75.0,
                            velocityY: 80.0,
                            accelX: 8.0,
                            accelY: 9.0,
                            humidityOffset: -0.5,
                            temperatureOffset: 0.2
                        },
                        created_by_name: 'Administrador del Sistema',
                        creator_role: 'admin',
                        created_by_user_id: 1,
                        created_at: new Date().toISOString()
                    }
                ];

                if (this.userSession.role === 'admin') {
                    return Promise.resolve(allDemoRecipes); // Admin ve todas
                } else {
                    // Usuario normal solo ve sus propias recetas
                    const userRecipes = allDemoRecipes.filter(recipe => 
                        recipe.created_by_user_id === this.userSession.userId
                    );
                    return Promise.resolve(userRecipes);
                }
                
            case '/system/status':
                return Promise.resolve({
                    arduino: this.systemStatus.arduino,
                    database: this.systemStatus.database,
                    timestamp: new Date().toISOString()
                });
                
            case '/system/stats':
                return Promise.resolve({
                    totalRecipes: 4,
                    activeProcesses: this.isDemoMode ? 1 : 0,
                    completedToday: 2,
                    uptime: 7200 // 2 hours
                });
                
            default:
                if (options.method === 'POST') {
                    return Promise.resolve({ 
                        success: true, 
                        message: 'Operación simulada en modo demo',
                        id: Math.floor(Math.random() * 1000)
                    });
                }
                return Promise.resolve({ message: 'Demo response' });
        }
    }

    // Arduino Communication
    sendArduinoCommand(command) {
        if (this.isDemoMode) {
            console.log(`🔧 Demo Arduino command: ${command}`);
            this.showSuccess(`Comando simulado: ${command}`);
            return;
        }
        
        if (this.socket) {
            this.socket.emit('arduino-command', command);
        }
    }

    // UI Helper Methods
    showLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.remove('d-none');
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('d-none');
        }
    }

    showError(message) {
        const toast = document.getElementById('error-toast');
        const messageEl = document.getElementById('error-message');
        
        if (toast && messageEl) {
            messageEl.textContent = message;
            const bsToast = new bootstrap.Toast(toast);
            bsToast.show();
        }
    }

    showSuccess(message) {
        const toast = document.getElementById('success-toast');
        const messageEl = document.getElementById('success-message');
        
        if (toast && messageEl) {
            messageEl.textContent = message;
            const bsToast = new bootstrap.Toast(toast);
            bsToast.show();
        }
    }

    confirmExit() {
        if (confirm('¿Está seguro que desea salir del sistema SILAR?')) {
            // En Electron, cerrar la aplicación
            if (window.require) {
                const { remote } = window.require('electron');
                remote.getCurrentWindow().close();
            }
        }
    }

    // Screen Content Loaders (will be implemented by individual screen files)
    async loadDashboardContent() {
        try {
            if (window.DashboardScreen && typeof window.DashboardScreen.getTemplate === 'function') {
                const userRole = this.userSession?.role || 'usuario';
                console.log('loadDashboardContent - Rol del usuario:', userRole, 'Es admin:', userRole === 'admin');
                console.log('userSession completo:', this.userSession);
                return window.DashboardScreen.getTemplate(userRole);
            } else {
                throw new Error('DashboardScreen not available');
            }
        } catch (error) {
            console.error('Error loading dashboard content:', error);
            return '<div class="alert alert-danger">Error cargando el dashboard</div>';
        }
    }

    async loadRecipesContent() {
        return window.RecipesScreen ? window.RecipesScreen.getTemplate() : '<div>Loading...</div>';
    }

    async loadRecipeFormContent(params) {
        return window.RecipeFormScreen ? window.RecipeFormScreen.getTemplate(params) : '<div>Loading...</div>';
    }

    async loadProcessContent() {
        return window.ProcessScreen ? window.ProcessScreen.getTemplate() : '<div>Loading...</div>';
    }

    async loadMonitoringContent() {
        return window.MonitoringScreen ? window.MonitoringScreen.getTemplate() : '<div>Loading...</div>';
    }

    async loadConfigurationContent() {
        return window.ConfigurationScreen ? window.ConfigurationScreen.getTemplate() : '<div>Loading...</div>';
    }

    async loadManualContent() {
        return window.ManualScreen ? window.ManualScreen.getTemplate() : '<div>Loading...</div>';
    }

    async loadDashboard() {
        // Esperar a que todos los scripts estén cargados
        await this.waitForScripts();
        this.navigateToScreen('dashboard');
    }

    async waitForScripts() {
        // Esperar hasta que todos los scripts de pantallas estén cargados
        let attempts = 0;
        const maxAttempts = 50; // 5 segundos máximo
        
        while (attempts < maxAttempts) {
            if (window.DashboardScreen && 
                window.RecipesScreen && 
                window.ProcessScreen && 
                window.MonitoringScreen && 
                window.ConfigurationScreen && 
                window.ManualScreen) {
                return;
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        console.warn('Some screens may not be loaded after waiting');
    }

    bindEvents() {
        // Navigation
        document.addEventListener('click', (e) => {
            if (e.target.closest('[data-screen]')) {
                const screen = e.target.closest('[data-screen]').getAttribute('data-screen');
                this.navigateToScreen(screen);
                
                // Update active state in sidebar
                document.querySelectorAll('.nav-link').forEach(link => {
                    link.classList.remove('active');
                });
                e.target.closest('[data-screen]').classList.add('active');
            }
        });

        // Logout
        document.addEventListener('click', (e) => {
            if (e.target.closest('[onclick*="logout"]')) {
                e.preventDefault();
                this.logout();
            }
        });

        // Initialize logout modal
        this.initLogoutModal();
    }

    // Función de prueba para crear receta
    async testCreateRecipe() {
        const testRecipe = {
            name: 'Receta de Prueba',
            description: 'Receta creada para probar la API',
            type: 'A',
            parameters: {
                duration: 60,
                temperature: 25.0,
                velocityX: 100.0,
                velocityY: 100.0,
                accelX: 10.0,
                accelY: 10.0,
                humidityOffset: 0.0,
                temperatureOffset: 0.0
            }
        };

        try {
            const result = await this.apiCall('/recipes', {
                method: 'POST',
                body: JSON.stringify(testRecipe)
            });
            
            console.log('✅ Receta creada:', result);
            return result;
        } catch (error) {
            console.error('❌ Error creando receta:', error);
            return null;
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.silarApp = new SilarApp();
});
