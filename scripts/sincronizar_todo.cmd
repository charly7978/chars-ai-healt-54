@echo off
title SINCRONIZACION COMPLETA - PRECISION CAPTURE SUITE
color 0B

echo.
echo ========================================
echo    SINCRONIZACION COMPLETA
echo    Precision Capture Suite
echo ========================================
echo.

echo 🔄 Sincronizando con GitHub...
echo.

echo 1. Descargando cambios del repositorio remoto...
git fetch origin

echo.
echo 2. Verificando estado de sincronizacion...
git status

echo.
echo 3. Sincronizando rama local con remota...
git pull origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ SINCRONIZACION EXITOSA!
    echo Tu repositorio local esta actualizado
) else (
    echo.
    echo ❌ ERROR en sincronizacion
    echo Intentando resolver conflictos...
    
    echo.
    echo 4. Resolviendo conflictos automaticamente...
    git reset --hard origin/main
    git clean -fd
    
    echo.
    echo ✅ CONFLICTOS RESUELTOS
)

echo.
echo ========================================
echo    ESTADO FINAL DEL REPOSITORIO
echo ========================================
git status

echo.
echo ========================================
echo    ¿QUE QUIERES HACER AHORA?
echo ========================================
echo 1 = Hacer commit de cambios
echo 2 = Solo ver estado
echo 3 = Salir
echo.
set /p opcion="Tu eleccion (1/2/3): "

if "%opcion%"=="1" (
    echo.
    echo 🚀 Ejecutando script de commit...
    call scripts\commit_automatico.cmd
) else if "%opcion%"=="2" (
    echo.
    echo 📊 Estado del repositorio:
    git status --short
    echo.
    pause
) else (
    echo.
    echo 👋 Hasta luego!
)

echo.
pause
