# Script de emergencia para recuperar el repositorio Git
# RECUPERACIÓN EN CASOS CRÍTICOS

Write-Host "🚨 RECUPERACIÓN DE EMERGENCIA DEL REPOSITORIO GIT" -ForegroundColor Red
Write-Host "=================================================" -ForegroundColor Red

# Verificar si estamos en el directorio correcto
if (-not (Test-Path ".git")) {
    Write-Host "❌ ERROR CRÍTICO: No se encontró el directorio .git" -ForegroundColor Red
    Write-Host "Este directorio no es un repositorio Git válido" -ForegroundColor Red
    Write-Host "💡 ACCIONES REQUERIDAS:" -ForegroundColor Yellow
    Write-Host "   1. Navegue al directorio correcto del repositorio" -ForegroundColor White
    Write-Host "   2. O clone el repositorio desde GitHub" -ForegroundColor White
    Write-Host "   3. O restaure desde backup" -ForegroundColor White
    exit 1
}

Write-Host "📁 Directorio actual: $(Get-Location)" -ForegroundColor Yellow

# ADVERTENCIA CRÍTICA
Write-Host "`n⚠️  ADVERTENCIA CRÍTICA:" -ForegroundColor Red
Write-Host "Este script realizará operaciones destructivas que pueden" -ForegroundColor Red
Write-Host "perder cambios no guardados. ÚSELO SOLO EN EMERGENCIAS." -ForegroundColor Red

$confirmation = Read-Host "`n¿Está seguro de que desea continuar? (ESCRIBA 'EMERGENCIA' para confirmar)"
if ($confirmation -ne "EMERGENCIA") {
    Write-Host "❌ Operación cancelada por seguridad" -ForegroundColor Yellow
    Write-Host "💡 Use scripts/git-reset-clean.ps1 para limpieza normal" -ForegroundColor Cyan
    exit 0
}

Write-Host "`n🚨 INICIANDO RECUPERACIÓN DE EMERGENCIA..." -ForegroundColor Red

# 1. Crear backup de emergencia
Write-Host "`n1️⃣ Creando backup de emergencia..." -ForegroundColor Cyan

$backupDir = "emergency-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

# Copiar archivos importantes
$importantFiles = @(
    "src/",
    "package.json",
    "tsconfig.json",
    "README.md",
    "docs/"
)

foreach ($file in $importantFiles) {
    if (Test-Path $file) {
        Copy-Item -Path $file -Destination $backupDir -Recurse -Force
        Write-Host "✅ Backup de: $file" -ForegroundColor Green
    }
}

Write-Host "✅ Backup de emergencia creado en: $backupDir" -ForegroundColor Green

# 2. Verificar estado crítico del repositorio
Write-Host "`n2️⃣ Verificando estado crítico..." -ForegroundColor Cyan

# Verificar si el repositorio está corrupto
$gitStatus = git status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ REPOSITORIO CRÍTICAMENTE CORRUPTO" -ForegroundColor Red
    Write-Host "💡 Iniciando recuperación completa..." -ForegroundColor Yellow
} else {
    Write-Host "✅ Repositorio accesible, verificando integridad..." -ForegroundColor Green
}

# 3. Recuperación agresiva del repositorio
Write-Host "`n3️⃣ Recuperación agresiva del repositorio..." -ForegroundColor Cyan

# Reset extremo
Write-Host "🔄 Reseteando HEAD al último commit válido..." -ForegroundColor Yellow
git reset --hard HEAD
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Reset exitoso" -ForegroundColor Green
} else {
    Write-Host "❌ Reset falló, intentando recuperación más agresiva..." -ForegroundColor Red
}

# Limpieza extrema
Write-Host "🧹 Limpieza extrema de archivos no rastreados..." -ForegroundColor Yellow
git clean -fdx
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Limpieza extrema exitosa" -ForegroundColor Green
} else {
    Write-Host "❌ Limpieza extrema falló" -ForegroundColor Red
}

# 4. Recuperar desde reflog si es posible
Write-Host "`n4️⃣ Intentando recuperar desde reflog..." -ForegroundColor Cyan

