-- =====================================================
-- Migración: Agregar campos de tiempos de inmersión y ciclos
-- Fecha: 2024
-- Descripción: Agrega los campos faltantes a recipe_parameters
-- =====================================================

-- Verificar si las columnas ya existen antes de agregarlas
SET @exist_dipping_wait0 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'silar_db' AND TABLE_NAME = 'recipe_parameters' AND COLUMN_NAME = 'dipping_wait0');
SET @exist_cycles := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'silar_db' AND TABLE_NAME = 'recipe_parameters' AND COLUMN_NAME = 'cycles');

-- Agregar columnas de tiempos de inmersión si no existen
SET @sql_dipping_wait0 = IF(@exist_dipping_wait0 = 0, 
    'ALTER TABLE recipe_parameters ADD COLUMN dipping_wait0 INT DEFAULT 0 COMMENT ''Tiempo de inmersión 1 (ms)'' AFTER temperature_offset',
    'SELECT ''Columna dipping_wait0 ya existe'' AS message');
PREPARE stmt FROM @sql_dipping_wait0;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_dipping_wait1 = IF(@exist_dipping_wait0 = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN dipping_wait1 INT DEFAULT 0 COMMENT ''Tiempo de inmersión 2 (ms)'' AFTER dipping_wait0',
    'SELECT ''Columna dipping_wait1 ya existe'' AS message');
PREPARE stmt FROM @sql_dipping_wait1;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_dipping_wait2 = IF(@exist_dipping_wait0 = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN dipping_wait2 INT DEFAULT 0 COMMENT ''Tiempo de inmersión 3 (ms)'' AFTER dipping_wait1',
    'SELECT ''Columna dipping_wait2 ya existe'' AS message');
PREPARE stmt FROM @sql_dipping_wait2;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_dipping_wait3 = IF(@exist_dipping_wait0 = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN dipping_wait3 INT DEFAULT 0 COMMENT ''Tiempo de inmersión 4 (ms)'' AFTER dipping_wait2',
    'SELECT ''Columna dipping_wait3 ya existe'' AS message');
PREPARE stmt FROM @sql_dipping_wait3;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_transfer_wait = IF(@exist_dipping_wait0 = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN transfer_wait INT DEFAULT 0 COMMENT ''Tiempo de espera para cambio de posición en Y (ms)'' AFTER dipping_wait3',
    'SELECT ''Columna transfer_wait ya existe'' AS message');
PREPARE stmt FROM @sql_transfer_wait;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Agregar columnas de parámetros de proceso si no existen
SET @sql_cycles = IF(@exist_cycles = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN cycles INT DEFAULT 1 COMMENT ''Cantidad de ciclos por prueba'' AFTER transfer_wait',
    'SELECT ''Columna cycles ya existe'' AS message');
PREPARE stmt FROM @sql_cycles;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_fan = IF(@exist_cycles = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN fan BOOLEAN DEFAULT false COMMENT ''Ventilador encendido/apagado'' AFTER cycles',
    'SELECT ''Columna fan ya existe'' AS message');
PREPARE stmt FROM @sql_fan;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_except_dripping1 = IF(@exist_cycles = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN except_dripping1 BOOLEAN DEFAULT false COMMENT ''Excluir inmersión en Y1'' AFTER fan',
    'SELECT ''Columna except_dripping1 ya existe'' AS message');
PREPARE stmt FROM @sql_except_dripping1;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_except_dripping2 = IF(@exist_cycles = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN except_dripping2 BOOLEAN DEFAULT false COMMENT ''Excluir inmersión en Y2'' AFTER except_dripping1',
    'SELECT ''Columna except_dripping2 ya existe'' AS message');
PREPARE stmt FROM @sql_except_dripping2;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_except_dripping3 = IF(@exist_cycles = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN except_dripping3 BOOLEAN DEFAULT false COMMENT ''Excluir inmersión en Y3'' AFTER except_dripping2',
    'SELECT ''Columna except_dripping3 ya existe'' AS message');
PREPARE stmt FROM @sql_except_dripping3;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_except_dripping4 = IF(@exist_cycles = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN except_dripping4 BOOLEAN DEFAULT false COMMENT ''Excluir inmersión en Y4'' AFTER except_dripping3',
    'SELECT ''Columna except_dripping4 ya existe'' AS message');
PREPARE stmt FROM @sql_except_dripping4;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Agregar columnas de posiciones si no existen
SET @exist_dip_start_position := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'silar_db' AND TABLE_NAME = 'recipe_parameters' AND COLUMN_NAME = 'dip_start_position');

SET @sql_dip_start_position = IF(@exist_dip_start_position = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN dip_start_position DECIMAL(8,2) DEFAULT 0.0 COMMENT ''Posición inicial Z con sustrato'' AFTER except_dripping4',
    'SELECT ''Columna dip_start_position ya existe'' AS message');
PREPARE stmt FROM @sql_dip_start_position;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_dipping_length = IF(@exist_dip_start_position = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN dipping_length DECIMAL(8,2) DEFAULT 0.0 COMMENT ''Longitud de inmersión de sustrato'' AFTER dip_start_position',
    'SELECT ''Columna dipping_length ya existe'' AS message');
PREPARE stmt FROM @sql_dipping_length;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_transfer_speed = IF(@exist_dip_start_position = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN transfer_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT ''Velocidad Y cambio de solución'' AFTER dipping_length',
    'SELECT ''Columna transfer_speed ya existe'' AS message');
PREPARE stmt FROM @sql_transfer_speed;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_dip_speed = IF(@exist_dip_start_position = 0,
    'ALTER TABLE recipe_parameters ADD COLUMN dip_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT ''Velocidad Z inmersión sustrato a solución'' AFTER transfer_speed',
    'SELECT ''Columna dip_speed ya existe'' AS message');
PREPARE stmt FROM @sql_dip_speed;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migración completada exitosamente' AS resultado;


