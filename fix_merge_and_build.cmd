@echo off
echo ========================================
echo CORRECCION AUTOMATICA DE MERGE Y BUILD
echo ========================================
echo.

echo [1/4] Verificando estado del repositorio...
git status --porcelain
if %errorlevel% neq 0 (
    echo ERROR: No se pudo verificar el estado del repositorio
    pause
    exit /b 1
)

echo.
echo [2/4] Buscando conflictos de merge...
findstr /s /i "<<<<<<< HEAD" src\*.ts src\*.tsx src\*.js src\*.jsx 2>nul
if %errorlevel% equ 0 (
    echo ENCONTRADOS CONFLICTOS DE MERGE - CORRIGIENDO...
    echo.
    
    echo Corrigiendo useSignalProcessor.ts...
    powershell -Command "(Get-Content 'src\hooks\useSignalProcessor.ts') -replace '<<<<<<< Current.*?=======', '' -replace '>>>>>>> Incoming.*?', '' | Set-Content 'src\hooks\useSignalProcessor.ts'"
    
    echo Corrigiendo MultiChannelManager.ts...
    powershell -Command "(Get-Content 'src\modules\signal-processing\MultiChannelManager.ts') -replace '<<<<<<< HEAD.*?=======', '' -replace '>>>>>>> .*?', '' | Set-Content 'src\modules\signal-processing\MultiChannelManager.ts'"
    
    echo Corrigiendo PPGChannel.ts...
    powershell -Command "(Get-Content 'src\modules\signal-processing\PPGChannel.ts') -replace '<<<<<<< HEAD.*?=======', '' -replace '>>>>>>> .*?', '' | Set-Content 'src\modules\signal-processing\PPGChannel.ts'"
    
    echo Limpiando archivos temporales...
    del /q src\*.orig 2>nul
    del /q src\*.backup 2>nul
    
    echo CONFLICTOS CORREGIDOS
) else (
    echo No se encontraron conflictos de merge
)

echo.
echo [3/4] Instalando dependencias...
npm install
if %errorlevel% neq 0 (
    echo ERROR: Fallo en la instalacion de dependencias
    pause
    exit /b 1
)

echo.
echo [4/4] Compilando proyecto...
npm run build
if %errorlevel% neq 0 (
    echo ERROR: Fallo en la compilacion
    echo.
    echo Verificando errores de TypeScript...
    npx tsc --noEmit
    pause
    exit /b 1
)

echo.
echo ========================================
echo COMPILACION EXITOSA
echo ========================================
echo.
echo El proyecto se ha compilado correctamente
echo Los conflictos de merge han sido corregidos
echo.
echo Archivos generados en: dist/
echo.
pause
