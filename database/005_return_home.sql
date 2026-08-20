-- =====================================================
-- Migración: Regresar a home al terminar la receta
-- Fecha: 2026-08-18
-- Descripción: Agrega return_home_at_end a la tabla recipes.
--
-- La bandera es de la receta entera, no de cada etapa: "al terminar la
-- ejecución" quiere decir cuando se acaba la última etapa, así que vale igual
-- para una receta normal y para una por etapas. Por eso vive en `recipes` y no
-- en `recipe_parameters` ni en `recipe_stages`.
--
-- false por defecto: las recetas que ya existen se comportan exactamente como
-- hasta ahora y se quedan donde terminaron.
-- =====================================================

SET @exist_return_home := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipes' AND COLUMN_NAME = 'return_home_at_end');

SET @sql_return_home = IF(@exist_return_home = 0,
    'ALTER TABLE recipes ADD COLUMN return_home_at_end BOOLEAN DEFAULT false COMMENT ''Ejecutar HOME automáticamente al completar la receta'' AFTER is_staged',
    'SELECT ''Columna return_home_at_end ya existe en recipes'' AS message');
PREPARE stmt FROM @sql_return_home;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migración completada exitosamente' AS resultado;
