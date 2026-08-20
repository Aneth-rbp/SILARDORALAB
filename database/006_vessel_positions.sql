-- =====================================================
-- Migración: Posición de cada vaso por receta
-- Fecha: 2026-08-18
-- Descripción: Agrega pos_y1..pos_y4 a recipe_parameters.
--
-- Son la posición de cada vaso medida desde el home del eje Y, en mm. La
-- máquina ya tiene su geometría calibrada (CAL_Y_*, guardada en la EEPROM del
-- Arduino); estas cuatro columnas son el ajuste POR RECETA que se pone encima,
-- para un montaje puntual en el que los vasos no están donde suelen.
--
-- Cada vaso va por su cuenta y no como una separación única: los vasos no
-- tienen por qué estar igualmente espaciados, y en cuanto se reubica uno, una
-- separación deja de describir el banco.
--
-- 0 (el valor por defecto) significa "usa la posición calibrada de la máquina",
-- así que las recetas que ya existen se comportan exactamente igual que antes.
-- Como el vaso 1 vive en el home (0 mm) de todas formas, ese 0 no es ambiguo:
-- sale la misma posición por los dos caminos.
-- =====================================================

SET @exist_pos_y1 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_parameters' AND COLUMN_NAME = 'pos_y1');

SET @sql_pos_y1 = IF(@exist_pos_y1 = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN pos_y1 DECIMAL(8,2) DEFAULT 0.0 COMMENT ''Posición del vaso 1 desde el home de Y, en mm (0 = geometría de la máquina)'' AFTER dip_speed',
    'SELECT ''Columna pos_y1 ya existe'' AS message');
PREPARE stmt FROM @sql_pos_y1;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_pos_y2 = IF(@exist_pos_y1 = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN pos_y2 DECIMAL(8,2) DEFAULT 0.0 COMMENT ''Posición del vaso 2 desde el home de Y, en mm (0 = geometría de la máquina)'' AFTER pos_y1',
    'SELECT ''Columna pos_y2 ya existe'' AS message');
PREPARE stmt FROM @sql_pos_y2;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_pos_y3 = IF(@exist_pos_y1 = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN pos_y3 DECIMAL(8,2) DEFAULT 0.0 COMMENT ''Posición del vaso 3 desde el home de Y, en mm (0 = geometría de la máquina)'' AFTER pos_y2',
    'SELECT ''Columna pos_y3 ya existe'' AS message');
PREPARE stmt FROM @sql_pos_y3;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_pos_y4 = IF(@exist_pos_y1 = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN pos_y4 DECIMAL(8,2) DEFAULT 0.0 COMMENT ''Posición del vaso 4 desde el home de Y, en mm (0 = geometría de la máquina)'' AFTER pos_y3',
    'SELECT ''Columna pos_y4 ya existe'' AS message');
PREPARE stmt FROM @sql_pos_y4;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migración completada exitosamente' AS resultado;
