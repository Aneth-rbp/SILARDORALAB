-- =====================================================
-- Migración: Tiempo de espera de transición
-- Fecha: 2026-08-19
-- Descripción: Agrega transition_wait a recipe_parameters y a recipe_stages.
--
-- La receta ya tenía transfer_wait, pero ese tiempo no es el de la transición:
-- se espera con el sustrato ya colocado sobre el vaso y justo antes de bajarlo,
-- así que en la práctica es la previa de la inmersión. Faltaba la espera de
-- verdad entre baños: la que ocurre DESPUÉS de sacar el sustrato de la solución
-- y antes de viajar al vaso siguiente, que es donde escurre y se seca la capa.
--
-- 0 (el valor por defecto) significa "sin escurrido", así que las recetas que ya
-- existen se comportan exactamente igual que antes.
--
-- IMPORTANTE: la columna por sí sola no cambia nada en la máquina. Hay que
-- volver a flashear el Arduino con el sketch actual (FIRMWARE_VERSION 3), que
-- es donde vive la ejecución de la inmersión.
-- =====================================================

SET @exist_transition_params := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_parameters' AND COLUMN_NAME = 'transition_wait');

SET @sql_transition_params = IF(@exist_transition_params = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN transition_wait INT DEFAULT 0 COMMENT ''Tiempo de escurrido tras la emersión, antes de pasar al siguiente vaso (ms)'' AFTER transfer_wait',
    'SELECT ''Columna transition_wait ya existe en recipe_parameters'' AS message');
PREPARE stmt FROM @sql_transition_params;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- recipe_stages lleva las mismas columnas de parámetros que recipe_parameters:
-- una etapa es una receta encadenada, y si la columna faltara aquí una receta
-- por etapas no podría ajustar el escurrido.
SET @exist_transition_stages := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_stages' AND COLUMN_NAME = 'transition_wait');
SET @exist_tabla_stages := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_stages');

SET @sql_transition_stages = IF(@exist_tabla_stages > 0 AND @exist_transition_stages = 0,
    'ALTER TABLE recipe_stages ADD COLUMN transition_wait INT DEFAULT 0 COMMENT ''Tiempo de escurrido tras la emersión, antes de pasar al siguiente vaso (ms)'' AFTER transfer_wait',
    'SELECT ''Columna transition_wait ya existe o falta recipe_stages'' AS message');
PREPARE stmt FROM @sql_transition_stages;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- El comentario de transfer_wait decía "cambio de posición en Y", que es lo que
-- hizo que se confundiera con la transición. Se corrige para que la columna
-- diga lo que de verdad hace.
SET @sql_comentario_transfer = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_parameters' AND COLUMN_NAME = 'transfer_wait') > 0,
    'ALTER TABLE recipe_parameters MODIFY COLUMN transfer_wait INT DEFAULT 0 COMMENT ''Espera sobre el vaso antes de bajar el sustrato (ms)''',
    'SELECT ''Falta transfer_wait en recipe_parameters'' AS message');
PREPARE stmt FROM @sql_comentario_transfer;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_comentario_transfer_stages = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_stages' AND COLUMN_NAME = 'transfer_wait') > 0,
    'ALTER TABLE recipe_stages MODIFY COLUMN transfer_wait INT DEFAULT 0 COMMENT ''Espera sobre el vaso antes de bajar el sustrato (ms)''',
    'SELECT ''Falta transfer_wait en recipe_stages'' AS message');
PREPARE stmt FROM @sql_comentario_transfer_stages;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migración completada exitosamente' AS resultado;
