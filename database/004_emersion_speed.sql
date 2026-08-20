-- =====================================================
-- Migración: Velocidad de emersión independiente
-- Fecha: 2026-08-18
-- Descripción: Agrega emersion_speed a recipe_parameters y a recipe_stages.
--
-- Hasta ahora dip_speed servía para las dos direcciones del eje Z: el sustrato
-- bajaba a la solución y volvía a subir a la misma velocidad. En SILAR la
-- velocidad de emersión es justo la que decide el espesor de la capa que queda
-- adherida, así que tiene que poder ajustarse aparte de la de inmersión.
--
-- 0 (el valor por defecto) significa "usa dip_speed", así que las recetas que
-- ya existen se comportan exactamente igual que antes.
--
-- IMPORTANTE: la columna por sí sola no cambia nada en la máquina. Hay que
-- volver a flashear el Arduino con el sketch actual, que es donde vive la
-- ejecución de la inmersión.
-- =====================================================

SET @exist_emersion_params := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_parameters' AND COLUMN_NAME = 'emersion_speed');

SET @sql_emersion_params = IF(@exist_emersion_params = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN emersion_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT ''Velocidad Z de subida del sustrato, en mm/s (0 = usar dip_speed)'' AFTER dip_speed',
    'SELECT ''Columna emersion_speed ya existe en recipe_parameters'' AS message');
PREPARE stmt FROM @sql_emersion_params;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- recipe_stages lleva las mismas columnas de parámetros que recipe_parameters:
-- una etapa es una receta encadenada, y si la columna faltara aquí una receta
-- por etapas no podría ajustar la emersión.
SET @exist_emersion_stages := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_stages' AND COLUMN_NAME = 'emersion_speed');
SET @exist_tabla_stages := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_stages');

SET @sql_emersion_stages = IF(@exist_tabla_stages > 0 AND @exist_emersion_stages = 0,
    'ALTER TABLE recipe_stages ADD COLUMN emersion_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT ''Velocidad Z de subida del sustrato, en mm/s (0 = usar dip_speed)'' AFTER dip_speed',
    'SELECT ''Columna emersion_speed ya existe o falta recipe_stages'' AS message');
PREPARE stmt FROM @sql_emersion_stages;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migración completada exitosamente' AS resultado;
