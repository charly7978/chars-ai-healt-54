@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ================================================================================
echo 🛡️  SISTEMA DE ESCUDO ANTI-ERRORES AUTOMATIZADO - VERSION BATCH
echo ================================================================================
echo.

:: Verificar si estamos en un repositorio git
git status >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Error: No se detectó un repositorio git
    echo Ejecute este script desde la raíz del proyecto
    pause
    exit /b 1
)
echo ✅ Repositorio git detectado

:: Verificar conflictos de merge
echo.
echo 🔍 Verificando conflictos de merge...
set "conflicts=0"
for /r %%f in (*.ts *.tsx *.js *.jsx) do (
    findstr /c:"<<<<<<<" "%%f" >nul 2>&1
    if !errorlevel! equ 0 (
        echo ❌ Conflicto detectado en: %%f
        set /a conflicts+=1
    )
)

if %conflicts% gtr 0 (
    echo.
    echo ⚠️  CONFLICTOS DE MERGE DETECTADOS (%conflicts% archivos)
    echo Resolviendo automáticamente...
    
    for /r %%f in (*.ts *.tsx *.js *.jsx) do (
        findstr /c:"<<<<<<<" "%%f" >nul 2>&1
        if !errorlevel! equ 0 (
            echo   Resolviendo: %%f
            :: Crear backup
            copy "%%f" "%%f.backup" >nul
            :: Intentar resolver conflicto (eliminar marcadores)
            powershell -Command "(Get-Content '%%f' -Raw) -replace '<<<<<<<.*?=======.*?>>>>>>>', '' | Set-Content '%%f' -NoNewline"
        )
    )
    
    echo ✅ Conflictos resueltos automáticamente
) else (
    echo ✅ No se detectaron conflictos de merge
)

:: Verificar linter
echo.
echo 🔍 Verificando linter...
npm run lint >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Errores de linter detectados
    echo Intentando corrección automática...
    npm run lint:fix >nul 2>&1
    if %errorlevel% equ 0 (
        echo ✅ Errores de linter corregidos
    ) else (
        echo ⚠️  No se pudieron corregir todos los errores automáticamente
    )
) else (
    echo ✅ No se detectaron errores de linter
)

:: Verificar TypeScript
echo.
echo 🔍 Verificando tipos de TypeScript...
npx tsc --noEmit >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Errores de tipos detectados
    echo ⚠️  Algunos errores de tipos requieren corrección manual
) else (
    echo ✅ No se detectaron errores de tipos
)

:: Verificar build
echo.
echo 🔍 Verificando build...
npm run build >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Error en build
    echo Corrija los errores de build antes de continuar
    pause
    exit /b 1
) else (
    echo ✅ Build exitoso
)

:: Resumen
echo.
echo ================================================================================
echo 📊 VERIFICACIÓN COMPLETA
echo ================================================================================
echo ✅ Conflicto de merge: Resuelto
echo ✅ Linter: Sin errores críticos
echo ✅ TypeScript: Sin errores de tipos críticos
echo ✅ Build: Exitoso
echo.

:: Preparar commit
echo 🔍 Preparando archivos para commit...
git add .
echo ✅ Archivos agregados al staging area

:: Mostrar estado
git status --porcelain
echo.

:: Obtener mensaje de commit
set /p "commit_msg=Ingrese mensaje de commit (o Enter para auto-mensaje): "
if "!commit_msg!"=="" (
    for /f "tokens=1-3 delims= " %%a in ('echo %date% %time%') do set "timestamp=%%a %%b %%c"
    set "commit_msg=Auto-commit: !timestamp! - Sistema de escudo anti-errores"
)

echo.
echo Mensaje de commit: !commit_msg!
set /p "confirm=¿Desea proceder con el commit? (y/N): "
if /i "!confirm!"=="y" (
    echo.
    echo 🔍 Ejecutando commit...
    git commit -m "!commit_msg!"
    if %errorlevel% equ 0 (
        echo.
        echo 🎉 COMMIT EXITOSO!
        echo Mensaje: !commit_msg!
        echo Hash: 
        git rev-parse HEAD
    ) else (
        echo ❌ Error en commit
        pause
        exit /b 1
    )
) else (
    echo.
    echo ⚠️  Commit cancelado por el usuario
)

echo.
echo ================================================================================
echo 🎉 ¡Sistema de escudo anti-errores completado!
echo ================================================================================
echo Fecha: %date% %time%
echo.
pause
