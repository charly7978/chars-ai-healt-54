@echo off
chcp 65001 >nul
title 🛡️ Merge Conflict Protector

:menu
cls
echo.
echo 🛡️  MERGE CONFLICT PROTECTOR
echo =============================
echo.
echo 1. Verificar conflictos
echo 2. Resolver conflictos
echo 3. Verificar build
echo 4. Salir
echo.
set /p choice="Selecciona una opción (1-4): "

if "%choice%"=="1" goto check
if "%choice%"=="2" goto fix
if "%choice%"=="3" goto build
if "%choice%"=="4" goto exit
goto menu

:check
cls
echo 🔍 VERIFICANDO CONFLICTOS DE MERGE...
echo =====================================
echo.

set "conflicts=0"
for /r "src" %%f in (*.ts *.tsx) do (
    findstr /n "^<<<<<<<" "%%f" >nul 2>&1
    if not errorlevel 1 (
        echo ❌ CONFLICTO EN: %%f
        set /a conflicts+=1
    )
)

if %conflicts%==0 (
    echo ✅ NO SE ENCONTRARON CONFLICTOS
    echo ✅ El proyecto está limpio
) else (
    echo.
    echo 🚨 SE ENCONTRARON %conflicts% ARCHIVOS CON CONFLICTOS
    echo 💡 Ejecuta la opción 2 para resolverlos automáticamente
)

echo.
pause
goto menu

:fix
cls
echo 🔧 RESOLVIENDO CONFLICTOS AUTOMÁTICAMENTE...
echo ============================================
echo.

set "fixed=0"
for /r "src" %%f in (*.ts *.tsx) do (
    findstr /n "^<<<<<<<" "%%f" >nul 2>&1
    if not errorlevel 1 (
        echo 🔧 Resolviendo: %%f
        
        REM Crear archivo temporal
        set "temp=%%f.tmp"
        
        REM Filtrar líneas sin marcadores de conflicto
        (
            for /f "usebackq delims=" %%l in ("%%f") do (
                set "line=%%l"
                echo !line! | findstr /c:"<<<<<<<" >nul 2>&1
                if errorlevel 1 (
                    echo !line! | findstr /c:"=======" >nul 2>&1
                    if errorlevel 1 (
                        echo !line! | findstr /c:">>>>>>>" >nul 2>&1
                        if errorlevel 1 (
                            echo !line!
                        )
                    )
                )
            )
        ) > "!temp!"
        
        REM Reemplazar archivo
        move /y "!temp!" "%%f" >nul 2>&1
        set /a fixed+=1
        echo   ✅ Resuelto
    )
)

if %fixed%==0 (
    echo ✅ NO HAY CONFLICTOS QUE RESOLVER
) else (
    echo.
    echo 🎯 SE RESOLVIERON %fixed% ARCHIVOS
    echo 💡 Ahora ejecuta la opción 3 para verificar el build
)

echo.
pause
goto menu

:build
cls
echo 🔨 VERIFICANDO BUILD DEL PROYECTO...
echo ====================================
echo.

echo Ejecutando: npm run build
echo.
npm run build

if errorlevel 1 (
    echo.
    echo ❌ BUILD FALLÓ
    echo 💡 Revisa los errores y ejecuta la opción 2 si hay conflictos
) else (
    echo.
    echo ✅ BUILD EXITOSO
    echo 🎉 El proyecto está listo para commit
)

echo.
pause
goto menu

:exit
cls
echo.
echo 🛡️  Merge Conflict Protector - Cerrando
echo =======================================
echo.
echo 💡 RECUERDA: Siempre verifica antes de hacer commit
echo.
pause
exit
