-- =====================================================
-- Migración: Agregar configuraciones del sistema
-- Descripción: Agrega las configuraciones necesarias para el panel de administración
-- =====================================================

-- Agregar configuraciones de parámetros del sistema si no existen
INSERT INTO system_config (config_key, config_value, config_type, description, category) VALUES
-- Configuración de reportes
('report_path', 'C:\\SILAR\\Reportes', 'string', 'Dirección para guardar reportes', 'system'),

-- Configuración de velocidades máximas
('max_velocity_y', '1000', 'number', 'Velocidad máxima del eje Y en rpm', 'motion'),
('max_velocity_z', '1000', 'number', 'Velocidad máxima del eje Z en rpm', 'motion'),

-- Configuración de aceleraciones máximas
('max_accel_y', '100', 'number', 'Aceleración máxima del eje Y en rpm/s', 'motion'),
('max_accel_z', '100', 'number', 'Aceleración máxima del eje Z en rpm/s', 'motion'),

-- Configuración de offsets de sensores
('humidity_offset', '0', 'number', 'Offset de calibración del sensor de humedad en %', 'sensors'),
('temperature_offset', '0', 'number', 'Offset de calibración del sensor de temperatura en °C', 'sensors')

ON DUPLICATE KEY UPDATE 
    description = VALUES(description),
    category = VALUES(category);

SELECT 'Migración de configuraciones completada' AS resultado;


