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
    is_staged BOOLEAN DEFAULT false COMMENT 'true = receta por etapas: su secuencia vive en recipe_stages',
    -- Bandera de la receta entera, no de cada etapa: aplica cuando termina la
    -- última. Vale igual para una receta normal y para una por etapas.
    return_home_at_end BOOLEAN DEFAULT false COMMENT 'Ejecutar HOME automáticamente al completar la receta',
    
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
    -- Ojo con el nombre: transfer_wait NO es el traslado en Y. Es la espera con el
    -- sustrato ya sobre el vaso, justo antes de bajarlo, así que en la práctica
    -- forma parte de la inmersión. El nombre se conserva por compatibilidad.
    transfer_wait INT DEFAULT 0 COMMENT 'Espera sobre el vaso antes de bajar el sustrato (ms)',
    -- La transición de verdad: el sustrato ya salió de la solución y escurre en
    -- el aire antes de viajar al vaso siguiente. 0 = sin escurrido.
    transition_wait INT DEFAULT 0 COMMENT 'Tiempo de escurrido tras la emersión, antes de pasar al siguiente vaso (ms)',
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
    transfer_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Y cambio de solución, en mm/s',
    dip_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Z de bajada del sustrato a la solución, en mm/s',
    emersion_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Z de subida del sustrato, en mm/s (0 = usar dip_speed)',
    -- Posición de cada vaso desde el home del eje Y. Es el ajuste por receta que
    -- se pone encima de la geometría calibrada de la máquina (CAL_Y_*, en la
    -- EEPROM del Arduino), para un montaje puntual. Van uno a uno porque los
    -- vasos no tienen por qué estar igualmente espaciados. 0 = usar la geometría
    -- de la máquina, que es el caso normal.
    pos_y1 DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición del vaso 1 desde el home de Y, en mm (0 = geometría de la máquina)',
    pos_y2 DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición del vaso 2 desde el home de Y, en mm (0 = geometría de la máquina)',
    pos_y3 DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición del vaso 3 desde el home de Y, en mm (0 = geometría de la máquina)',
    pos_y4 DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición del vaso 4 desde el home de Y, en mm (0 = geometría de la máquina)',
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
-- Tabla de Etapas de Recetas (recetas por etapas)
-- =====================================================
-- Una receta por etapas (recipes.is_staged = true) es una sola corrida
-- compuesta por varios tramos encadenados: 5 ciclos de una manera, luego 6 de
-- otra, luego 15 de otra. Cada fila de esta tabla es un tramo y lleva el juego
-- completo de parámetros de una receta normal, porque el operador tiene que
-- poder cambiar cualquier cosa entre un tramo y el siguiente.
--
-- Las recetas normales no usan esta tabla: siguen viviendo en
-- recipe_parameters, que no se toca. Una receta por etapas SÍ mantiene además
-- su fila en recipe_parameters, pero como resumen calculado (duración total,
-- ciclos totales) para que las pantallas y vistas que ya existen sigan
-- mostrando algo sensato sin saber de etapas.
-- =====================================================
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
    -- Tiempos de inmersión (en milisegundos)
    dipping_wait0 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 1 (ms)',
    dipping_wait1 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 2 (ms)',
    dipping_wait2 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 3 (ms)',
    dipping_wait3 INT DEFAULT 0 COMMENT 'Tiempo de inmersión 4 (ms)',
    -- Ojo con el nombre: transfer_wait NO es el traslado en Y. Es la espera con el
    -- sustrato ya sobre el vaso, justo antes de bajarlo, así que en la práctica
    -- forma parte de la inmersión. El nombre se conserva por compatibilidad.
    transfer_wait INT DEFAULT 0 COMMENT 'Espera sobre el vaso antes de bajar el sustrato (ms)',
    -- La transición de verdad: el sustrato ya salió de la solución y escurre en
    -- el aire antes de viajar al vaso siguiente. 0 = sin escurrido.
    transition_wait INT DEFAULT 0 COMMENT 'Tiempo de escurrido tras la emersión, antes de pasar al siguiente vaso (ms)',
    -- Parámetros de proceso
    cycles INT DEFAULT 1 COMMENT 'Cantidad de ciclos de esta etapa',
    fan BOOLEAN DEFAULT false COMMENT 'Ventilador encendido/apagado',
    except_dripping1 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y1',
    except_dripping2 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y2',
    except_dripping3 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y3',
    except_dripping4 BOOLEAN DEFAULT false COMMENT 'Excluir inmersión en Y4',
    -- Posiciones (opcional)
    dip_start_position DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Posición inicial Z con sustrato',
    dipping_length DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Longitud de inmersión de sustrato',
    transfer_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Y cambio de solución, en mm/s',
    dip_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Z de bajada del sustrato a la solución, en mm/s',
    emersion_speed DECIMAL(8,2) DEFAULT 0.0 COMMENT 'Velocidad Z de subida del sustrato, en mm/s (0 = usar dip_speed)',
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
-- Topes de velocidad de los ejes, en mm/s: es el máximo que el administrador
-- deja pedir en una receta, sobre los mismos campos que van al firmware. La
-- aceleración no se configura aquí: la fija el firmware según lo que aguanta la
-- mecánica (MAX_ACCEL_Y / MAX_ACCEL_Z en SILAR_Control.ino).
('max_transfer_speed', '50', 'number', 'Velocidad máxima de transferencia del eje Y en mm/s', 'motion'),
('max_dip_speed', '50', 'number', 'Velocidad máxima del eje Z (inmersión y emersión) en mm/s', 'motion'),
('humidity_offset', '0', 'number', 'Offset de calibración del sensor de humedad en %', 'sensors'),
('temperature_offset', '0', 'number', 'Offset de calibración del sensor de temperatura en °C', 'sensors')

ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

