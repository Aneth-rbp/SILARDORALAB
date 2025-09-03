@echo off
echo ========================================
echo Configurando Base de Datos SILAR
echo ========================================
echo.

REM Verificar que MySQL esté disponible
echo 1. Verificando conexión a MySQL...
mysql -u root -e "SELECT 1;" >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: No se puede conectar a MySQL
    echo.
    echo Soluciones posibles:
    echo - Asegúrese de que XAMPP esté ejecutándose
    echo - Verifique que el servicio MySQL esté activo
    echo - Compruebe que el puerto 3306 esté disponible
    echo.
    pause
    exit /b 1
)

echo ✅ MySQL está ejecutándose correctamente

REM Crear base de datos si no existe
echo 2. Creando base de datos 'silar_db'...
mysql -u root -e "CREATE DATABASE IF NOT EXISTS silar_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: No se pudo crear la base de datos
    pause
    exit /b 1
)

echo ✅ Base de datos creada exitosamente

REM Ejecutar script de esquema
echo 3. Ejecutando script de esquema...
if not exist "database\schema.sql" (
    echo ❌ ERROR: Archivo database\schema.sql no encontrado
    pause
    exit /b 1
)

mysql -u root silar_db < database\schema.sql
if errorlevel 1 (
    echo ❌ ERROR: No se pudo ejecutar el script de esquema
    pause
    exit /b 1
)

echo ✅ Esquema de base de datos creado exitosamente

REM Verificar tablas creadas
echo 4. Verificando tablas creadas...
mysql -u root silar_db -e "SHOW TABLES;" >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: No se pueden verificar las tablas
    pause
    exit /b 1
)

REM Crear usuarios de prueba si no existen
echo 5. Creando usuarios de prueba...
mysql -u root silar_db -e "INSERT INTO users (username, password, full_name, role) VALUES ('admin', MD5('admin123'), 'Administrador del Sistema', 'admin'), ('dr.martinez', MD5('password123'), 'Dr. Juan Martínez', 'usuario') ON DUPLICATE KEY UPDATE username=username;" >nul 2>&1

echo ✅ Usuarios de prueba creados

REM Verificar configuración
echo 6. Verificando configuración...
mysql -u root silar_db -e "SELECT COUNT(*) as user_count FROM users;" | findstr "0" >nul 2>&1
if errorlevel 1 (
    echo ✅ Configuración verificada correctamente
) else (
    echo ⚠️ ADVERTENCIA: No se encontraron usuarios en la base de datos
)

echo.
echo ========================================
echo ✅ Configuración completada exitosamente
echo ========================================
echo.
echo Usuarios disponibles:
echo - admin / 1234 (Administrador)
echo - investigador1 / 1234 (Investigador)
echo.
echo Configuración de base de datos:
echo - Base de datos: silar_db
echo - Host: localhost
echo - Usuario: root
echo - Puerto: 3306
echo.
echo Para iniciar el servidor:
echo node server.js
echo.
pause
