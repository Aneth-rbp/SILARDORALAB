@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║        SILAR System - Configuración Inicial          ║
echo ║              Computadora del Laboratorio             ║
echo ╚══════════════════════════════════════════════════════╝
echo.

:: ─── Verificar / Instalar nvm-windows ───────────────────
echo [1/4] Verificando nvm...
where nvm >nul 2>&1
if %errorlevel% neq 0 (
    echo  nvm no encontrado. Descargando e instalando nvm-windows...
    echo.

    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "Invoke-WebRequest -Uri 'https://github.com/coreybutler/nvm-windows/releases/latest/download/nvm-setup.exe' -OutFile '%TEMP%\nvm-setup.exe'"

    if not exist "%TEMP%\nvm-setup.exe" (
        echo  ✖ Error al descargar nvm-setup.exe. Verifica tu conexión a internet.
        pause
        exit /b 1
    )

    echo  Instalando nvm (puede pedir permisos de administrador)...
    "%TEMP%\nvm-setup.exe" /S
    timeout /t 5 /nobreak >nul

    :: Recargar variables de entorno del sistema para esta sesión
    for /f "usebackq tokens=2,*" %%a in (`reg query "HKCU\Environment" /v PATH 2^>nul`) do set "USER_PATH=%%b"
    for /f "usebackq tokens=2,*" %%a in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul`) do set "SYS_PATH=%%b"
    set "PATH=%SYS_PATH%;%USER_PATH%"

    where nvm >nul 2>&1
    if %errorlevel% neq 0 (
        echo  ✖ nvm instalado pero no se puede acceder aún.
        echo    Cierra esta ventana, abre una nueva terminal y vuelve a ejecutar el script.
        pause
        exit /b 1
    )
    echo  ✔ nvm instalado correctamente.
) else (
    for /f "tokens=*" %%v in ('nvm version') do set NVM_VER=%%v
    echo  ✔ nvm %NVM_VER% ya está instalado.
)

:: ─── Instalar Node.js (versión del proyecto vía .nvmrc) ───
echo.
echo [2/4] Instalando Node.js (versión del proyecto)...

:: Leer versión desde .nvmrc
set /p NODE_REQUIRED=<.nvmrc
set NODE_REQUIRED=%NODE_REQUIRED: =%

nvm install %NODE_REQUIRED%
nvm use %NODE_REQUIRED%

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  ✔ Node.js %NODE_VER% instalado y activo.

:: ─── Verificar MySQL (XAMPP) ─────────────────────────────
echo.
echo [3/4] Verificando MySQL...
sc query MySQL >nul 2>&1
if %errorlevel% equ 0 (
    echo  ✔ Servicio MySQL encontrado.
) else (
    echo  ⚠ MySQL no detectado como servicio Windows.
    echo    Asegúrate de que XAMPP esté corriendo con MySQL activo.
)

:: ─── Instalar dependencias npm ───────────────────────────
echo.
echo [4/4] Instalando dependencias del proyecto (puede tardar varios minutos)...
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo  ✖ Error al instalar dependencias.
    pause
    exit /b 1
)

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║  ✔ Setup completado exitosamente!                    ║
echo ║                                                      ║
echo ║  Configura la base de datos:                         ║
echo ║    setup-database.bat                                ║
echo ║                                                      ║
echo ║  Para iniciar el sistema cada día:                   ║
echo ║    iniciar-silar.bat                                 ║
echo ╚══════════════════════════════════════════════════════╝
echo.
pause
