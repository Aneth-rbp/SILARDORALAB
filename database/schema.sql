-- =====================================================
-- SILAR System Database Schema
-- Base de datos local MySQL para el sistema SILAR
-- =====================================================

CREATE DATABASE IF NOT EXISTS silar_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE silar_db;

-- Asegurar UTF-8 en la conexión
SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci';
SET CHARACTER SET utf8mb4;

-- =====================================================
-- Tabla de Usuarios
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
    password VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    full_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    email VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
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
-- Tabla de Recetas
-- =====================================================
CREATE TABLE IF NOT EXISTS recipes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    description TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
    type ENUM('A', 'B', 'C', 'D') DEFAULT 'A',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    created_by_user_id INT DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    
    INDEX idx_name (name),
    INDEX idx_type (type),
    INDEX idx_created_at (created_at),
    INDEX idx_active (is_active),
    INDEX idx_created_by_user (created_by_user_id)
);

-- =====================================================
-- Tabla de Parámetros de Recetas
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
    -- Tiempos de inmersión (en milisegundos)
    dipping_wait0 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 1 (ms)',
    dipping_wait1 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 2 (ms)',
    dipping_wait2 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 3 (ms)',
    dipping_wait3 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 4 (ms)',
    transfer_wait INT DEFAULT 0 COMMENT 'Tiempo de espera para cambio de posición en Y (ms)',
    -- Parámetros de proceso
    cycles INT DEFAULT 1 COMMENT 'Cantidad de ciclos por prueba',
    fan BOOLEAN DEFAULT false COMMENT 'Ventilador encendido/apagado',
    except_dripping1 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y1',
    except_dripping2 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y2',
    except_dripping3 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y3',
    except_dripping4 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y4',
    -- Posiciones (opcional)
    dip_start_position DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición inicial Z con sustrato',
    dipping_length DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Longitud de inmersión de sustrato',
    transfer_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Y cambio de solución',
    dip_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Z inmersión sustrato a solución',
    -- Variables Pendiente (COMENTADAS - No implementadas aún)
    -- set_temp1 DECIMAL(5,2) DEFAULT 0.0 COMMENT '*Pendiente* Configura la temperatura deseada en la parrilla 1',
    -- set_temp2 DECIMAL(5,2) DEFAULT 0.0 COMMENT '*Pendiente* Configura la temperatura deseada en la parrilla 2',
    -- set_temp3 DECIMAL(5,2) DEFAULT 0.0 COMMENT '*Pendiente* Configura la temperatura deseada en la parrilla 3',
    -- set_temp4 DECIMAL(5,2) DEFAULT 0.0 COMMENT '*Pendiente* Configura la temperatura deseada en la parrilla 4',
    -- set_stirr1 DECIMAL(8,2) DEFAULT 0.0 COMMENT '*Pendiente* Configura la velocidad del removedor en la parrilla 1',
    -- set_stirr2 DECIMAL(8,2) DEFAULT 0.0 COMMENT '*Pendiente* Configura la velocidad del removedor en la parrilla 2',
    -- set_stirr3 DECIMAL(8,2) DEFAULT 0.0 COMMENT '*Pendiente* Configura la velocidad del removedor en la parrilla 3',
    -- set_stirr4 DECIMAL(8,2) DEFAULT 0.0 COMMENT '*Pendiente* Configura la velocidad del removedor en la parrilla 4',
    -- meas_temp1 DECIMAL(5,2) DEFAULT 0.0 COMMENT '*Pendiente* Lectura de temperatura de la solución 1',
    -- meas_temp2 DECIMAL(5,2) DEFAULT 0.0 COMMENT '*Pendiente* Lectura de temperatura de la solución 2',
    -- meas_temp3 DECIMAL(5,2) DEFAULT 0.0 COMMENT '*Pendiente* Lectura de temperatura de la solución 3',
    -- meas_temp4 DECIMAL(5,2) DEFAULT 0.0 COMMENT '*Pendiente* Lectura de temperatura de la solución 4',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    INDEX idx_recipe_id (recipe_id),
    UNIQUE KEY unique_recipe_params (recipe_id)
);

