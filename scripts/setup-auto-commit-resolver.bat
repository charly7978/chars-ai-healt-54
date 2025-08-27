@echo off
chcp 65001 >nul
echo 🚀 CONFIGURANDO AUTO-COMMIT RESOLVER
echo 🔧 Activando resolución automática de problemas...
echo.

REM Verificar si estamos en un repositorio git
if not exist ".git" (
    echo ❌ ERROR: No estás en un repositorio git
    echo 💡 Navega a tu repositorio y ejecuta este script
    pause
    exit /b 1
)

echo ✅ Repositorio git detectado

REM Crear directorio .git/hooks si no existe
if not exist ".git\hooks" (
    echo 📁 Creando directorio .git/hooks...
    mkdir ".git\hooks"
)

REM Copiar el hook auto-resolver
echo 🔗 Configurando hook pre-commit...
copy ".githooks\pre-commit-auto-resolver" ".git\hooks\pre-commit" >nul

if %errorlevel% equ 0 (
    echo ✅ Hook pre-commit configurado exitosamente
) else (
    echo ❌ ERROR: No se pudo configurar el hook
    echo 💡 Verifica que el archivo .githooks/pre-commit-auto-resolver existe
    pause
    exit /b 1
)

REM Hacer el hook ejecutable (en Windows esto no es necesario, pero por compatibilidad)
echo 🔒 Configurando permisos del hook...

REM Verificar que el hook se configuró correctamente
if exist ".git\hooks\pre-commit" (
    echo ✅ Hook pre-commit configurado correctamente
    echo.
    echo 🎯 CONFIGURACIÓN COMPLETADA
    echo.
    echo 💡 Ahora cada vez que hagas commit:
    echo    1. Se ejecutará automáticamente el resolver
    echo    2. Se resolverán conflictos de merge
    echo    3. Se reemplazarán Math.random() con crypto.getRandomValues()
    echo    4. Se validarán rangos fisiológicos
    echo    5. Se limpiarán componentes obsoletos
    echo    6. Se ejecutará la validación anti-simulación
    echo.
    echo 🚀 ¡Tu repositorio está protegido automáticamente!
    echo.
) else (
    echo ❌ ERROR: El hook no se configuró correctamente
    pause
    exit /b 1
)

REM Probar el resolver automáticamente
echo 🔍 Probando el resolver automático...
echo.
powershell -ExecutionPolicy Bypass -Command "& { Write-Host '🎯 Probando PowerShell...' -ForegroundColor Green }" >nul 2>&1

if %errorlevel% equ 0 (
    echo ✅ PowerShell está funcionando correctamente
    echo.
    echo 🧪 Ejecutando prueba del resolver...
    powershell -ExecutionPolicy Bypass -File "%~dp0auto-commit-resolver.ps1" status
) else (
    echo ⚠️ PowerShell no está disponible - el hook funcionará pero no podrá resolver problemas
    echo 💡 Instala PowerShell para funcionalidad completa
)

echo.
echo 🏁 Configuración completada
echo 💡 Próximos pasos:
echo    1. Haz commit normalmente
echo    2. El resolver se ejecutará automáticamente
echo    3. Si hay problemas, se resolverán automáticamente
echo    4. Tu commit será aprobado para aplicación médica
echo.
pause