-- =====================================================
-- Datos de arranque: usuarios
-- =====================================================
-- Solo dos: el administrador y una cuenta de operador. Los ids van explícitos
-- para que las recetas de abajo puedan apuntar a ellos sin adivinar.
--
-- El ON DUPLICATE no toca `password` a propósito: si este archivo se vuelve a
-- correr sobre una base que ya está en uso, no se le resetea la contraseña a
-- nadie. Las de aquí son solo para el primer arranque; cámbialas en el equipo
-- del laboratorio.
INSERT INTO users (id, username, password, full_name, role) VALUES
(1, 'admin', MD5('admin123'), 'Administrador del Sistema', 'admin'),
(2, 'aneth', MD5('aneth123'), 'Aneth', 'usuario')
ON DUPLICATE KEY UPDATE
    username = VALUES(username),
    full_name = VALUES(full_name),
    role = VALUES(role);

-- =====================================================
-- Datos de arranque: recetas de ejemplo
-- =====================================================
-- Dos recetas, una de cada tipo, con valores de un SILAR real y no de relleno:
-- precursor - enjuague - precursor - enjuague en los cuatro vasos.
--
-- Los ids van explícitos porque recipe_parameters y recipe_stages tienen que
-- apuntar a ellos. Volver a correr este archivo reescribe las recetas 1 y 2:
-- son de ejemplo y este archivo es su dueño. Lo que cree el operador entra con
-- id 3 en adelante y no se toca.
INSERT INTO recipes (id, name, description, type, created_by_user_id, is_staged, return_home_at_end) VALUES
(1, 'SILAR estándar (20 ciclos)',
    'Receta normal de referencia: 20 s en precursor, 10 s de enjuague, en los cuatro vasos. Al terminar regresa a home.',
    'A', 1, false, true),
(2, 'SILAR por etapas: nucleación y crecimiento',
    'Receta por etapas: primero 10 ciclos cortos y rápidos para nuclear, luego 30 ciclos largos con emersión lenta y ventilador para crecer la película.',
    'B', 2, true, false)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    type = VALUES(type),
    created_by_user_id = VALUES(created_by_user_id),
    is_staged = VALUES(is_staged),
    return_home_at_end = VALUES(return_home_at_end),
    is_active = true,
    deleted_at = NULL;

-- =====================================================
-- Datos de arranque: parámetros de las recetas
-- =====================================================
-- La receta 1 es normal, así que esta es su configuración de verdad.
--
-- La receta 2 es por etapas y esta fila es su resumen, con la misma forma que
-- calcula buildStagedSummary() en el servidor: duración y ciclos son la suma de
-- las etapas (10+75 min, 10+30 ciclos) y el resto se copia de la primera, que
-- es con lo que arranca la corrida. Sin esta fila la receta saldría con la
-- duración y los ciclos vacíos en el listado, en v_recipes_with_parameters y en
-- el historial de procesos, que leen todos de aquí.
--
-- velocity_* y accel_* van en 0 porque el formulario no los pide: las
-- velocidades que se usan son dip_speed, emersion_speed y transfer_speed. Poner
-- números ahí haría que el ejemplo no se pareciera a lo que guarda la
-- aplicación.
--
-- duration está en minutos y sale de la misma fórmula que el formulario:
-- (esperas + 3 transferencias + 4 inmersiones de bajada y subida) x ciclos.
INSERT INTO recipe_parameters (recipe_id, duration, temperature, velocity_x, velocity_y, accel_x, accel_y, humidity_offset, temperature_offset,
    dipping_wait0, dipping_wait1, dipping_wait2, dipping_wait3, transfer_wait, transition_wait,
    cycles, fan, except_dripping1, except_dripping2, except_dripping3, except_dripping4,
    dip_start_position, dipping_length, transfer_speed, dip_speed, emersion_speed,
    pos_y1, pos_y2, pos_y3, pos_y4) VALUES
