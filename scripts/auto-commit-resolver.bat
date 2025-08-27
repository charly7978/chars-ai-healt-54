@echo off
chcp 65001 >nul
echo 🚀 AUTO-COMMIT RESOLVER - SOLUCIÓN AUTOMÁTICA
echo 🔧 Resolviendo problemas de merge y simulaciones...
echo.

REM Verificar si PowerShell está disponible
powershell -Command "Get-Host" >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ ERROR: PowerShell no está disponible
    echo 💡 Instala PowerShell o usa Windows 10/11
    pause
    exit /b 1
)

REM Ejecutar el script de PowerShell
echo 🎯 Ejecutando resolución automática...
powershell -ExecutionPolicy Bypass -File "%~dp0auto-commit-resolver.ps1" auto-fix

if %errorlevel% equ 0 (
    echo.
    echo ✅ RESOLUCIÓN COMPLETADA EXITOSAMENTE
    echo 🎯 Tu código está listo para commit médico
    echo.
    echo 💡 Próximos pasos:
    echo    1. Revisa los cambios realizados
    echo    2. Haz commit con tu mensaje
    echo    3. El sistema anti-simulación aprobará tu commit
    echo.
) else (
    echo.
    echo ❌ ERROR DURANTE LA RESOLUCIÓN
    echo 🔧 Revisa los errores y ejecuta el script nuevamente
    echo.
)

pause
