-- Script para verificar y corregir la codificación UTF-8 en la base de datos
-- Ejecutar: mysql -u root silar_db < fix-utf8-encoding.sql

-- Verificar la codificación actual de la base de datos
SHOW CREATE DATABASE silar_db;

-- Verificar la codificación de las tablas
SELECT 
    TABLE_NAME,
    TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'silar_db';

-- Verificar la codificación de las columnas de texto
SELECT 
    TABLE_NAME,
    COLUMN_NAME,
    CHARACTER_SET_NAME,
    COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'silar_db' 
    AND CHARACTER_SET_NAME IS NOT NULL;

-- Corregir la codificación de la base de datos si es necesario
ALTER DATABASE silar_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Corregir la codificación de todas las tablas
ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE recipes CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE recipe_parameters CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE process_runs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE process_data CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Verificar que los cambios se aplicaron correctamente
SELECT 
    TABLE_NAME,
    TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'silar_db';


