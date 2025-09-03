-- =====================================================
-- SILAR System Database Setup - Simplified Version
-- =====================================================

-- Crear base de datos
CREATE DATABASE IF NOT EXISTS silar_db;
USE silar_db;

-- Tabla de Usuarios
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role ENUM('admin', 'usuario') NOT NULL,
    email VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabla de Recetas (actualizada con relación a usuarios)
CREATE TABLE IF NOT EXISTS recipes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type ENUM('A', 'B', 'C', 'D') DEFAULT 'A',
    parameters JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by_user_id INT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabla de Procesos Ejecutados
CREATE TABLE IF NOT EXISTS processes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    recipe_id INT NOT NULL,
    process_number VARCHAR(50) NOT NULL,
    status ENUM('pending', 'running', 'paused', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
    start_time TIMESTAMP NULL,
    end_time TIMESTAMP NULL,
    duration_minutes INT DEFAULT 0,
    parameters JSON,
    results JSON,
    error_message TEXT,
    operator_name VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);

-- Tabla de Variables del Sistema
CREATE TABLE IF NOT EXISTS system_variables (
    id INT PRIMARY KEY AUTO_INCREMENT,
    process_id INT,
    variable_name VARCHAR(100) NOT NULL,
    variable_value DECIMAL(10,4),
    variable_unit VARCHAR(20),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE
);

-- Tabla de Configuración del Sistema
CREATE TABLE IF NOT EXISTS system_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value TEXT,
    config_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    description TEXT,
    category VARCHAR(50) DEFAULT 'general',
    is_editable BOOLEAN DEFAULT true,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(100) DEFAULT 'system'
);

-- Tabla de Logs del Sistema
CREATE TABLE IF NOT EXISTS system_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    process_id INT NULL,
    log_level ENUM('debug', 'info', 'warning', 'error', 'critical') DEFAULT 'info',
    source VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    details JSON,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT,
    
    FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE SET NULL
);

-- Insertar configuración básica
INSERT INTO system_config (config_key, config_value, config_type, description, category) VALUES
('arduino_port', 'AUTO', 'string', 'Puerto serie del Arduino', 'arduino'),
('arduino_baudrate', '9600', 'number', 'Velocidad de comunicación', 'arduino'),
('system_name', 'SILAR v2.0', 'string', 'Nombre del sistema', 'general'),
('max_process_duration', '180', 'number', 'Duración máxima en minutos', 'safety')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

-- Insertar usuarios de prueba
-- Contraseña por defecto: 1234 (hash MD5 simple para demo)
INSERT INTO users (username, password, full_name, role, email) VALUES
('admin', MD5('1234'), 'Administrador del Sistema', 'admin', 'admin@dora.lab'),
('investigador1', MD5('1234'), 'Dr. Juan Martínez', 'usuario', 'martinez@dora.lab')
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

-- Insertar recetas de ejemplo (vinculadas a usuarios)
INSERT INTO recipes (name, description, type, parameters, created_by_user_id) VALUES
('Receta Estándar A', 'Proceso estándar para materiales tipo A', 'A', JSON_OBJECT(
    'duration', 60,
    'temperature', 25.0,
    'velocityX', 100.0,
    'velocityY', 100.0,
    'accelX', 10.0,
    'accelY', 10.0,
    'humidityOffset', 0.0,
    'temperatureOffset', 0.0
), 1),
('Receta Rápida B', 'Proceso rápido para materiales tipo B', 'B', JSON_OBJECT(
    'duration', 30,
    'temperature', 30.0,
    'velocityX', 150.0,
    'velocityY', 150.0,
    'accelX', 15.0,
    'accelY', 15.0,
    'humidityOffset', 2.0,
    'temperatureOffset', 1.0
), 2),
('Receta Experimental C', 'Proceso experimental del Dr. Martínez', 'C', JSON_OBJECT(
    'duration', 90,
    'temperature', 22.5,
    'velocityX', 75.0,
    'velocityY', 80.0,
    'accelX', 8.0,
    'accelY', 9.0,
    'humidityOffset', -0.5,
    'temperatureOffset', 0.2
), 2),
('Receta Técnico Especializada', 'Receta creada por técnico especializado', 'D', JSON_OBJECT(
    'duration', 45,
    'temperature', 28.0,
    'velocityX', 120.0,
    'velocityY', 110.0,
    'accelX', 12.0,
    'accelY', 11.0,
    'humidityOffset', 1.0,
    'temperatureOffset', -0.3
), 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);
