@echo off
setlocal enabledelayedexpansion

echo 🛡️ INSTALADOR DE PROTECCIÓN AUTOMÁTICA COMPLETA
echo ================================================
echo.

REM Verificar si estamos en un repositorio git
git status >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Error: No estás en un repositorio git
    echo 💡 Ejecuta este script desde la raíz del proyecto
    pause
    exit /b 1
)

echo ✅ Repositorio git detectado
echo.

REM Verificar que estamos en la raíz del proyecto
if not exist "package.json" (
    echo ❌ Error: No se encontró package.json
    echo 💡 Ejecuta este script desde la raíz del proyecto
    pause
    exit /b 1
)

echo ✅ Proyecto Node.js detectado
echo.

REM Crear directorio de hooks si no existe
if not exist ".git\hooks" (
    echo ❌ Error: Directorio de hooks no encontrado
    pause
    exit /b 1
)

echo 📁 Configurando hooks de git...

REM Crear hook de pre-commit
(
echo @echo off
echo echo 🛡️ HOOK PRE-COMMIT ACTIVADO
echo echo 🔍 Verificando código antes del commit...
echo echo.
echo.
echo REM Verificar conflictos de merge
echo git diff --name-only --diff-filter=U ^> temp_conflicts.txt 2^>nul
echo if %%errorlevel%% equ 0 ^(
echo     echo ⚠️  CONFLICTOS DE MERGE DETECTADOS
echo     echo ❌ COMMIT BLOQUEADO - Resuelve los conflictos primero
echo     echo 💡 Ejecuta: scripts\merge-protector.bat
echo     exit /b 1
echo ^)
echo.
echo REM Verificar build
echo echo 🔨 Verificando build del proyecto...
echo npm run build ^>nul 2^>^&1
echo if %%errorlevel%% neq 0 ^(
echo     echo ❌ ERROR: El build falló
echo     echo ❌ COMMIT BLOQUEADO - Corrige los errores primero
echo     exit /b 1
echo ^)
echo.
echo echo ✅ PRE-COMMIT EXITOSO
echo echo 🚀 Continuando con el commit...
) > ".git\hooks\pre-commit.bat"

REM Crear hook de post-commit
(
echo @echo off
echo echo 🎉 HOOK POST-COMMIT ACTIVADO
echo echo 📝 Commit realizado exitosamente
echo echo 💡 Hash: 
echo git rev-parse HEAD
echo echo.
echo echo 🚀 Tu código está ahora en el repositorio
) > ".git\hooks\post-commit.bat"

echo ✅ Hooks configurados
echo.

REM Verificar que los scripts existen
echo 🔍 Verificando scripts de protección...

if exist "scripts\merge-protector.bat" (
    echo ✅ merge-protector.bat encontrado
) else (
    echo ❌ merge-protector.bat no encontrado
)

if exist "scripts\smart-commit.bat" (
    echo ✅ smart-commit.bat encontrado
) else (
    echo ❌ smart-commit.bat no encontrado
)

echo.

REM Probar la configuración
echo 🧪 Probando configuración...

REM Verificar build
echo 🔨 Verificando build del proyecto...
npm run build >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ ERROR: El build falló
    echo 💡 Corrige los errores antes de continuar
    pause
    exit /b 1
)
echo ✅ Build exitoso

REM Verificar hooks
echo 🔍 Verificando hooks...
if exist ".git\hooks\pre-commit.bat" (
    echo ✅ Hook pre-commit instalado
) else (
    echo ❌ Error: Hook pre-commit no se instaló
)

if exist ".git\hooks\post-commit.bat" (
    echo ✅ Hook post-commit instalado
) else (
    echo ❌ Error: Hook post-commit no se instaló
)

echo.
echo 🎉 INSTALACIÓN COMPLETADA EXITOSAMENTE
echo ======================================
echo.
echo 🛡️ Tu repositorio está ahora protegido con:
echo   ✅ Hooks de git automáticos
echo   ✅ Verificación de conflictos de merge
echo   ✅ Verificación de build antes del commit
echo   ✅ Scripts de resolución automática
echo.
echo 💡 COMANDOS DISPONIBLES:
echo   - git add .                    # Agregar cambios
echo   - git commit -m "mensaje"      # Commit manual (con verificación automática)
echo   - scripts\smart-commit.bat     # Commit inteligente con resolución automática
echo   - scripts\merge-protector.bat  # Resolver conflictos manualmente
echo.
echo 🚀 ¡Tu repositorio está protegido y automatizado!
echo.
pause