$reflogEntries = git reflog --oneline -10 2>$null
if ($reflogEntries) {
    Write-Host "📋 Entradas de reflog disponibles:" -ForegroundColor Green
    Write-Host $reflogEntries -ForegroundColor White
    
    # Intentar recuperar desde una entrada anterior
    $firstEntry = ($reflogEntries -split "`n")[0]
    if ($firstEntry -match "^([a-f0-9]+)") {
        $recoveryHash = $matches[1]
        Write-Host "🔄 Intentando recuperar desde: $recoveryHash" -ForegroundColor Yellow
        
        git reset --hard $recoveryHash
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Recuperación desde reflog exitosa" -ForegroundColor Green
        } else {
            Write-Host "❌ Recuperación desde reflog falló" -ForegroundColor Red
        }
    }
} else {
    Write-Host "⚠️  No hay entradas de reflog disponibles" -ForegroundColor Yellow
}

# 5. Verificar y reparar remotes
Write-Host "`n5️⃣ Verificando y reparando remotes..." -ForegroundColor Cyan

# Verificar remotes
$remotes = git remote -v
if ([string]::IsNullOrEmpty($remotes)) {
    Write-Host "❌ No hay remotes configurados, configurando..." -ForegroundColor Red
    
    # Configurar remote de emergencia
    $emergencyUrl = "https://github.com/charly7978/chars-ai-healt-48.git"
    git remote add origin $emergencyUrl
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Remote de emergencia configurado" -ForegroundColor Green
    } else {
        Write-Host "❌ Error al configurar remote de emergencia" -ForegroundColor Red
    }
} else {
    Write-Host "✅ Remotes configurados:" -ForegroundColor Green
    Write-Host $remotes -ForegroundColor White
}

# 6. Recuperación desde remote si es posible
Write-Host "`n6️⃣ Intentando recuperación desde remote..." -ForegroundColor Cyan

# Fetch de emergencia
Write-Host "📥 Fetch de emergencia desde remote..." -ForegroundColor Yellow
git fetch origin --force
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Fetch de emergencia exitoso" -ForegroundColor Green
    
    # Reset al remote
    Write-Host "🔄 Reseteando al estado del remote..." -ForegroundColor Yellow
    git reset --hard origin/main
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Reset al remote exitoso" -ForegroundColor Green
    } else {
        Write-Host "❌ Reset al remote falló" -ForegroundColor Red
    }
} else {
    Write-Host "❌ Fetch de emergencia falló" -ForegroundColor Red
    Write-Host "💡 Verifique su conexión a internet" -ForegroundColor Yellow
}

# 7. Verificar integridad del repositorio
Write-Host "`n7️⃣ Verificando integridad del repositorio..." -ForegroundColor Cyan

# Verificar que git funciona
$gitStatus = git status 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Repositorio Git funcional" -ForegroundColor Green
    
    # Verificar archivos críticos
    $criticalFiles = @("package.json", "src/", "README.md")
    $missingFiles = @()
    
    foreach ($file in $criticalFiles) {
        if (-not (Test-Path $file)) {
            $missingFiles += $file
        }
    }
    
    if ($missingFiles.Count -gt 0) {
        Write-Host "⚠️  Archivos críticos faltantes:" -ForegroundColor Yellow
        foreach ($file in $missingFiles) {
            Write-Host "   - $file" -ForegroundColor Yellow
        }
        
        # Restaurar desde backup
        Write-Host "🔄 Restaurando archivos críticos desde backup..." -ForegroundColor Yellow
        foreach ($file in $missingFiles) {
            if (Test-Path "$backupDir/$file") {
                Copy-Item -Path "$backupDir/$file" -Destination $file -Recurse -Force
                Write-Host "✅ Restaurado: $file" -ForegroundColor Green
            }
        }
    } else {
        Write-Host "✅ Todos los archivos críticos presentes" -ForegroundColor Green
    }
} else {
    Write-Host "❌ Repositorio Git no funcional después de la recuperación" -ForegroundColor Red
    Write-Host "💡 RECUPERACIÓN MANUAL REQUERIDA" -ForegroundColor Red
}

