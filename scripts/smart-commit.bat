@echo off
setlocal enabledelayedexpansion

echo 🚀 COMMIT INTELIGENTE CON AUTO-RESOLUCIÓN DE CONFLICTOS
echo ======================================================
echo.

REM Verificar si estamos en un repositorio git
git status >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Error: No estás en un repositorio git
    pause
    exit /b 1
)

REM Verificar si hay cambios para commit
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo ⚠️  No hay cambios en staging para commit
    echo 💡 Agrega archivos con: git add .
    pause
    exit /b 1
)

REM Verificar si hay conflictos de merge
echo 🔍 Verificando conflictos de merge...
git diff --name-only --diff-filter=U > temp_conflicts.txt 2>nul

if %errorlevel% equ 0 (
    echo ⚠️  CONFLICTOS DE MERGE DETECTADOS
    echo.
    echo 📋 Archivos con conflictos:
    type temp_conflicts.txt
    echo.
    
    echo 🔧 Resolviendo conflictos automáticamente...
    
    REM Resolver conflictos automáticamente
    for /f "tokens=*" %%f in (temp_conflicts.txt) do (
        echo 🔧 Resolviendo: %%f
        
        REM Eliminar marcadores de conflicto
        powershell -Command "(Get-Content '%%f') -replace '^<<<<<<< .*$', '' -replace '^=======$', '' -replace '^>>>>>>> .*$', '' | Set-Content '%%f'"
        
        if !errorlevel! equ 0 (
            echo ✅ Resuelto: %%f
            git add "%%f"
        ) else (
            echo ❌ Error en: %%f
        )
    )
    
    echo.
    echo 📝 Archivos resueltos agregados al staging
    del temp_conflicts.txt 2>nul
) else (
    echo ✅ No hay conflictos de merge
)

REM Verificar build antes del commit
echo.
echo 🔨 Verificando build del proyecto...
npm run build >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ ERROR: El build falló
    echo 💡 Corrige los errores antes de hacer commit
    pause
    exit /b 1
)
echo ✅ Build exitoso

REM Mostrar estado final
echo.
echo 📊 Estado final antes del commit:
git status --porcelain

REM Solicitar mensaje de commit
echo.
set /p commit_msg="💬 Mensaje de commit: "
if "!commit_msg!"=="" (
    set commit_msg="Auto-commit con resolución de conflictos"
)

REM Realizar commit
echo.
echo 🚀 Realizando commit...
git commit -m "!commit_msg!"

if %errorlevel% equ 0 (
    echo.
    echo ✅ COMMIT EXITOSO
    echo 📝 Hash: 
    git rev-parse HEAD
    echo.
    echo 🎉 Tu código está ahora en el repositorio
) else (
    echo.
    echo ❌ ERROR en el commit
    echo 💡 Revisa el estado con: git status
)

echo.
echo 🛡️ COMMIT INTELIGENTE COMPLETADO
pause