-- =====================================================
-- Tabla de Procesos Ejecutados
-- =====================================================
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
    
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    INDEX idx_recipe_id (recipe_id),
    INDEX idx_status (status),
    INDEX idx_start_time (start_time),
    INDEX idx_process_number (process_number),
    UNIQUE KEY unique_process_number (process_number)
);

-- =====================================================
-- Tabla de Variables del Sistema (Tiempo Real)
-- =====================================================
CREATE TABLE IF NOT EXISTS system_variables (
    id INT PRIMARY KEY AUTO_INCREMENT,
    process_id INT,
    variable_name VARCHAR(100) NOT NULL,
    variable_value DECIMAL(10,4),
    variable_unit VARCHAR(20),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE,
    INDEX idx_process_id (process_id),
    INDEX idx_variable_name (variable_name),
    INDEX idx_timestamp (timestamp)
);

-- =====================================================
-- Tabla de Configuración del Sistema
-- =====================================================
CREATE TABLE IF NOT EXISTS system_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value TEXT,
    config_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    description TEXT,
    category VARCHAR(50) DEFAULT 'general',
    is_editable BOOLEAN DEFAULT true,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(100) DEFAULT 'system',
    
    INDEX idx_category (category),
    INDEX idx_config_key (config_key)
);

-- =====================================================
-- Tabla de Logs del Sistema
-- =====================================================
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
    
    FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE SET NULL,
    INDEX idx_process_id (process_id),
    INDEX idx_log_level (log_level),
    INDEX idx_source (source),
    INDEX idx_timestamp (timestamp)
);

-- =====================================================
-- Tabla de Eventos del Arduino
-- =====================================================
CREATE TABLE IF NOT EXISTS arduino_events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    process_id INT NULL,
    event_type VARCHAR(50) NOT NULL,
    command_sent TEXT,
    response_received TEXT,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE SET NULL,
    INDEX idx_process_id (process_id),
    INDEX idx_event_type (event_type),
    INDEX idx_timestamp (timestamp),
    INDEX idx_success (success)
);

-- =====================================================
-- Insertar Configuración por Defecto
-- =====================================================
INSERT INTO system_config (config_key, config_value, config_type, description, category) VALUES
-- Configuración de Arduino
('arduino_port', 'AUTO', 'string', 'Puerto serie del Arduino (AUTO para detección automática)', 'arduino'),
('arduino_baudrate', '9600', 'number', 'Velocidad de comunicación con Arduino', 'arduino'),
('arduino_timeout', '5000', 'number', 'Timeout de comunicación en millisegundos', 'arduino'),

-- Configuración del Sistema
('system_name', 'SILAR v2.0', 'string', 'Nombre del sistema', 'general'),
('max_process_duration', '180', 'number', 'Duración máxima de proceso en minutos', 'safety'),
('auto_backup_enabled', 'true', 'boolean', 'Activar respaldo automático de datos', 'backup'),
('backup_interval_hours', '24', 'number', 'Intervalo de respaldo en horas', 'backup'),

-- Configuración de Interfaz
('touch_button_size', 'large', 'string', 'Tamaño de botones táctiles (small, medium, large)', 'ui'),
('theme_color', 'blue', 'string', 'Color principal del tema', 'ui'),
('show_advanced_controls', 'false', 'boolean', 'Mostrar controles avanzados', 'ui'),

-- Configuración de Seguridad
('emergency_stop_enabled', 'true', 'boolean', 'Habilitar parada de emergencia', 'safety'),
('confirmation_dialogs', 'true', 'boolean', 'Mostrar diálogos de confirmación', 'safety'),
('operator_login_required', 'false', 'boolean', 'Requerir login de operador', 'security'),

-- Configuración de Monitoreo
('data_logging_enabled', 'true', 'boolean', 'Activar registro de datos', 'monitoring'),
('log_retention_days', '30', 'number', 'Días de retención de logs', 'monitoring'),
('variable_update_interval', '1000', 'number', 'Intervalo de actualización de variables en ms', 'monitoring'),

