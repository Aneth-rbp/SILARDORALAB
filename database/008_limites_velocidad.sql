-- =====================================================
-- Migración: Límites de velocidad en mm/s, sin aceleración
-- Fecha: 2026-08-20
-- Descripción: Reemplaza max_velocity_y / max_velocity_z / max_accel_y /
-- max_accel_z por max_transfer_speed y max_dip_speed.
--
-- Los cuatro valores viejos venían de cuando la receta pedía velocidad y
-- aceleración de cada motor en rpm. Esos campos ya no existen: la receta manda
-- al firmware tres velocidades en mm/s (transferencia Y, inmersión Z y emersión
-- Z) y la aceleración la fija el propio firmware (MAX_ACCEL_Y / MAX_ACCEL_Z en
-- SILAR_Control.ino), porque depende de lo que aguanta la mecánica y no de la
-- receta. El panel de administración seguía pidiendo un tope en rpm que nadie
-- leía: se podía bajar a 1 y las recetas seguían corriendo igual de rápido.
--
-- Los dos arrancan en 50 mm/s. No es el tope de la mecánica: el eje Z llega a
-- 100 mm/s (MAX_SPEED_Z de 2000 pasos/s entre los 20 pasos/mm del husillo) y el
-- eje Y se queda en unos 26 (2000 pasos/s entre los 76.36 pasos/mm de la
-- correa), así que 50 deja Z a media velocidad y en Y queda por encima de lo
-- que el eje da: ahí el firmware recorta solo y lo avisa por el puerto serie.
-- Es un valor de arranque cómodo, y el administrador lo ajusta desde
-- Configuración.
-- =====================================================

DELETE FROM system_config WHERE config_key IN ('max_velocity_y', 'max_velocity_z', 'max_accel_y', 'max_accel_z');

INSERT INTO system_config (config_key, config_value, config_type, description, category) VALUES
('max_transfer_speed', '50', 'number', 'Velocidad máxima de transferencia del eje Y en mm/s', 'motion'),
('max_dip_speed', '50', 'number', 'Velocidad máxima del eje Z (inmersión y emersión) en mm/s', 'motion')
ON DUPLICATE KEY UPDATE
    description = VALUES(description),
    category = VALUES(category);

SELECT 'Migración de límites de velocidad completada' AS resultado;