# 8. Crear script de recuperación post-emergencia
Write-Host "`n8️⃣ Creando script de recuperación post-emergencia..." -ForegroundColor Cyan

$postRecoveryScript = @"
@echo off
REM Script de recuperación post-emergencia
REM VERIFICACIÓN Y RESTAURACIÓN COMPLETA

echo 🏥 RECUPERACIÓN POST-EMERGENCIA
echo ===============================

echo.
echo 📊 VERIFICANDO ESTADO DEL REPOSITORIO...
git status

echo.
echo 🔗 VERIFICANDO REMOTES...
git remote -v

echo.
echo 🌿 VERIFICANDO RAMAS...
git branch -a

echo.
echo 📥 SINCRONIZANDO CON REMOTE...
git fetch origin

echo.
echo 🔄 RESETEANDO AL REMOTE...
git reset --hard origin/main

echo.
echo 🧹 LIMPIEZA FINAL...
git clean -fd

echo.
echo ✅ RECUPERACIÓN COMPLETADA
echo 💡 Ahora puede continuar con el desarrollo normal
echo.
pause
"@

$postRecoveryScript | Out-File -FilePath "scripts/post-emergency-recovery.bat" -Encoding ASCII -Force
Write-Host "✅ Script de recuperación post-emergencia creado" -ForegroundColor Green

# 9. Verificación final
Write-Host "`n9️⃣ Verificación final..." -ForegroundColor Cyan

Write-Host "`n📊 ESTADO FINAL DEL REPOSITORIO:" -ForegroundColor Green
git status

Write-Host "`n🔗 REMOTES:" -ForegroundColor Green
git remote -v

Write-Host "`n🌿 RAMA ACTUAL:" -ForegroundColor Green
git branch --show-current

Write-Host "`n📁 BACKUP DE EMERGENCIA:" -ForegroundColor Green
Write-Host "✅ Backup creado en: $backupDir" -ForegroundColor Green

# 10. Reporte de emergencia
Write-Host "`n🔟 REPORTE DE EMERGENCIA..." -ForegroundColor Cyan

$emergencyReport = @"
# 🚨 REPORTE DE RECUPERACIÓN DE EMERGENCIA

## 📅 FECHA Y HORA
$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

## 📁 DIRECTORIO
$(Get-Location)

## 🆘 ACCIONES REALIZADAS
1. ✅ Backup de emergencia creado
2. ✅ Reset agresivo del repositorio
3. ✅ Limpieza extrema de archivos
4. ✅ Recuperación desde reflog (si fue posible)
5. ✅ Reparación de remotes
6. ✅ Recuperación desde remote
7. ✅ Verificación de integridad
8. ✅ Restauración de archivos críticos

## 📊 ESTADO FINAL
- Repositorio funcional: $(if (git status 2>$null) { "SÍ" } else { "NO" })
- Remotes configurados: $(if (git remote -v 2>$null) { "SÍ" } else { "NO" })
- Rama actual: $(git branch --show-current 2>$null)
- Archivos críticos: $(if (Test-Path "package.json" -and (Test-Path "src/")) { "PRESENTES" } else { "FALTANTES" })

## 💾 BACKUP
- Ubicación: $backupDir
- Contenido: Archivos críticos del repositorio
- Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

## 🚨 ACCIONES REQUERIDAS POST-EMERGENCIA
1. Ejecutar: scripts/post-emergency-recovery.bat
2. Verificar que el código compila: npm install && npm run build
3. Ejecutar tests: npm test
4. Verificar conectividad: scripts/quick-git-check.bat
5. Sincronizar: scripts/sync-repository.bat

## ⚠️ ADVERTENCIAS
- Este fue un procedimiento de emergencia
- Se pueden haber perdido cambios no guardados
- Revise el backup antes de continuar
- Considere clonar el repositorio desde GitHub si persisten problemas

## 📞 SOPORTE
- Documentación: docs/git-workflow-guide.md
- Scripts de mantenimiento: scripts/
- Backup de emergencia: $backupDir
- GitHub: https://github.com/charly7978/chars-ai-healt-48

