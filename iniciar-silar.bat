@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║         SILAR System - Actualizar e Iniciar          ║
echo ╚══════════════════════════════════════════════════════╝
echo.

:: ─── Bajar cambios de GitHub ─────────────────────────────
echo [1/2] Descargando última versión desde GitHub...
git pull
if %errorlevel% neq 0 (
    echo.
    echo  ✖ Error al descargar actualizaciones.
    echo    Verifica tu conexión a internet o las credenciales de GitHub.
    pause
    exit /b 1
)
echo  ✔ Código actualizado.

:: ─── Iniciar servidor ────────────────────────────────────
echo.
echo [2/2] Iniciando servidor SILAR...
echo.
echo  Accede al sistema en: http://localhost:3001
echo  Cierra esta ventana para detener el servidor.
echo.
echo ──────────────────────────────────────────────────────
echo.
node server.js
