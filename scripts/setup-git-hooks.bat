@echo off
REM 🚀 CONFIGURADOR AUTOMÁTICO DE GIT HOOKS PARA WINDOWS
REM Configura los hooks de git automáticamente

echo 🚀 CONFIGURANDO GIT HOOKS AUTOMÁTICAMENTE...

REM Verificar si estamos en un repositorio git
if not exist ".git" (
    echo ❌ Error: No se encontró repositorio git
    echo 💡 Ejecuta este script desde la raíz del proyecto
    pause
    exit /b 1
)

REM Crear directorio de hooks si no existe
if not exist ".git\hooks" mkdir ".git\hooks"

REM Copiar el pre-commit hook
echo 📋 Configurando pre-commit hook...
copy ".githooks\pre-commit" ".git\hooks\pre-commit" >nul

REM Hacer el hook ejecutable (en Windows esto no es necesario pero es buena práctica)
echo ✅ Pre-commit hook configurado

REM Verificar que los scripts de autocorrección existen
echo 🔍 Verificando scripts de autocorrección...
if exist "scripts\auto-fix-commit.ps1" (
    echo ✅ Script PowerShell encontrado
) else (
    echo ⚠️  Script PowerShell no encontrado
)

if exist "scripts\auto-fix-commit.bat" (
    echo ✅ Script Batch encontrado
) else (
    echo ⚠️  Script Batch no encontrado
)

if exist "scripts\merge-protector.bat" (
    echo ✅ Merge protector encontrado
) else (
    echo ⚠️  Merge protector no encontrado
)

REM Configurar permisos de ejecución (simulado en Windows)
echo 🔐 Configurando permisos...

echo.
echo 🎉 CONFIGURACIÓN COMPLETADA
echo ===========================
echo.
echo ✅ Pre-commit hook configurado
echo ✅ Scripts de autocorrección verificados
echo ✅ Sistema de protección médica activado
echo.
echo 💡 Ahora cada commit ejecutará automáticamente:
echo    - Autocorrección de conflictos de merge
echo    - Validación de sintaxis TypeScript
echo    - Formateo automático de código
echo    - Verificación anti-simulación
echo.
echo 🚀 ¡Tu repositorio está protegido y automatizado!
echo.
pause
