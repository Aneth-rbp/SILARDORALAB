/**
 * Recipes Screen - Gestión de recetas del sistema SILAR
 * Equivale a las pantallas 2, 3 y 4 del diseño original
 */

class RecipesScreen {
    constructor(app) {
        this.app = app;
        this.recipes = [];
        this.selectedRecipe = null;
        this.currentUser = this.app.userSession;
        this.init();
    }

    getCreatorBadgeColor(creatorRole) {
        const colors = {
            'admin': 'bg-danger',
            'usuario': 'bg-primary'
        };
        return colors[creatorRole] || 'bg-secondary';
    }

    canUserEditRecipe(recipe) {
        if (!this.currentUser) return false;
        
        // Admins pueden editar todo
        if (this.currentUser.role === 'admin') return true;
        
        // Usuarios pueden editar sus propias recetas
        if (recipe.created_by_user_id === this.currentUser.userId) return true;
        
        return false;
    }

    async init() {
        await this.loadRecipes();
        this.bindEvents();
    }

    bindEvents() {
        // Nuevo recipe button
        document.getElementById('new-recipe-btn')?.addEventListener('click', () => {
            this.showRecipeForm();
        });

        // Recipe selection
        document.addEventListener('click', (e) => {
            if (e.target.closest('.recipe-card')) {
                const recipeId = e.target.closest('.recipe-card').getAttribute('data-recipe-id');
                this.selectRecipe(recipeId);
            }
        });

        // Execute recipe button
        document.getElementById('execute-recipe-btn')?.addEventListener('click', () => {
            this.executeSelectedRecipe();
        });

        // Edit recipe button
        document.getElementById('edit-recipe-btn')?.addEventListener('click', () => {
            this.editSelectedRecipe();
        });

        // Delete recipe button
        document.getElementById('delete-recipe-btn')?.addEventListener('click', () => {
            this.deleteSelectedRecipe();
        });

        // Search functionality
        document.getElementById('recipe-search')?.addEventListener('input', (e) => {
            this.filterRecipes(e.target.value);
        });
    }

    filterRecipes(searchTerm) {
        const searchLower = searchTerm.toLowerCase().trim();
        const recipeCards = document.querySelectorAll('.recipe-card');
        
        recipeCards.forEach(card => {
            const recipeName = card.querySelector('.recipe-name-main')?.textContent.toLowerCase() || '';
            const recipeDescription = card.querySelector('.recipe-description')?.textContent.toLowerCase() || '';
            const creatorName = card.querySelector('.creator-info span')?.textContent.toLowerCase() || '';
            
            const matches = recipeName.includes(searchLower) || 
                           recipeDescription.includes(searchLower) || 
                           creatorName.includes(searchLower);
            
            card.style.display = matches ? 'flex' : 'none';
        });

        // Mostrar mensaje si no hay resultados
        const visibleCards = document.querySelectorAll('.recipe-card[style*="flex"]');
        const noResultsMsg = document.getElementById('no-results-message');
        
        if (visibleCards.length === 0 && searchTerm) {
            if (!noResultsMsg) {
                const recipesList = document.getElementById('recipes-list');
                const message = document.createElement('div');
                message.id = 'no-results-message';
                message.className = 'empty-state';
                message.innerHTML = `
                    <div class="empty-icon">
                        <i class="bi bi-search"></i>
                    </div>
                    <h4>No se encontraron recetas</h4>
                    <p>Intente con otros términos de búsqueda</p>
                `;
                recipesList.appendChild(message);
            }
        } else if (noResultsMsg) {
            noResultsMsg.remove();
        }
    }

    async loadRecipes() {
        try {
            this.recipes = await this.app.apiCall('/recipes');
            this.renderRecipesList();
        } catch (error) {
            this.app.showError('Error cargando las recetas');
        }
    }

