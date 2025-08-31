@echo off
echo 🛡️ CONFIGURANDO HOOKS DE GIT AUTOMÁTICOS
echo =========================================
echo.

REM Verificar si estamos en un repositorio git
git status >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Error: No estás en un repositorio git
    pause
    exit /b 1
)

REM Crear directorio de hooks si no existe
if not exist ".git\hooks" (
    echo ❌ Error: Directorio de hooks no encontrado
    pause
    exit /b 1
)

echo 📁 Configurando hook de pre-commit...

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

REM Hacer los hooks ejecutables
echo ✅ Hooks configurados exitosamente
echo.
echo 📋 Hooks instalados:
echo   - pre-commit.bat: Verifica conflictos y build
echo   - post-commit.bat: Confirma commit exitoso
echo.
echo 🎯 Ahora cada commit verificará automáticamente:
echo   ✅ Conflictos de merge
echo   ✅ Build del proyecto
echo.
echo 💡 Para hacer commit manual:
echo   - git add .
echo   - git commit -m "tu mensaje"
echo.
echo 💡 Para commit inteligente:
echo   - scripts\smart-commit.bat
echo.
echo 🛡️ HOOKS DE GIT CONFIGURADOS
pause
