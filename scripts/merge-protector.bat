@echo off
echo 🛡️ RESOLVIENDO CONFLICTOS DE MERGE AUTOMÁTICAMENTE...
echo.

REM Verificar si hay conflictos de merge
git diff --name-only --diff-filter=U > temp_conflicts.txt 2>nul
if %errorlevel% neq 0 (
    echo ✅ No hay conflictos de merge activos
    goto :end
)

echo 📋 Archivos con conflictos detectados:
type temp_conflicts.txt
echo.

REM Resolver conflictos automáticamente
for /f "tokens=*" %%f in (temp_conflicts.txt) do (
    echo 🔧 Resolviendo conflicto en: %%f
    
    REM Buscar y eliminar marcadores de conflicto
    powershell -Command "(Get-Content '%%f') -replace '^<<<<<<< .*$', '' -replace '^=======$', '' -replace '^>>>>>>> .*$', '' | Set-Content '%%f'"
    
    if !errorlevel! equ 0 (
        echo ✅ Conflicto resuelto en: %%f
    ) else (
        echo ❌ Error resolviendo: %%f
    )
)

REM Agregar archivos resueltos al staging
echo.
echo 📝 Agregando archivos resueltos al staging...
git add .

REM Verificar estado
echo.
echo 📊 Estado después de resolver conflictos:
git status --porcelain

REM Limpiar archivo temporal
del temp_conflicts.txt 2>nul

echo.
echo ✅ RESOLUCIÓN DE CONFLICTOS COMPLETADA
echo 💡 Ahora puedes continuar con tu commit

:end
pause
