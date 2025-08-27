@echo off
chcp 65001 >nul
echo ACTIVANDO AUTO-COMMIT RESOLVER
echo Configurando resolucion automatica de problemas...
echo.

REM Verificar si estamos en un repositorio git
if not exist ".git" (
    echo ERROR: No estas en un repositorio git
    pause
    exit /b 1
)

echo SUCCESS: Repositorio git detectado
echo.

REM Crear directorio .git/hooks si no existe
if not exist ".git\hooks" (
    echo Creando directorio .git/hooks...
    mkdir ".git\hooks"
)

REM Copiar el hook auto-resolver
echo Configurando hook pre-commit...
copy ".githooks\pre-commit-auto-resolver" ".git\hooks\pre-commit" >nul

if !errorlevel! equ 0 (
    echo SUCCESS: Hook pre-commit configurado exitosamente
) else (
    echo ERROR: No se pudo configurar el hook
    echo Verifica que el archivo .githooks/pre-commit-auto-resolver existe
    pause
    exit /b 1
)

REM Verificar que el hook se configuro correctamente
if exist ".git\hooks\pre-commit" (
    echo SUCCESS: Hook pre-commit configurado correctamente
    echo.
    echo CONFIGURACION COMPLETADA
    echo.
    echo Ahora cada vez que hagas commit:
    echo 1. Se ejecutara automaticamente el resolver
    echo 2. Se resolveran conflictos de merge
    echo 3. Se reemplazaran Math.random() con crypto.getRandomValues()
    echo 4. Se validaran rangos fisiologicos
    echo 5. Se limpiaran componentes obsoletos
    echo 6. Se ejecutara la validacion anti-simulacion
    echo.
    echo Tu repositorio esta protegido automaticamente!
    echo.
) else (
    echo ERROR: El hook no se configuro correctamente
    pause
    exit /b 1
)

REM Probar el resolver automaticamente
echo Probando el resolver automatico...
echo.
powershell -ExecutionPolicy Bypass -Command "& { Write-Host 'Probando PowerShell...' -ForegroundColor Green }" >nul 2>&1

if !errorlevel! equ 0 (
    echo SUCCESS: PowerShell esta funcionando correctamente
    echo.
    echo Ejecutando prueba del resolver...
    scripts\simple-resolver.bat
) else (
    echo WARNING: PowerShell no esta disponible - el hook funcionara pero no podra resolver problemas
    echo Instala PowerShell para funcionalidad completa
)

echo.
echo CONFIGURACION COMPLETADA
echo.
echo Proximos pasos:
echo 1. Haz commit normalmente
echo 2. El resolver se ejecutara automaticamente
echo 3. Si hay problemas, se resolveran automaticamente
echo 4. Tu commit sera aprobado para aplicacion medica
echo.
pause