-- Receta 1: 103 s por ciclo x 20 ciclos = 34.3 min -> 35
(1, 35, 25.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    20000, 10000, 20000, 10000, 1000, 0,
    20, false, false, false, false, false,
    0.0, 50.0, 20.0, 10.0, 10.0,
    0.0, 0.0, 0.0, 0.0),
-- Receta 2: resumen de sus dos etapas (10+75 min, 10+30 ciclos)
(2, 85, 25.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    10000, 5000, 10000, 5000, 1000, 0,
    40, false, false, false, false, false,
    0.0, 50.0, 20.0, 15.0, 15.0,
    0.0, 0.0, 0.0, 0.0)
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
    transition_wait = VALUES(transition_wait),
    cycles = VALUES(cycles),
    fan = VALUES(fan),
    except_dripping1 = VALUES(except_dripping1),
    except_dripping2 = VALUES(except_dripping2),
    except_dripping3 = VALUES(except_dripping3),
    except_dripping4 = VALUES(except_dripping4),
    dip_start_position = VALUES(dip_start_position),
    dipping_length = VALUES(dipping_length),
    transfer_speed = VALUES(transfer_speed),
    dip_speed = VALUES(dip_speed),
    emersion_speed = VALUES(emersion_speed),
    pos_y1 = VALUES(pos_y1),
    pos_y2 = VALUES(pos_y2),
    pos_y3 = VALUES(pos_y3),
    pos_y4 = VALUES(pos_y4);

-- =====================================================
-- Datos de arranque: etapas de la receta 2
-- =====================================================
-- Se ejecutan seguidas en una sola corrida, sin home ni pausa entre una y otra.
-- El home solo se hace al final, y solo si la receta lo pide
-- (recipes.return_home_at_end), que en esta está apagado.
--
-- La diferencia entre las dos etapas es la que se busca en un SILAR: la
-- nucleación quiere muchos ciclos cortos y rápidos para sembrar la superficie,
-- y el crecimiento quiere inmersiones largas con emersión lenta (5 mm/s contra
-- los 8 mm/s de bajada) para arrastrar más solución y engrosar la película.
INSERT INTO recipe_stages (recipe_id, stage_order, name, duration, temperature, velocity_x, velocity_y, accel_x, accel_y,
    humidity_offset, temperature_offset,
    dipping_wait0, dipping_wait1, dipping_wait2, dipping_wait3, transfer_wait, transition_wait,
    cycles, fan, except_dripping1, except_dripping2, except_dripping3, except_dripping4,
    dip_start_position, dipping_length, transfer_speed, dip_speed, emersion_speed,
    pos_y1, pos_y2, pos_y3, pos_y4) VALUES
-- Nucleación: 59.7 s por ciclo x 10 ciclos = 9.9 min -> 10
(2, 1, 'Nucleación', 10, 25.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    10000, 5000, 10000, 5000, 1000, 0,
    10, false, false, false, false, false,
    0.0, 50.0, 20.0, 15.0, 15.0,
    0.0, 0.0, 0.0, 0.0),
-- Crecimiento: 149.5 s por ciclo x 30 ciclos = 74.8 min -> 75
(2, 2, 'Crecimiento', 75, 25.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    30000, 10000, 30000, 10000, 1500, 0,
    30, true, false, false, false, false,
    0.0, 50.0, 15.0, 8.0, 5.0,
    0.0, 0.0, 0.0, 0.0)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
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
    transition_wait = VALUES(transition_wait),
    cycles = VALUES(cycles),
    fan = VALUES(fan),
    except_dripping1 = VALUES(except_dripping1),
    except_dripping2 = VALUES(except_dripping2),
    except_dripping3 = VALUES(except_dripping3),
    except_dripping4 = VALUES(except_dripping4),
    dip_start_position = VALUES(dip_start_position),
    dipping_length = VALUES(dipping_length),
    transfer_speed = VALUES(transfer_speed),
    dip_speed = VALUES(dip_speed),
    emersion_speed = VALUES(emersion_speed),
    pos_y1 = VALUES(pos_y1),
    pos_y2 = VALUES(pos_y2),
    pos_y3 = VALUES(pos_y3),
    pos_y4 = VALUES(pos_y4);

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
