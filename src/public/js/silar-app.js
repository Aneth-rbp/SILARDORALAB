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
        }
    }

    logout() {
        // Mostrar modal de confirmación
        const logoutModal = new bootstrap.Modal(document.getElementById('logoutModal'));
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

            this.socket.on('process-update', (data) => {
                this.updateProcessData(data);
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
            const isConnected = status.arduino || this.isDemoMode;
            arduinoStatus.className = `status-button ${isConnected ? 'arduino-btn connected' : 'arduino-btn disconnected'}`;
            arduinoStatus.innerHTML = `<i class="bi bi-usb"></i> Arduino`;
            arduinoStatus.title = `Arduino: ${isConnected ? 'Conectado' : 'Desconectado'}`;
        }
        
        if (dbStatus) {
            const isConnected = status.database || this.isDemoMode;
            dbStatus.className = `status-button ${isConnected ? 'mysql-btn connected' : 'mysql-btn disconnected'}`;
            dbStatus.innerHTML = `<i class="bi bi-database"></i> MySQL`;
            dbStatus.title = `MySQL: ${isConnected ? 'Conectado' : 'Desconectado'}`;
        }
        
        // Actualizar indicador de WebSocket si existe
        const wsStatus = document.getElementById('websocket-status');
        if (wsStatus) {
            const isConnected = status.websocket || this.isDemoMode;
            wsStatus.className = `status-button ${isConnected ? 'websocket-btn connected' : 'websocket-btn disconnected'}`;
            wsStatus.innerHTML = `<i class="bi bi-wifi"></i> WebSocket`;
            wsStatus.title = `WebSocket: ${isConnected ? 'Conectado' : 'Desconectado'}`;
        }
    }

    handleArduinoData(data) {
        try {
            // Parsear datos del Arduino
            const parsed = JSON.parse(data);
            this.processData.variables = { ...this.processData.variables, ...parsed };
            
            // Emitir evento para que las pantallas se actualicen
            document.dispatchEvent(new CustomEvent('arduino-data-update', {
                detail: parsed
            }));
        } catch (error) {
            console.log('Raw Arduino data:', data);
        }
    }

    updateProcessData(data) {
        this.processData = { ...this.processData, ...data };
        
        document.dispatchEvent(new CustomEvent('process-data-update', {
            detail: this.processData
        }));
    }

    navigateToScreen(screenName, params = {}) {
        // Si es la primera vez que se carga el dashboard, forzar la carga
        if (this.currentScreen === screenName && this.currentScreen === 'dashboard' && !this.dashboardLoaded) {
            this.dashboardLoaded = true;
        } else if (this.currentScreen === screenName) {
            return;
        }
        
        this.showLoading();
        
        setTimeout(() => {
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
            'manual': 'Control Manual'
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
                    new DashboardScreen(this);
                } else {
                    console.error('DashboardScreen not available');
                }
                break;
            case 'recipes':
                if (window.RecipesScreen) {
                    new RecipesScreen(this);
                }
                break;
            case 'process':
                if (window.ProcessScreen) {
                    new ProcessScreen(this);
                }
                break;
            case 'monitoring':
                if (window.MonitoringScreen) {
                    new MonitoringScreen(this);
                }
                break;
            case 'configuration':
                if (window.ConfigurationScreen) {
                    new ConfigurationScreen(this);
                }
                break;
            case 'manual':
                if (window.ManualScreen) {
                    new ManualScreen(this);
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
                'Content-Type': 'application/json',
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
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('API Call Error:', error);
            
            // In demo mode, fallback to demo data instead of showing error
            if (this.isDemoMode) {
                return this.getDemoApiResponse(endpoint, options);
            }
            
            this.showError(`Error en la comunicación: ${error.message}`);
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
                return window.DashboardScreen.getTemplate();
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