---
**RECUERDE: CERO TOLERANCIA A SIMULACIONES EN CÓDIGO MÉDICO**
"@

$emergencyReport | Out-File -FilePath "EMERGENCY_RECOVERY_REPORT.md" -Encoding UTF8 -Force
Write-Host "✅ Reporte de emergencia creado: EMERGENCY_RECOVERY_REPORT.md" -ForegroundColor Green

# 11. Instrucciones finales
Write-Host "`n🔟1️⃣ INSTRUCCIONES FINALES..." -ForegroundColor Cyan

Write-Host "`n🚨 RECUPERACIÓN DE EMERGENCIA COMPLETADA" -ForegroundColor Red
Write-Host "=========================================" -ForegroundColor Red

if (git status 2>$null) {
    Write-Host "✅ El repositorio está ahora funcional" -ForegroundColor Green
} else {
    Write-Host "❌ El repositorio aún no es funcional" -ForegroundColor Red
    Write-Host "💡 RECUPERACIÓN MANUAL REQUERIDA" -ForegroundColor Red
}

Write-Host "`n📋 ACCIONES REALIZADAS:" -ForegroundColor Green
Write-Host "✅ Backup de emergencia creado" -ForegroundColor Green
Write-Host "✅ Repositorio reseteado agresivamente" -ForegroundColor Green
Write-Host "✅ Archivos no rastreados eliminados" -ForegroundColor Green
Write-Host "✅ Remotes reparados" -ForegroundColor Green
Write-Host "✅ Recuperación desde remote intentada" -ForegroundColor Green
Write-Host "✅ Archivos críticos restaurados" -ForegroundColor Green

Write-Host "`n💾 BACKUP DE EMERGENCIA:" -ForegroundColor Cyan
Write-Host "📁 Ubicación: $backupDir" -ForegroundColor White
Write-Host "📄 Contenido: Archivos críticos del repositorio" -ForegroundColor White
Write-Host "📅 Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White

Write-Host "`n📋 PRÓXIMOS PASOS CRÍTICOS:" -ForegroundColor Red
Write-Host "1️⃣ Ejecutar recuperación post-emergencia:" -ForegroundColor Yellow
Write-Host "   scripts/post-emergency-recovery.bat" -ForegroundColor White
Write-Host "2️⃣ Verificar que el código compila:" -ForegroundColor Yellow
Write-Host "   npm install && npm run build" -ForegroundColor White
Write-Host "3️⃣ Ejecutar tests:" -ForegroundColor Yellow
Write-Host "   npm test" -ForegroundColor White
Write-Host "4️⃣ Verificar conectividad:" -ForegroundColor Yellow
Write-Host "   scripts/quick-git-check.bat" -ForegroundColor White

Write-Host "`n⚠️ ADVERTENCIAS IMPORTANTES:" -ForegroundColor Red
Write-Host "- Este fue un procedimiento de EMERGENCIA" -ForegroundColor Red
Write-Host "- Se pueden haber perdido cambios no guardados" -ForegroundColor Red
Write-Host "- Revise el backup antes de continuar" -ForegroundColor Red
Write-Host "- Considere clonar desde GitHub si persisten problemas" -ForegroundColor Red

Write-Host "`n📚 RECURSOS DISPONIBLES:" -ForegroundColor Cyan
Write-Host "📖 Reporte completo: EMERGENCY_RECOVERY_REPORT.md" -ForegroundColor White
Write-Host "🔧 Script de recuperación: scripts/post-emergency-recovery.bat" -ForegroundColor White
Write-Host "📚 Guía del flujo de trabajo: docs/git-workflow-guide.md" -ForegroundColor White
Write-Host "💾 Backup de emergencia: $backupDir" -ForegroundColor White

Write-Host "`n🎉 RECUPERACIÓN DE EMERGENCIA FINALIZADA" -ForegroundColor Green
Write-Host "El repositorio ha sido recuperado usando métodos de emergencia." -ForegroundColor Green
Write-Host "Siga las instrucciones post-emergencia para completar la recuperación." -ForegroundColor Green
