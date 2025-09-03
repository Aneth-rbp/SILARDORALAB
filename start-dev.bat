@echo off
echo ========================================
echo Iniciando SILAR System - Modo Desarrollo
echo ========================================

REM Verificar si Node.js está instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no está instalado
    echo Por favor, instala Node.js desde https://nodejs.org/
    pause
    exit /b 1
)

REM Verificar si las dependencias están instaladas
if not exist "node_modules" (
    echo Instalando dependencias...
    npm install
    if %errorlevel% neq 0 (
        echo ERROR: No se pudieron instalar las dependencias
        pause
        exit /b 1
    )
)

REM Verificar MySQL y base de datos
echo Verificando MySQL y base de datos...
call check-mysql.bat
if %errorlevel% neq 0 (
    echo ERROR: Problema con MySQL o base de datos
    pause
    exit /b 1
)

echo MySQL y base de datos verificados

REM Iniciar servidor web
echo Iniciando servidor web...
echo.
echo Servidor disponible en: http://localhost:3000
echo.
echo Usuarios de prueba:
echo - admin / admin123
echo - dr.martinez / password123
echo.
echo Presiona Ctrl+C para detener el servidor
echo.

node server.js
