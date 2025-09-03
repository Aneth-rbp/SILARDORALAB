@echo off
echo ========================================
echo Verificando MySQL para SILAR System
echo ========================================

REM Verificar si XAMPP está instalado
if not exist "C:\xampp\mysql\bin\mysql.exe" (
    echo ERROR: XAMPP no encontrado en C:\xampp
    echo Por favor, instala XAMPP desde https://www.apachefriends.org/
    pause
    exit /b 1
)

echo XAMPP encontrado en C:\xampp

REM Verificar si MySQL está ejecutándose
echo Verificando si MySQL está ejecutándose...
mysql -u root -e "SELECT 1;" >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo MySQL no está ejecutándose
    echo.
    echo Para iniciar MySQL:
    echo 1. Abre XAMPP Control Panel
    echo 2. Haz clic en "Start" junto a MySQL
    echo 3. Espera a que el estado cambie a verde
    echo 4. Ejecuta este script nuevamente
    echo.
    echo ¿Quieres abrir XAMPP Control Panel ahora? (S/N)
    set /p choice=
    if /i "%choice%"=="S" (
        start C:\xampp\xampp-control.exe
    )
    pause
    exit /b 1
)

echo MySQL está ejecutándose correctamente

REM Verificar si la base de datos existe
echo Verificando base de datos silar_db...
mysql -u root -e "USE silar_db;" >nul 2>&1
if %errorlevel% neq 0 (
    echo Base de datos silar_db no existe
    echo Ejecutando setup-database.bat...
    call setup-database.bat
    if %errorlevel% neq 0 (
        echo ERROR: No se pudo configurar la base de datos
        pause
        exit /b 1
    )
) else (
    echo Base de datos silar_db encontrada
)

echo.
echo ========================================
echo MySQL está listo para usar
echo ========================================
echo.
echo Puedes ahora ejecutar:
echo - start-dev.bat (para desarrollo)
echo - node server.js (para servidor web)
echo.
pause