-- Configuración de Parámetros del Sistema (Panel de Administración)
('report_path', 'C:\\SILAR\\Reportes', 'string', 'Dirección para guardar reportes', 'system'),
('max_velocity_y', '1000', 'number', 'Velocidad máxima del eje Y en rpm', 'motion'),
('max_velocity_z', '1000', 'number', 'Velocidad máxima del eje Z en rpm', 'motion'),
('max_accel_y', '100', 'number', 'Aceleración máxima del eje Y en rpm/s', 'motion'),
('max_accel_z', '100', 'number', 'Aceleración máxima del eje Z en rpm/s', 'motion'),
('humidity_offset', '0', 'number', 'Offset de calibración del sensor de humedad en %', 'sensors'),
('temperature_offset', '0', 'number', 'Offset de calibración del sensor de temperatura en °C', 'sensors')

ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

-- =====================================================
-- Insertar Usuarios de Ejemplo
-- =====================================================
INSERT INTO users (username, password, full_name, email, role) VALUES
('admin', MD5('admin123'), 'Administrador del Sistema', 'admin@silar.com', 'admin'),
('dr.martinez', MD5('password123'), 'Dr. Juan Martínez', 'juan.martinez@lab.com', 'usuario'),
('dr.garcia', MD5('password123'), 'Dr. María García', 'maria.garcia@lab.com', 'usuario'),
('operador1', MD5('password123'), 'Operador Principal', 'operador@lab.com', 'usuario')
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