    renderRecipesList() {
        const container = document.getElementById('recipes-list');
        if (!container) return;

        if (this.recipes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <i class="bi bi-journal-plus"></i>
                    </div>
                    <h4>No hay recetas disponibles</h4>
                    <p>Cree su primera receta para comenzar</p>
                    <button class="btn btn-primary" onclick="this.showRecipeForm()">
                        <i class="bi bi-plus-lg me-2"></i>Nueva Receta
                    </button>
                </div>
            `;
            return;
        }

        const recipesHtml = this.recipes.map(recipe => {
            const creatorBadgeColor = this.getCreatorBadgeColor(recipe.creator_role);
            const userCanEdit = this.canUserEditRecipe(recipe);
            const isSelected = this.selectedRecipe?.id === recipe.id;
            
            return `
                <div class="recipe-card compact ${isSelected ? 'selected' : ''}" data-recipe-id="${recipe.id}">
                    <div class="recipe-header">
                        <div class="recipe-name-main">${recipe.name}</div>
                        <div class="recipe-type-badge">${recipe.type || 'A'}</div>
                    </div>
                    <div class="recipe-description">
                        ${recipe.description || 'Sin descripción'}
                    </div>
                    <div class="recipe-meta-info">
                        <div class="creator-info">
                            <i class="bi bi-person-circle"></i>
                            <span>${recipe.created_by_name}</span>
                        </div>
                        <div class="date-info">
                            <i class="bi bi-calendar"></i>
                            <span>${new Date(recipe.created_at).toLocaleDateString('es-ES')}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = recipesHtml;
    }

    selectRecipe(recipeId) {
        this.selectedRecipe = this.recipes.find(r => r.id == recipeId);
        
        // Update visual selection
        document.querySelectorAll('.recipe-card').forEach(card => {
            card.classList.remove('active');
        });
        
        const selectedCard = document.querySelector(`[data-recipe-id="${recipeId}"]`);
        if (selectedCard) {
            selectedCard.classList.add('active');
        }

        // Update recipe details
        this.updateRecipeDetails();
        
        // Show/hide action bar
        const actionBar = document.getElementById('action-bar');
        if (actionBar) {
            actionBar.style.display = this.selectedRecipe ? 'block' : 'none';
        }
        
        // Enable action buttons
        this.updateActionButtons();
    }

    highlightSelectedRecipe() {
        // Remover selección anterior
        document.querySelectorAll('.recipe-card').forEach(card => {
            card.classList.remove('selected');
        });
        
        // Resaltar la receta seleccionada
        if (this.selectedRecipe) {
            const selectedCard = document.querySelector(`[data-recipe-id="${this.selectedRecipe.id}"]`);
            if (selectedCard) {
                selectedCard.classList.add('selected');
            }
        }
    }

    updateRecipeDetails() {
        const detailsContainer = document.getElementById('recipe-details');
        if (!detailsContainer || !this.selectedRecipe) return;

        const recipe = this.selectedRecipe;
        const params = recipe.parameters || {};
        
        // Debug: mostrar los parámetros en la consola
        console.log('Receta seleccionada:', recipe.name);
        console.log('Parámetros recibidos:', params);
        console.log('Tipo de parámetros:', typeof params);

        detailsContainer.innerHTML = `
            <div class="recipe-details-card">
                <div class="details-header">
                    <i class="bi bi-info-circle"></i>
                    <h5>Detalles de la Receta</h5>
                </div>
                
                <div class="details-content">
                    <div class="recipe-name">${recipe.name}</div>
                    
                    <div class="params-grid">
                        <div class="param-item">
                            <span class="param-label">Duración</span>
                            <span class="param-value">${params.duration || '--'} min</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Temperatura</span>
                            <span class="param-value">${params.temperature || '--'} °C</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Velocidad X</span>
                            <span class="param-value">${params.velocityX || '--'} rpm</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Velocidad Y</span>
                            <span class="param-value">${params.velocityY || '--'} rpm</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Aceleración X</span>
                            <span class="param-value">${params.accelX || '--'} rpm/s</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Aceleración Y</span>
                            <span class="param-value">${params.accelY || '--'} rpm/s</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Offset Humedad</span>
                            <span class="param-value">${params.humidityOffset || '--'} %</span>
                        </div>
                        <div class="param-item">
                            <span class="param-label">Offset Temp.</span>
                            <span class="param-value">${params.temperatureOffset || '--'} °C</span>
                        </div>
                    </div>

            
                </div>
            </div>
                </div>
            </div>
        `;
    }

    updateActionButtons() {
        const executeBtn = document.getElementById('execute-recipe-btn');
        const editBtn = document.getElementById('edit-recipe-btn');
        const deleteBtn = document.getElementById('delete-recipe-btn');

        const hasSelection = !!this.selectedRecipe;

        if (executeBtn) {
            executeBtn.disabled = !hasSelection;
            if (hasSelection) {
                executeBtn.classList.remove('btn-secondary');
                executeBtn.classList.add('btn-execute');
            } else {
                executeBtn.classList.remove('btn-execute');
                executeBtn.classList.add('btn-secondary');
            }
        }
        
        if (editBtn) {
            editBtn.disabled = !hasSelection;
            if (hasSelection) {
                editBtn.classList.remove('btn-secondary');
                editBtn.classList.add('btn-edit');
            } else {
                editBtn.classList.remove('btn-edit');
                editBtn.classList.add('btn-secondary');
            }
        }
        
        if (deleteBtn) {
            deleteBtn.disabled = !hasSelection;
            if (hasSelection) {
                deleteBtn.classList.remove('btn-secondary');
                deleteBtn.classList.add('btn-delete');
            } else {
                deleteBtn.classList.remove('btn-delete');
                deleteBtn.classList.add('btn-secondary');
            }
        }
    }

    showRecipeForm(recipe = null) {
        const modal = new bootstrap.Modal(document.getElementById('recipe-form-modal'));
        
        // Initialize form
        this.initRecipeForm(recipe);
        modal.show();
    }

    initRecipeForm(recipe) {
        const form = document.getElementById('recipe-form');
        if (!form) return;

        if (recipe) {
            // Edit mode
            form.querySelector('#recipe-name').value = recipe.name || '';
            form.querySelector('#recipe-type').value = recipe.type || 'A';
            form.querySelector('#recipe-description').value = recipe.description || '';
            form.querySelector('#recipe-duration').value = recipe.parameters?.duration || '';
            form.querySelector('#recipe-temperature').value = recipe.parameters?.temperature || '';
            form.querySelector('#recipe-velocity-x').value = recipe.parameters?.velocityX || '';
            form.querySelector('#recipe-velocity-y').value = recipe.parameters?.velocityY || '';
            form.querySelector('#recipe-accel-x').value = recipe.parameters?.accelX || '';
            form.querySelector('#recipe-accel-y').value = recipe.parameters?.accelY || '';
            form.querySelector('#recipe-humidity-offset').value = recipe.parameters?.humidityOffset || '';
            form.querySelector('#recipe-temp-offset').value = recipe.parameters?.temperatureOffset || '';
            
            document.getElementById('recipe-form-title').textContent = 'Editar Receta';
            document.getElementById('save-recipe-btn').textContent = 'Actualizar Receta';
            

        } else {
            // New mode
            form.reset();
            form.querySelector('#recipe-type').value = 'A';
            document.getElementById('recipe-form-title').textContent = 'Nueva Receta';
            document.getElementById('save-recipe-btn').textContent = 'Guardar Receta';
        }

        // Bind save event
        const saveBtn = document.getElementById('save-recipe-btn');
        saveBtn.onclick = () => this.saveRecipe(recipe?.id);
    }

    async saveRecipe(recipeId = null) {
        const form = document.getElementById('recipe-form');
        const formData = new FormData(form);

        // Validación básica
        const name = formData.get('name')?.trim();
        if (!name) {
            this.app.showError('El nombre de la receta es obligatorio');
            return;
        }

        const recipeData = {
            name: name,
            type: formData.get('type') || 'A',
            description: formData.get('description')?.trim() || '',
            parameters: {
                duration: parseInt(formData.get('duration')) || 0,
                temperature: parseFloat(formData.get('temperature')) || 0,
                velocityX: parseFloat(formData.get('velocityX')) || 0,
                velocityY: parseFloat(formData.get('velocityY')) || 0,
                accelX: parseFloat(formData.get('accelX')) || 0,
                accelY: parseFloat(formData.get('accelY')) || 0,
                humidityOffset: parseFloat(formData.get('humidityOffset')) || 0,
                temperatureOffset: parseFloat(formData.get('temperatureOffset')) || 0
            }
        };
        


        // Preparar variables para el manejo del botón
        const saveBtn = document.getElementById('save-recipe-btn');
        const originalText = saveBtn.textContent;
        
        try {
            // Mostrar loading en el botón
            saveBtn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Guardando...';
            saveBtn.disabled = true;

            if (recipeId) {
                // Editar receta existente
                await this.app.apiCall(`/recipes/${recipeId}`, {
                    method: 'PUT',
                    body: JSON.stringify(recipeData)
                });
                
                // Actualizar datos localmente después de la respuesta exitosa del backend
                const recipeIndex = this.recipes.findIndex(r => r.id == recipeId);
                if (recipeIndex !== -1) {
                    this.recipes[recipeIndex] = {
                        ...this.recipes[recipeIndex],
                        ...recipeData,
                        updated_at: new Date().toISOString()
                    };
                }
                
                this.app.showSuccess('Receta actualizada correctamente');
            } else {
                // Crear nueva receta
                const response = await this.app.apiCall('/recipes', {
                    method: 'POST',
                    body: JSON.stringify(recipeData)
                });
                
                // Agregar a la lista local después de la respuesta exitosa del backend
                const newRecipe = {
                    id: response.recipeId || Date.now(), // Usar ID del backend si está disponible
                    ...recipeData,
                    created_by_user_id: this.app.userSession?.userId || 1,
                    created_by_name: this.app.userSession?.fullName || 'Administrador del Sistema',
                    created_at: new Date().toISOString()
                };
                this.recipes.unshift(newRecipe);
                
                this.app.showSuccess('Receta creada correctamente');
            }

            // Cerrar modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('recipe-form-modal'));
            modal.hide();
            
            // Actualizar la vista sin recargar desde el servidor
            this.renderRecipesList();
            this.updateActionButtons();

            // Si estamos editando, actualizar la selección y detalles
            if (recipeId) {
                this.selectedRecipe = this.recipes.find(r => r.id == recipeId);
                if (this.selectedRecipe) {
                    this.updateRecipeDetails();
                    // Resaltar la receta editada
                    this.highlightSelectedRecipe();
                }
            }

        } catch (error) {
            console.error('Error guardando receta:', error);
            this.app.showError('Error guardando la receta');
        } finally {
            // Restaurar botón
            const saveBtn = document.getElementById('save-recipe-btn');
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    }

    async executeSelectedRecipe() {
        if (!this.selectedRecipe) return;

        try {
            await this.app.apiCall('/process/start', {
                method: 'POST',
                body: JSON.stringify({
                    recipeId: this.selectedRecipe.id
                })
            });

            this.app.showSuccess('Proceso iniciado correctamente');
            this.app.navigateToScreen('process');

        } catch (error) {
            this.app.showError('Error iniciando el proceso');
        }
    }

    async editSelectedRecipe() {
        if (!this.selectedRecipe) return;
        
        // Verificar permisos
        if (!this.canUserEditRecipe(this.selectedRecipe)) {
            this.app.showError('No tiene permisos para editar esta receta');
            return;
        }
        
        this.showRecipeForm(this.selectedRecipe);
    }

    async deleteSelectedRecipe() {
        if (!this.selectedRecipe) return;

        // Verificar permisos
        if (!this.canUserEditRecipe(this.selectedRecipe)) {
            this.app.showError('No tiene permisos para eliminar esta receta');
            return;
        }

        // Mostrar modal de confirmación personalizado
        this.showDeleteConfirmationModal(this.selectedRecipe);
    }

    showDeleteConfirmationModal(recipe) {
        const modalHtml = `
            <div class="modal fade" id="delete-confirmation-modal" tabindex="-1">
                <div class="modal-dialog modal-sm">
                    <div class="modal-content">
                        <div class="modal-header bg-danger text-white">
                            <h5 class="modal-title">
                                <i class="bi bi-exclamation-triangle me-2"></i>
                                Confirmar Eliminación
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p>¿Está seguro que desea eliminar la receta:</p>
                            <div class="alert alert-warning">
                                <strong>${recipe.name}</strong>
                                <br>
                                <small class="text-muted">Creada por: ${recipe.created_by_name}</small>
                            </div>
                            <p class="text-danger mb-0">
                                <i class="bi bi-info-circle me-1"></i>
                                Esta acción no se puede deshacer.
                            </p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="button" class="btn btn-danger" id="confirm-delete-btn">
                                <i class="bi bi-trash me-1"></i>
                                Eliminar Receta
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remover modal anterior si existe
        const existingModal = document.getElementById('delete-confirmation-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Agregar nuevo modal al DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Mostrar modal
        const modal = new bootstrap.Modal(document.getElementById('delete-confirmation-modal'));
        modal.show();

        // Bind confirm button
        document.getElementById('confirm-delete-btn').onclick = async () => {
            const confirmBtn = document.getElementById('confirm-delete-btn');
            const originalText = confirmBtn.innerHTML;
            
            try {
                // Mostrar loading
                confirmBtn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Eliminando...';
                confirmBtn.disabled = true;

                // Eliminar receta en el backend
                await this.app.apiCall(`/recipes/${recipe.id}`, {
                    method: 'DELETE'
                });

                // Cerrar modal
                modal.hide();
                
                // Limpiar selección y recargar
                this.selectedRecipe = null;
                await this.loadRecipes();
                
                // Ocultar barra de acciones
                const actionBar = document.getElementById('action-bar');
                if (actionBar) {
                    actionBar.style.display = 'none';
                }

                this.app.showSuccess('Receta eliminada correctamente');

            } catch (error) {
                console.error('Error eliminando receta:', error);
                this.app.showError('Error eliminando la receta');
            } finally {
                // Restaurar botón siempre
                confirmBtn.innerHTML = originalText;
                confirmBtn.disabled = false;
            }
        };

        // Limpiar modal al cerrar
        document.getElementById('delete-confirmation-modal').addEventListener('hidden.bs.modal', function() {
            this.remove();
        });
    }

    static getTemplate() {
        return `
            <div class="recipes-container">
                <!-- Header Section -->
                <div class="recipes-header">
                    <div class="header-content">
                        <div class="header-info">
                            <h2 class="header-title">
                                <i class="bi bi-journal-code me-3"></i>
                                Gestión de Recetas
                            </h2>
                            <p class="header-subtitle">Administre las recetas para síntesis de películas delgadas por método SILAR</p>
                        </div>
                        <button class="btn btn-new-recipe" id="new-recipe-btn">
                            <i class="bi bi-plus-lg me-2"></i>
                            Nueva Receta
                        </button>
                    </div>
                </div>

                <!-- Main Content Area -->
                <div class="recipes-main-content">
                    <!-- Recipes Grid -->
                    <div class="recipes-grid-section">
                        <div class="section-header">
                            <h4 class="section-title">
                                <i class="bi bi-collection me-2"></i>
                                Recetas Disponibles
                            </h4>
                            <div class="section-actions">
                                <div class="search-box">
                                    <i class="bi bi-search"></i>
                                    <input type="text" placeholder="Buscar recetas..." id="recipe-search">
                                </div>
                            </div>
                        </div>
                        
                        <div class="recipes-grid" id="recipes-list">
                            <div class="loading-state">
                                <div class="loading-spinner"></div>
                                <p>Cargando recetas...</p>
                            </div>
                        </div>
                    </div>

                    <!-- Recipe Details Panel -->
                    <div class="recipe-details-panel" id="recipe-details">
                        <div class="details-placeholder">
                            <div class="placeholder-icon">
                                <i class="bi bi-info-circle"></i>
                            </div>
                            <h5>Seleccione una receta</h5>
                            <p>Los detalles se mostrarán aquí</p>
                        </div>
                    </div>
                </div>

                <!-- Action Bar -->
                <div class="action-bar" id="action-bar" style="display: none;">
                    <div class="action-buttons">
                        <button class="btn-action btn-secondary" id="execute-recipe-btn" disabled>
                            <i class="bi bi-play-fill"></i>
                            <span>Ejecutar Proceso</span>
                        </button>
                        <button class="btn-action btn-secondary" id="edit-recipe-btn" disabled>
                            <i class="bi bi-pencil"></i>
                            <span>Editar Receta</span>
                        </button>
                        <button class="btn-action btn-secondary" id="delete-recipe-btn" disabled>
                            <i class="bi bi-trash"></i>
                            <span>Eliminar Receta</span>
                        </button>
                    </div>
                </div>


            </div>

            <!-- Recipe Form Modal -->
            <div class="modal fade" id="recipe-form-modal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="recipe-form-title">Nueva Receta</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <form id="recipe-form">
                                <div class="row g-2">
                                    <div class="col-md-8">
                                        <label class="form-label">Nombre de la Receta</label>
                                        <input type="text" class="form-control" name="name" id="recipe-name" required>
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Tipo de Receta</label>
                                        <select class="form-control" name="type" id="recipe-type">
                                            <option value="A">Tipo A</option>
                                            <option value="B">Tipo B</option>
                                            <option value="C">Tipo C</option>
                                            <option value="D">Tipo D</option>
                                        </select>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Duración (minutos)</label>
                                        <input type="number" class="form-control" name="duration" id="recipe-duration" min="1" max="999">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Temperatura (°C)</label>
                                        <input type="number" class="form-control" name="temperature" id="recipe-temperature" step="0.1">
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label">Descripción</label>
                                        <textarea class="form-control" name="description" id="recipe-description" rows="2"></textarea>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Velocidad Motor X (rpm)</label>
                                        <input type="number" class="form-control" name="velocityX" id="recipe-velocity-x" step="0.1">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Velocidad Motor Y (rpm)</label>
                                        <input type="number" class="form-control" name="velocityY" id="recipe-velocity-y" step="0.1">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Aceleración Motor X (rpm/s)</label>
                                        <input type="number" class="form-control" name="accelX" id="recipe-accel-x" step="0.1">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Aceleración Motor Y (rpm/s)</label>
                                        <input type="number" class="form-control" name="accelY" id="recipe-accel-y" step="0.1">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Offset Humedad (%)</label>
                                        <input type="number" class="form-control" name="humidityOffset" id="recipe-humidity-offset" step="0.1">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">Offset Temperatura (°C)</label>
                                        <input type="number" class="form-control" name="temperatureOffset" id="recipe-temp-offset" step="0.1">
                                    </div>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="button" class="btn btn-primary" id="save-recipe-btn">Guardar Receta</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Register the screen globally
window.RecipesScreen = RecipesScreen;
