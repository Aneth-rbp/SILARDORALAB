@echo off
echo ========================================
echo Configurando Base de Datos SILAR
echo ========================================

REM Verificar si MySQL está ejecutándose
echo Verificando servicio MySQL...
sc query mysql >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: MySQL no está ejecutándose
    echo Por favor, inicia MySQL desde XAMPP Control Panel
    pause
    exit /b 1
)

echo MySQL está ejecutándose correctamente

REM Crear base de datos si no existe
echo Creando base de datos silar_db...
mysql -u root -e "CREATE DATABASE IF NOT EXISTS silar_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

if %errorlevel% neq 0 (
    echo ERROR: No se pudo crear la base de datos
    echo Verifica que MySQL esté ejecutándose y las credenciales sean correctas
    pause
    exit /b 1
)

echo Base de datos creada exitosamente

REM Ejecutar script de esquema
echo Ejecutando script de esquema...
mysql -u root silar_db < database/schema.sql

if %errorlevel% neq 0 (
    echo ERROR: No se pudo ejecutar el script de esquema
    echo Verifica que el archivo database/schema.sql existe
    pause
    exit /b 1
)

echo Esquema de base de datos creado exitosamente

REM Verificar tablas creadas
echo Verificando tablas creadas...
mysql -u root silar_db -e "SHOW TABLES;"

echo.
echo ========================================
echo Configuración completada exitosamente
echo ========================================
echo.
echo Usuarios por defecto:
echo - admin / admin123 (Administrador)
echo - dr.martinez / password123 (Investigador)
echo - dr.garcia / password123 (Investigador)
echo - operador1 / password123 (Operador)
echo.
echo Base de datos: silar_db
echo Host: localhost
echo Usuario: root
echo.
pause
