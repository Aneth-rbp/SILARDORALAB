-- =====================================================
-- Script de Actualización de Base de Datos SILAR
-- Ejecutar este script para actualizar una base de datos existente
-- =====================================================

USE silar_db;

-- =====================================================
-- Crear tabla de usuarios si no existe
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    role ENUM('admin', 'usuario') DEFAULT 'usuario',
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_username (username),
    INDEX idx_role (role),
    INDEX idx_active (is_active)
);

-- =====================================================
-- Insertar usuarios de ejemplo si no existen
-- =====================================================
INSERT IGNORE INTO users (username, password, full_name, email, role) VALUES
('admin', MD5('admin123'), 'Administrador del Sistema', 'admin@silar.com', 'admin'),
('dr.martinez', MD5('password123'), 'Dr. Juan Martínez', 'juan.martinez@lab.com', 'usuario'),
('dr.garcia', MD5('password123'), 'Dr. María García', 'maria.garcia@lab.com', 'usuario'),
('operador1', MD5('password123'), 'Operador Principal', 'operador@lab.com', 'usuario');

-- =====================================================
-- Actualizar tabla recipes con nuevos campos
-- =====================================================

-- Agregar columna deleted_at si no existe
ALTER TABLE recipes 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL AFTER updated_at;

-- Agregar columna created_by_user_id si no existe
ALTER TABLE recipes 
ADD COLUMN IF NOT EXISTS created_by_user_id INT DEFAULT 1 AFTER deleted_at;

-- Agregar índice para created_by_user_id si no existe
ALTER TABLE recipes 
ADD INDEX IF NOT EXISTS idx_created_by_user (created_by_user_id);

-- Actualizar recetas existentes para asignar created_by_user_id
UPDATE recipes 
SET created_by_user_id = 1 
WHERE created_by_user_id IS NULL OR created_by_user_id = 0;

-- =====================================================
-- Crear tabla de parámetros de recetas
-- =====================================================
CREATE TABLE IF NOT EXISTS recipe_parameters (
    id INT PRIMARY KEY AUTO_INCREMENT,
    recipe_id INT NOT NULL,
    duration INT DEFAULT 0 COMMENT 'Duración en minutos',
    temperature DECIMAL(5,2) DEFAULT 0.0 COMMENT 'Temperatura en °C',
    velocity_x DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Motor X en rpm',
    velocity_y DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Motor Y en rpm',
    accel_x DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Aceleración Motor X en rpm/s',
    accel_y DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Aceleración Motor Y en rpm/s',
    humidity_offset DECIMAL(5,2) DEFAULT 0.0 COMMENT 'Offset de humedad en %',
    temperature_offset DECIMAL(5,2) DEFAULT 0.0 COMMENT 'Offset de temperatura en °C',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    INDEX idx_recipe_id (recipe_id),
    UNIQUE KEY unique_recipe_params (recipe_id)
);

-- =====================================================
-- Migrar datos existentes de JSON a tabla separada
-- =====================================================
INSERT IGNORE INTO recipe_parameters (recipe_id, duration, temperature, velocity_x, velocity_y, accel_x, accel_y, humidity_offset, temperature_offset)
SELECT 
    r.id,
    COALESCE(JSON_EXTRACT(r.parameters, '$.duration'), 0) as duration,
    COALESCE(JSON_EXTRACT(r.parameters, '$.temperature'), 0.0) as temperature,
    COALESCE(JSON_EXTRACT(r.parameters, '$.velocityX'), 0.0) as velocity_x,
    COALESCE(JSON_EXTRACT(r.parameters, '$.velocityY'), 0.0) as velocity_y,
    COALESCE(JSON_EXTRACT(r.parameters, '$.accelX'), 0.0) as accel_x,
    COALESCE(JSON_EXTRACT(r.parameters, '$.accelY'), 0.0) as accel_y,
    COALESCE(JSON_EXTRACT(r.parameters, '$.humidityOffset'), 0.0) as humidity_offset,
    COALESCE(JSON_EXTRACT(r.parameters, '$.temperatureOffset'), 0.0) as temperature_offset
FROM recipes r
WHERE r.parameters IS NOT NULL AND r.parameters != 'null';

-- =====================================================
-- Eliminar columna parameters después de migrar datos
-- =====================================================
-- ALTER TABLE recipes DROP COLUMN parameters;

-- =====================================================
-- Verificar y mostrar resultados
-- =====================================================
SELECT 'Tabla users creada/actualizada' as status;
SELECT COUNT(*) as total_users FROM users;

SELECT 'Tabla recipes actualizada' as status;
SELECT COUNT(*) as total_recipes FROM recipes WHERE is_active = true;

-- Mostrar estructura actualizada
DESCRIBE recipes;
DESCRIBE users;
