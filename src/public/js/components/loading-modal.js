/**
 * Loading Modal Component
 * Componente reutilizable para mostrar estados de carga en toda la aplicación
 */
class LoadingModal {
    constructor(options = {}) {
        this.options = {
            title: 'Cargando...',
            subtitle: 'Por favor espere',
            showProgress: false,
            progressText: 'Progreso',
            showCancel: false,
            cancelText: 'Cancelar',
            onCancel: null,
            ...options
        };
        
        this.modal = null;
        this.progressBar = null;
        this.progressText = null;
        this.isVisible = false;
        
        this.createModal();
    }

    createModal() {
        // Crear el modal
        this.modal = document.createElement('div');
        this.modal.className = 'loading-modal';
        this.modal.setAttribute('role', 'dialog');
        this.modal.setAttribute('aria-modal', 'true');
        this.modal.setAttribute('aria-labelledby', 'loading-title');
        this.modal.setAttribute('aria-describedby', 'loading-subtitle');
        
        // Contenido del modal
        this.modal.innerHTML = `
            <div class="loading-modal-content">
                <div class="loading-spinner" role="status" aria-label="Cargando">
                    <span class="visually-hidden">Cargando...</span>
                </div>
                
                <h2 id="loading-title" class="loading-title">${this.options.title}</h2>
                <p id="loading-subtitle" class="loading-subtitle">${this.options.subtitle}</p>
                
                ${this.options.showProgress ? `
                    <div class="loading-progress-container">
                        <div class="loading-progress">
                            <div class="loading-progress-bar"></div>
                        </div>
                        <div class="loading-progress-text">0%</div>
                    </div>
                ` : ''}
                
                ${this.options.showCancel ? `
                    <button type="button" class="btn btn-outline-secondary btn-cancel" id="loading-cancel-btn">
                        ${this.options.cancelText}
                    </button>
                ` : ''}
            </div>
        `;

        // Agregar estilos CSS si no existen
        if (!document.getElementById('loading-modal-styles')) {
            this.addStyles();
        }

        // Agregar al DOM
        document.body.appendChild(this.modal);

        // Configurar elementos
        if (this.options.showProgress) {
            this.progressBar = this.modal.querySelector('.loading-progress-bar');
            this.progressText = this.modal.querySelector('.loading-progress-text');
        }

        // Configurar botón de cancelar
        if (this.options.showCancel) {
            const cancelBtn = this.modal.querySelector('#loading-cancel-btn');
            cancelBtn.addEventListener('click', () => {
                if (this.options.onCancel) {
                    this.options.onCancel();
                }
                this.hide();
            });
        }

        // Event listeners para teclado
        this.modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.options.showCancel) {
                if (this.options.onCancel) {
                    this.options.onCancel();
                }
                this.hide();
            }
        });
    }

    addStyles() {
        const style = document.createElement('style');
        style.id = 'loading-modal-styles';
        style.textContent = `
            .loading-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                opacity: 0;
                transition: opacity 0.3s ease;
            }

            .loading-modal.show {
                opacity: 1;
            }

            .loading-modal-content {
                background: white;
                border-radius: 20px;
                padding: 3rem;
                text-align: center;
                box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
                max-width: 400px;
                width: 90%;
                animation: modalSlideIn 0.4s ease-out;
            }

            .loading-spinner {
                width: 80px;
                height: 80px;
                border: 4px solid #E5E7EB;
                border-top: 4px solid #2563EB;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 2rem;
            }

            .loading-title {
                color: #2563EB;
                font-size: 1.5rem;
                font-weight: 700;
                margin-bottom: 1rem;
                letter-spacing: -0.025em;
            }

            .loading-subtitle {
                color: #6B7280;
                font-size: 1rem;
                margin-bottom: 1.5rem;
            }

            .loading-progress-container {
                margin: 1.5rem 0;
            }

            .loading-progress {
                width: 100%;
                height: 6px;
                background: #E5E7EB;
                border-radius: 3px;
                margin-bottom: 0.5rem;
                overflow: hidden;
            }

            .loading-progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #2563EB, #1e40af);
                border-radius: 3px;
                width: 0%;
                transition: width 0.3s ease;
            }

            .loading-progress-text {
                font-size: 0.875rem;
                color: #6B7280;
                font-weight: 500;
            }

            .btn-cancel {
                margin-top: 1rem;
                padding: 0.75rem 1.5rem;
                border-radius: 8px;
                font-weight: 500;
                transition: all 0.2s ease;
            }

            .btn-cancel:hover {
                background: #F3F4F6;
                border-color: #D1D5DB;
            }

            @keyframes modalSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(-30px) scale(0.9);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            /* Responsive adjustments */
            @media (max-width: 576px) {
                .loading-modal-content {
                    padding: 2rem;
                    margin: 1rem;
                }
                
                .loading-spinner {
                    width: 60px;
                    height: 60px;
                    margin-bottom: 1.5rem;
                }
                
                .loading-title {
                    font-size: 1.25rem;
                }
            }

            /* High contrast mode support */
            @media (prefers-contrast: high) {
                .loading-modal-content {
                    border: 2px solid #000;
                }
                
                .loading-spinner {
                    border-width: 6px;
                }
            }

            /* Reduced motion support */
            @media (prefers-reduced-motion: reduce) {
                .loading-modal-content {
                    animation: none;
                }
                
                .loading-spinner {
                    animation: none;
                }
                
                .loading-progress-bar {
                    transition: none;
                }
            }
        `;
        
        document.head.appendChild(style);
    }

    show() {
        if (this.isVisible) return;
        
        this.isVisible = true;
        this.modal.style.display = 'flex';
        
        // Trigger reflow
        this.modal.offsetHeight;
        
        // Mostrar con animación
        requestAnimationFrame(() => {
            this.modal.classList.add('show');
        });
        
        // Focus management
        this.modal.focus();
        
        // Announce to screen readers
        this.announceToScreenReader(this.options.title);
    }

    hide() {
        if (!this.isVisible || !this.modal) return;
        
        this.isVisible = false;
        this.modal.classList.remove('show');
        
        // Ocultar después de la transición
        setTimeout(() => {
            if (this.modal) {
                this.modal.style.display = 'none';
            }
        }, 300);
    }

    updateProgress(percentage, text = null) {
        if (!this.options.showProgress || !this.progressBar) return;
        
        const clampedPercentage = Math.max(0, Math.min(100, percentage));
        
        this.progressBar.style.width = `${clampedPercentage}%`;
        
        if (this.progressText) {
            this.progressText.textContent = text || `${Math.round(clampedPercentage)}%`;
        }
    }

    updateTitle(title) {
        const titleElement = this.modal.querySelector('#loading-title');
        if (titleElement) {
            titleElement.textContent = title;
            this.announceToScreenReader(title);
        }
    }

    updateSubtitle(subtitle) {
        const subtitleElement = this.modal.querySelector('#loading-subtitle');
        if (subtitleElement) {
            subtitleElement.textContent = subtitle;
        }
    }

    announceToScreenReader(message) {
        // Crear un elemento temporal para anunciar cambios
        const announcement = document.createElement('div');
        announcement.setAttribute('aria-live', 'polite');
        announcement.setAttribute('aria-atomic', 'true');
        announcement.className = 'visually-hidden';
        announcement.textContent = message;
        
        document.body.appendChild(announcement);
        
        // Remover después de un momento
        setTimeout(() => {
            if (announcement.parentNode) {
                announcement.remove();
            }
        }, 1000);
    }

    destroy() {
        if (this.modal && this.modal.parentNode) {
            this.modal.parentNode.removeChild(this.modal);
        }
        this.modal = null;
        this.isVisible = false;
        this.options = null;
    }

    // Métodos estáticos para uso rápido
    static show(options = {}) {
        const modal = new LoadingModal(options);
        modal.show();
        return modal;
    }

    static hide(modal) {
        if (modal) {
            modal.hide();
            modal.destroy();
        }
    }
}

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LoadingModal;
} else if (typeof window !== 'undefined') {
    window.LoadingModal = LoadingModal;
}




