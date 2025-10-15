# Script para habilitar el Modo Desarrollador en Windows
# Esto permite crear enlaces simbólicos sin privilegios de administrador
# DEBE EJECUTARSE COMO ADMINISTRADOR

Write-Host "Habilitando Modo Desarrollador de Windows..." -ForegroundColor Cyan

$RegistryKeyPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock"

if (!(Test-Path -Path $RegistryKeyPath)) {
    New-Item -Path $RegistryKeyPath -ItemType Directory -Force
}

New-ItemProperty -Path $RegistryKeyPath -Name AllowDevelopmentWithoutDevLicense -PropertyType DWORD -Value 1 -Force

Write-Host ""
Write-Host "Modo Desarrollador habilitado exitosamente!" -ForegroundColor Green
Write-Host ""
Write-Host "Ahora puedes ejecutar 'npm run build' sin necesidad de privilegios de administrador." -ForegroundColor Yellow
Write-Host "Presiona cualquier tecla para continuar..."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')

