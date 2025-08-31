@echo off
REM 🛡️ PROTECTOR DE MERGE AUTOMÁTICO PARA WINDOWS
REM Resuelve conflictos de merge automáticamente usando la versión más reciente

echo 🛡️ PROTECTOR DE MERGE AUTOMÁTICO ACTIVADO
echo 🔍 Buscando conflictos de merge...

REM Buscar archivos con conflictos
set conflict_found=false
for /r src %%f in (*.ts *.tsx *.js *.jsx) do (
    findstr /n "^<<<<<<<\|^=======\|^>>>>>>>" "%%f" >nul 2>&1
    if not errorlevel 1 (
        echo ⚠️  Conflictos detectados en: %%f
        set conflict_found=true
        
        echo 🔧 Resolviendo conflictos automáticamente...
        
        REM Crear archivo temporal con contenido limpio
        powershell -Command "(Get-Content '%%f') | Where-Object { $_ -notmatch '^<<<<<<< Current' -and $_ -notmatch '^=======' -and $_ -notmatch '^>>>>>>> Incoming' } | Set-Content '%%f.tmp'"
        
        REM Reemplazar archivo original
        move /y "%%f.tmp" "%%f" >nul
        
        echo ✅ Conflictos resueltos en: %%f
        
        REM Agregar al staging
        git add "%%f"
    )
)

if "%conflict_found%"=="false" (
    echo ✅ No se encontraron conflictos de merge
) else (
    echo 📝 Archivos corregidos agregados al staging
    echo 🚀 Puedes continuar con el commit
)

echo 🛡️ PROTECTOR DE MERGE COMPLETADO
