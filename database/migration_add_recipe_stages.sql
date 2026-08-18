-- =====================================================
-- Migración: Recetas por etapas
-- Fecha: 2026-08-18
-- Descripción: Agrega recipes.is_staged y la tabla recipe_stages.
--
-- Una receta por etapas es una sola corrida partida en tramos: 5 ciclos de una
-- manera, luego 6 de otra, luego 15 de otra, sin que el operador tenga que
-- cambiar de receta a mitad del proceso. Cada tramo lleva el juego completo de
-- parámetros de una receta normal.
--
-- Las recetas que ya existen no se tocan: se quedan con is_staged = false y
-- siguen viviendo enteras en recipe_parameters. Una receta por etapas mantiene
-- además su fila en recipe_parameters, pero como resumen calculado (duración
-- total, ciclos totales) para que las pantallas y vistas que ya existen sigan
-- funcionando sin saber de etapas.
-- =====================================================

-- 1. Marca de tipo en recipes
SET @exist_is_staged := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'silar_db' AND TABLE_NAME = 'recipes' AND COLUMN_NAME = 'is_staged');

SET @sql_is_staged = IF(@exist_is_staged = 0,
    'ALTER TABLE recipes ADD COLUMN is_staged BOOLEAN DEFAULT false COMMENT ''true = receta por etapas: su secuencia vive en recipe_stages'' AFTER is_active',
    'SELECT ''Columna is_staged ya existe'' AS message');
PREPARE stmt FROM @sql_is_staged;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Tabla de etapas
CREATE TABLE IF NOT EXISTS recipe_stages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    recipe_id INT NOT NULL,
    stage_order INT NOT NULL COMMENT 'Orden de ejecución de la etapa, empezando en 1',
    name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'Nombre opcional de la etapa',
    duration INT DEFAULT 0 COMMENT 'Duración estimada de la etapa en minutos (calculada)',
    temperature DECIMAL(5,2) DEFAULT 0.0 COMMENT 'Temperatura en °C',
    velocity_x DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Motor X en rpm',
    velocity_y DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Motor Y en rpm',
    accel_x DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Aceleración Motor X en rpm/s',
    accel_y DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Aceleración Motor Y en rpm/s',
    humidity_offset DECIMAL(5,2) DEFAULT 0.0 COMMENT 'Offset de humedad en %',
    temperature_offset DECIMAL(5,2) DEFAULT 0.0 COMMENT 'Offset de temperatura en °C',
    dipping_wait0 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 1 (ms)',
    dipping_wait1 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 2 (ms)',
    dipping_wait2 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 3 (ms)',
    dipping_wait3 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 4 (ms)',
    transfer_wait INT DEFAULT 0 COMMENT 'Tiempo de espera para cambio de posición en Y (ms)',
    cycles INT DEFAULT 1 COMMENT 'Cantidad de ciclos de esta etapa',
    fan BOOLEAN DEFAULT false COMMENT 'Ventilador encendido/apagado',
    except_dripping1 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y1',
    except_dripping2 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y2',
    except_dripping3 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y3',
    except_dripping4 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y4',
    dip_start_position DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición inicial Z con sustrato',
    dipping_length DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Longitud de inmersión de sustrato',
    transfer_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Y cambio de solución, en mm/s',
    dip_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Z inmersión y emersión del sustrato, en mm/s',
    pos_y1 DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición del vaso 1 desde el home de Y, en mm (0 = geometría de la máquina)',
    pos_y2 DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición del vaso 2 desde el home de Y, en mm (0 = geometría de la máquina)',
    pos_y3 DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición del vaso 3 desde el home de Y, en mm (0 = geometría de la máquina)',
    pos_y4 DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición del vaso 4 desde el home de Y, en mm (0 = geometría de la máquina)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    INDEX idx_stage_recipe_id (recipe_id),
    UNIQUE KEY unique_recipe_stage_order (recipe_id, stage_order)
);

-- 3. La vista de recetas ahora expone el tipo y el número de etapas
CREATE OR REPLACE VIEW v_recipes_with_parameters AS
SELECT 
    r.id,
    r.name,
    r.description,
    r.type,
    r.created_at,
    r.updated_at,
    r.created_by_user_id,
    r.is_active,
    r.is_staged,
    (SELECT COUNT(*) FROM recipe_stages s WHERE s.recipe_id = r.id) as stage_count,
    u.full_name as created_by_name,
    u.role as creator_role,
    rp.duration,
    rp.temperature,
    rp.velocity_x,
    rp.velocity_y,
    rp.accel_x,
    rp.accel_y,
    rp.humidity_offset,
    rp.temperature_offset
FROM recipes r
LEFT JOIN users u ON r.created_by_user_id = u.id
LEFT JOIN recipe_parameters rp ON r.id = rp.recipe_id
WHERE r.is_active = 1
ORDER BY r.created_at DESC;

SELECT 'Migración completada exitosamente' AS resultado;