-- =====================================================
-- Insertar Recetas de Ejemplo
-- =====================================================
INSERT INTO recipes (name, description, type, created_by_user_id) VALUES
('Receta Estándar A', 'Proceso estándar para materiales tipo A', 'A', 1),
('Receta Rápida B', 'Proceso rápido para materiales tipo B', 'B', 2),
('Receta Lenta C', 'Proceso lento y controlado para materiales sensibles', 'C', 3),
('Receta Experimental D', 'Receta para pruebas y desarrollo', 'D', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- =====================================================
-- Insertar Parámetros de Recetas de Ejemplo
-- =====================================================
INSERT INTO recipe_parameters (recipe_id, duration, temperature, velocity_x, velocity_y, accel_x, accel_y, humidity_offset, temperature_offset,
    dipping_wait0, dipping_wait1, dipping_wait2, dipping_wait3, transfer_wait,
    cycles, fan, except_dripping1, except_dripping2, except_dripping3, except_dripping4,
    dip_start_position, dipping_length, transfer_speed, dip_speed) VALUES
(1, 60, 25.0, 100.0, 100.0, 10.0, 10.0, 0.0, 0.0, 5000, 5000, 5000, 5000, 2000, 10, false, false, false, false, false, 0.0, 50.0, 10.0, 5.0),
(2, 30, 30.0, 150.0, 150.0, 15.0, 15.0, 2.0, 1.0, 3000, 3000, 3000, 3000, 1500, 5, true, false, false, false, false, 0.0, 40.0, 15.0, 7.0),
(3, 120, 20.0, 50.0, 50.0, 5.0, 5.0, -1.0, -0.5, 10000, 10000, 10000, 10000, 3000, 20, false, true, false, false, false, 0.0, 60.0, 5.0, 3.0),
(4, 90, 28.0, 120.0, 80.0, 12.0, 8.0, 1.5, 0.5, 7000, 7000, 7000, 7000, 2500, 15, true, false, true, false, false, 0.0, 45.0, 12.0, 6.0)
ON DUPLICATE KEY UPDATE 
    duration = VALUES(duration),
    temperature = VALUES(temperature),
    velocity_x = VALUES(velocity_x),
    velocity_y = VALUES(velocity_y),
    accel_x = VALUES(accel_x),
    accel_y = VALUES(accel_y),
    humidity_offset = VALUES(humidity_offset),
    temperature_offset = VALUES(temperature_offset),
    dipping_wait0 = VALUES(dipping_wait0),
    dipping_wait1 = VALUES(dipping_wait1),
    dipping_wait2 = VALUES(dipping_wait2),
    dipping_wait3 = VALUES(dipping_wait3),
    transfer_wait = VALUES(transfer_wait),
    cycles = VALUES(cycles),
    fan = VALUES(fan),
    except_dripping1 = VALUES(except_dripping1),
    except_dripping2 = VALUES(except_dripping2),
    except_dripping3 = VALUES(except_dripping3),
    except_dripping4 = VALUES(except_dripping4),
    dip_start_position = VALUES(dip_start_position),
    dipping_length = VALUES(dipping_length),
    transfer_speed = VALUES(transfer_speed),
    dip_speed = VALUES(dip_speed);

-- =====================================================
-- Crear Vistas para Consultas Comunes
-- =====================================================

-- Vista de procesos con información de receta
CREATE OR REPLACE VIEW v_processes_with_recipes AS
SELECT 
    p.id,
    p.process_number,
    p.status,
    p.start_time,
    p.end_time,
    p.duration_minutes,
    p.operator_name,
    p.notes,
    r.name as recipe_name,
    r.type as recipe_type,
    r.description as recipe_description,
    p.created_at
FROM processes p
LEFT JOIN recipes r ON p.recipe_id = r.id
ORDER BY p.created_at DESC;



-- Vista de recetas con parámetros
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

-- Vista de estadísticas del sistema
CREATE OR REPLACE VIEW v_system_stats AS
SELECT 
    (SELECT COUNT(*) FROM recipes WHERE is_active = true) as total_recipes,
    (SELECT COUNT(*) FROM processes WHERE status = 'running') as active_processes,
    (SELECT COUNT(*) FROM processes WHERE status = 'completed' AND DATE(start_time) = CURDATE()) as completed_today,
    (SELECT COUNT(*) FROM processes WHERE status = 'failed' AND DATE(start_time) = CURDATE()) as failed_today,
    (SELECT AVG(duration_minutes) FROM processes WHERE status = 'completed' AND start_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as avg_duration_7days;

-- =====================================================
-- Procedimientos Almacenados
-- =====================================================

DELIMITER //

-- Procedimiento para iniciar un nuevo proceso
CREATE PROCEDURE IF NOT EXISTS sp_start_process(
    IN p_recipe_id INT,
    IN p_operator_name VARCHAR(100),
    IN p_notes TEXT,
    OUT p_process_id INT,
    OUT p_process_number VARCHAR(50)
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- Generar número de proceso único
    SET p_process_number = CONCAT('PROC-', DATE_FORMAT(NOW(), '%Y%m%d'), '-', LPAD(LAST_INSERT_ID(), 4, '0'));
    
    -- Insertar nuevo proceso
    INSERT INTO processes (recipe_id, process_number, status, operator_name, notes, parameters)
    SELECT recipe_id, p_process_number, 'pending', p_operator_name, p_notes, parameters
    FROM recipes WHERE id = p_recipe_id;
    
    SET p_process_id = LAST_INSERT_ID();
    
    -- Log del evento
    INSERT INTO system_logs (process_id, log_level, source, message)
    VALUES (p_process_id, 'info', 'system', CONCAT('Proceso creado: ', p_process_number));
    
    COMMIT;
END //

-- Procedimiento para finalizar proceso
CREATE PROCEDURE IF NOT EXISTS sp_complete_process(
    IN p_process_id INT,
    IN p_results JSON,
    IN p_notes TEXT
)
BEGIN
    DECLARE v_start_time TIMESTAMP;
    DECLARE v_duration INT DEFAULT 0;
    
    -- Obtener tiempo de inicio
    SELECT start_time INTO v_start_time 
    FROM processes 
    WHERE id = p_process_id;
    
    -- Calcular duración si hay tiempo de inicio
    IF v_start_time IS NOT NULL THEN
        SET v_duration = TIMESTAMPDIFF(MINUTE, v_start_time, NOW());
    END IF;
    
    -- Actualizar proceso
    UPDATE processes 
    SET 
        status = 'completed',
        end_time = NOW(),
        duration_minutes = v_duration,
        results = p_results,
        notes = CONCAT(IFNULL(notes, ''), IF(notes IS NOT NULL AND p_notes IS NOT NULL, '\n', ''), IFNULL(p_notes, ''))
    WHERE id = p_process_id;
    
    -- Log del evento
    INSERT INTO system_logs (process_id, log_level, source, message)
    VALUES (p_process_id, 'info', 'system', CONCAT('Proceso completado en ', v_duration, ' minutos'));
END //

-- Procedimiento para limpiar datos antiguos
CREATE PROCEDURE IF NOT EXISTS sp_cleanup_old_data(
    IN p_days_to_keep INT
)
BEGIN
    DECLARE v_deleted_logs INT DEFAULT 0;
    DECLARE v_deleted_variables INT DEFAULT 0;
    DECLARE v_deleted_events INT DEFAULT 0;
    
    -- Limpiar logs antiguos
    DELETE FROM system_logs 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL p_days_to_keep DAY);
    SET v_deleted_logs = ROW_COUNT();
    
    -- Limpiar variables de procesos completados antiguos
    DELETE sv FROM system_variables sv
    INNER JOIN processes p ON sv.process_id = p.id
    WHERE p.status IN ('completed', 'failed', 'cancelled') 
    AND p.end_time < DATE_SUB(NOW(), INTERVAL p_days_to_keep DAY);
    SET v_deleted_variables = ROW_COUNT();
    
    -- Limpiar eventos de Arduino antiguos
    DELETE FROM arduino_events 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL p_days_to_keep DAY);
    SET v_deleted_events = ROW_COUNT();
    
    -- Log de limpieza
    INSERT INTO system_logs (log_level, source, message, details)
    VALUES ('info', 'cleanup', 'Limpieza automática completada', JSON_OBJECT(
        'deleted_logs', v_deleted_logs,
        'deleted_variables', v_deleted_variables,
        'deleted_events', v_deleted_events,
        'days_kept', p_days_to_keep
    ));
END //

DELIMITER ;

-- =====================================================
-- Triggers para Auditoría
-- =====================================================

DELIMITER //

-- Trigger para auditar cambios en recetas
CREATE TRIGGER IF NOT EXISTS tr_recipes_audit 
AFTER UPDATE ON recipes
FOR EACH ROW
BEGIN
    INSERT INTO system_logs (log_level, source, message, details)
    VALUES ('info', 'audit', 'Receta modificada', JSON_OBJECT(
        'recipe_id', NEW.id,
        'recipe_name', NEW.name,
        'old_name', OLD.name,
        'new_name', NEW.name,
        'old_type', OLD.type,
        'new_type', NEW.type
    ));
END //

-- Trigger para auditar cambios de estado en procesos
CREATE TRIGGER IF NOT EXISTS tr_processes_status_audit 
AFTER UPDATE ON processes
FOR EACH ROW
BEGIN
    IF OLD.status != NEW.status THEN
        INSERT INTO system_logs (process_id, log_level, source, message, details)
        VALUES (NEW.id, 'info', 'process', 'Cambio de estado de proceso', JSON_OBJECT(
            'old_status', OLD.status,
            'new_status', NEW.status,
            'process_number', NEW.process_number
        ));
    END IF;
END //

DELIMITER ;

-- =====================================================
-- Índices para Optimización
-- =====================================================

-- Índices compuestos para consultas comunes
CREATE INDEX IF NOT EXISTS idx_processes_status_date ON processes(status, start_time);
CREATE INDEX IF NOT EXISTS idx_variables_process_time ON system_variables(process_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_level_time ON system_logs(log_level, timestamp);

-- =====================================================
-- Comentarios Finales
-- =====================================================

-- Optimizar tablas
OPTIMIZE TABLE recipes, processes, system_variables, system_config, system_logs, arduino_events;

-- Analizar tablas para optimizar consultas
ANALYZE TABLE recipes, processes, system_variables, system_config, system_logs, arduino_events;
