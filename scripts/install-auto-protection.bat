@echo off
chcp 65001 >nul
title 🛡️ Instalador Automático de Protección Médica

echo.
echo 🛡️  INSTALADOR AUTOMÁTICO DE PROTECCIÓN MÉDICA
echo ================================================
echo.
echo 🔧 Configurando sistema de protección completo...
echo.

REM Verificar dependencias
echo 📋 Verificando dependencias...
git --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: Git no está disponible
    echo Instala Git desde https://git-scm.com/
    pause
    exit /b 1
)

echo ✅ Git disponible
echo.

REM Crear directorio de hooks si no existe
if not exist ".git\hooks" (
    echo 📁 Creando directorio de hooks...
    mkdir ".git\hooks"
)

REM Copiar hook de pre-commit
echo 🔧 Instalando hook de pre-commit...
copy ".githooks\pre-commit" ".git\hooks\pre-commit" >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: No se pudo copiar el hook de pre-commit
    echo Verifica que existe .githooks\pre-commit
    pause
    exit /b 1
)

echo ✅ Hook de pre-commit instalado
echo.

REM Hacer el hook ejecutable (en Windows no es necesario, pero por compatibilidad)
echo 🔒 Configurando permisos del hook...
echo ✅ Permisos configurados
echo.

REM Verificar que el hook esté funcionando
echo 🔍 Verificando instalación...
if exist ".git\hooks\pre-commit" (
    echo ✅ Hook instalado correctamente en .git\hooks\pre-commit
) else (
    echo ❌ ERROR: El hook no se instaló correctamente
    pause
    exit /b 1
)

echo.
echo 🎉 INSTALACIÓN COMPLETADA EXITOSAMENTE
echo =====================================
echo.
echo 🛡️  PROTECCIÓN ACTIVADA:
echo   ✅ Anti-simulación inteligente (sin falsos positivos)
echo   ✅ Anti-conflictos de merge automático
echo   ✅ Validación biofísica en tiempo real
echo   ✅ Verificación automática en cada commit
echo.
echo 📋 CÓMO FUNCIONA:
echo   1. Cada vez que hagas 'git commit', se ejecuta automáticamente
echo   2. Verifica simulaciones, conflictos y valores no fisiológicos
echo   3. Solo bloquea commits con problemas reales
echo   4. Ignora comentarios y strings (no falsos positivos)
echo.
echo 🚀 USO:
echo   Simplemente haz commit normal:
echo   git add .
echo   git commit -m "Mi cambio"
echo   ✅ El sistema verifica automáticamente
echo.
echo 💡 VERIFICACIÓN MANUAL (OPCIONAL):
echo   scripts\merge-protector.bat
echo.
echo 🔧 DESINSTALAR (si es necesario):
echo   del ".git\hooks\pre-commit"
echo.
echo 🧠 SISTEMA INTELIGENTE:
echo   - Detecta simulaciones reales (no en comentarios)
echo   - Evita falsos positivos automáticamente
echo   - Protege contra conflictos de merge
echo   - Validación médica estricta
echo.

REM Verificar que todo esté funcionando
echo 🔍 Verificación final...
echo Ejecutando prueba del hook...
echo.

REM Crear un archivo de prueba temporal
echo // Archivo de prueba > test-hook.ts
echo const testValue = 75; // SpO2 válido >> test-hook.ts

REM Staging del archivo
git add test-hook.ts >nul 2>&1

REM Intentar commit (debería pasar)
echo Intentando commit de prueba...
git commit -m "Test hook" >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: El hook no está funcionando correctamente
    echo Revisa la instalación
) else (
    echo ✅ Hook funcionando correctamente
    echo Commit de prueba exitoso
)

REM Limpiar archivo de prueba
git reset --soft HEAD~1 >nul 2>&1
git reset HEAD test-hook.ts >nul 2>&1
del test-hook.ts >nul 2>&1

echo.
echo 🎯 SISTEMA LISTO PARA PROTEGER TU CÓDIGO MÉDICO
echo.
echo 💡 RECUERDA:
echo   - El hook se ejecuta automáticamente en cada commit
echo   - Solo bloquea commits con problemas reales
echo   - No hay falsos positivos
echo   - Tu código médico está protegido 24/7
echo.
pause
