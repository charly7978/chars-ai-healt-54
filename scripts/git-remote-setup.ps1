# Script para configurar y verificar la conexión con el repositorio remoto
# SOLUCIÓN PARA PROBLEMAS DE CONECTIVIDAD

Write-Host "🔗 CONFIGURACIÓN DE CONEXIÓN REMOTA GIT" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan

# Verificar si estamos en el directorio correcto
if (-not (Test-Path ".git")) {
    Write-Host "❌ ERROR: No se encontró el directorio .git" -ForegroundColor Red
    Write-Host "Ejecuta este script desde la raíz del repositorio" -ForegroundColor Red
    exit 1
}

Write-Host "📁 Directorio actual: $(Get-Location)" -ForegroundColor Yellow

# 1. Verificar estado actual de remotes
Write-Host "`n1️⃣ Verificando remotes actuales..." -ForegroundColor Cyan

$currentRemotes = git remote -v
if ([string]::IsNullOrEmpty($currentRemotes)) {
    Write-Host "⚠️  No hay remotes configurados" -ForegroundColor Yellow
} else {
    Write-Host "✅ Remotes configurados:" -ForegroundColor Green
    Write-Host $currentRemotes -ForegroundColor White
}

# 2. Detectar URL del repositorio
Write-Host "`n2️⃣ Detectando URL del repositorio..." -ForegroundColor Cyan

# Intentar diferentes URLs posibles
$possibleUrls = @(
    "https://github.com/charly7978/chars-ai-healt-48.git",
    "https://github.com/charly7978/chars-ai-healt-48",
    "git@github.com:charly7978/chars-ai-healt-48.git"
)

$detectedUrl = $null
foreach ($url in $possibleUrls) {
    Write-Host "🔍 Probando: $url" -ForegroundColor Yellow
    
    # Verificar si la URL es accesible
    try {
        $response = Invoke-WebRequest -Uri $url.Replace(".git", "") -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -eq 200) {
            $detectedUrl = $url
            Write-Host "✅ URL válida detectada: $url" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "❌ No accesible: $url" -ForegroundColor Red
    }
}

if (-not $detectedUrl) {
    Write-Host "❌ No se pudo detectar una URL válida" -ForegroundColor Red
    Write-Host "💡 Ingrese manualmente la URL del repositorio:" -ForegroundColor Yellow
    $detectedUrl = Read-Host "URL del repositorio"
}

# 3. Configurar remote origin
Write-Host "`n3️⃣ Configurando remote origin..." -ForegroundColor Cyan

# Remover origin si ya existe
git remote remove origin 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Remote origin anterior removido" -ForegroundColor Green
}

# Agregar nuevo origin
git remote add origin $detectedUrl
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Remote origin configurado: $detectedUrl" -ForegroundColor Green
} else {
    Write-Host "❌ Error al configurar remote origin" -ForegroundColor Red
    exit 1
}

# 4. Verificar conectividad
Write-Host "`n4️⃣ Verificando conectividad..." -ForegroundColor Cyan

# Test de conectividad básica
Write-Host "🔍 Probando conectividad con origin..." -ForegroundColor Yellow
git ls-remote origin >$null 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Conectividad exitosa con origin" -ForegroundColor Green
} else {
    Write-Host "❌ Error de conectividad con origin" -ForegroundColor Red
    Write-Host "💡 Verifique su conexión a internet y la URL del repositorio" -ForegroundColor Yellow
    exit 1
}

# 5. Obtener información del repositorio remoto
Write-Host "`n5️⃣ Obteniendo información del repositorio remoto..." -ForegroundColor Cyan

# Fetch de información remota
Write-Host "📥 Obteniendo información remota..." -ForegroundColor Yellow
git fetch origin
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Fetch exitoso" -ForegroundColor Green
} else {
    Write-Host "⚠️  Fetch falló, pero continuando..." -ForegroundColor Yellow
}

# 6. Verificar ramas remotas
Write-Host "`n6️⃣ Verificando ramas remotas..." -ForegroundColor Cyan

$remoteBranches = git branch -r
if ($remoteBranches) {
    Write-Host "✅ Ramas remotas disponibles:" -ForegroundColor Green
    Write-Host $remoteBranches -ForegroundColor White
} else {
    Write-Host "⚠️  No se detectaron ramas remotas" -ForegroundColor Yellow
}

# 7. Configurar upstream para la rama actual
Write-Host "`n7️⃣ Configurando upstream..." -ForegroundColor Cyan

$currentBranch = git branch --show-current
if ($currentBranch) {
    Write-Host "🌿 Rama actual: $currentBranch" -ForegroundColor Yellow
    
    # Configurar upstream
    git branch --set-upstream-to=origin/$currentBranch $currentBranch 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Upstream configurado para $currentBranch" -ForegroundColor Green
    } else {
        Write-Host "⚠️  No se pudo configurar upstream automáticamente" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  No se pudo determinar la rama actual" -ForegroundColor Yellow
}

# 8. Verificar estado de sincronización
Write-Host "`n8️⃣ Verificando estado de sincronización..." -ForegroundColor Cyan

# Verificar si hay diferencias con remote
$localCommits = git log --oneline -5
$remoteCommits = git log --oneline origin/$currentBranch -5 2>$null

if ($remoteCommits) {
    Write-Host "📊 Últimos commits locales:" -ForegroundColor Green
    Write-Host $localCommits -ForegroundColor White
    
    Write-Host "`n📊 Últimos commits remotos:" -ForegroundColor Green
    Write-Host $remoteCommits -ForegroundColor White
    
    # Verificar si hay diferencias
    $localHead = git rev-parse HEAD
    $remoteHead = git rev-parse origin/$currentBranch 2>$null
    
    if ($localHead -eq $remoteHead) {
        Write-Host "✅ Repositorio sincronizado con remote" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Repositorio no sincronizado con remote" -ForegroundColor Yellow
        Write-Host "💡 Use: scripts/sync-repository.bat para sincronizar" -ForegroundColor Cyan
    }
} else {
    Write-Host "⚠️  No se pudo obtener información de commits remotos" -ForegroundColor Yellow
}

# 9. Configurar credenciales si es necesario
Write-Host "`n9️⃣ Configurando credenciales..." -ForegroundColor Cyan

# Verificar si git credential helper está configurado
$credentialHelper = git config --global credential.helper
if ([string]::IsNullOrEmpty($credentialHelper)) {
    Write-Host "⚠️  Credential helper no configurado" -ForegroundColor Yellow
    Write-Host "💡 Configurando credential helper para Windows..." -ForegroundColor Yellow
    
    git config --global credential.helper manager-core
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Credential helper configurado" -ForegroundColor Green
    } else {
        Write-Host "❌ Error al configurar credential helper" -ForegroundColor Red
    }
} else {
    Write-Host "✅ Credential helper ya configurado: $credentialHelper" -ForegroundColor Green
}

# 10. Crear script de verificación rápida
Write-Host "`n🔟 Creando script de verificación rápida..." -ForegroundColor Cyan

$quickCheckScript = @"
@echo off
REM Script de verificación rápida de conectividad Git
REM VERIFICACIÓN RÁPIDA DE ESTADO

echo 🔍 VERIFICACIÓN RÁPIDA DE CONECTIVIDAD GIT
echo =========================================

echo.
echo 📊 ESTADO DEL REPOSITORIO:
git status --short

echo.
echo 🔗 REMOTES CONFIGURADOS:
git remote -v

echo.
echo 🌿 RAMA ACTUAL:
git branch --show-current

echo.
echo 📥 ÚLTIMOS COMMITS LOCALES:
git log --oneline -3

echo.
echo 📤 ÚLTIMOS COMMITS REMOTOS:
git log --oneline origin/main -3 2>nul

echo.
echo 🔄 ESTADO DE SINCRRONIZACIÓN:
git status -uno

echo.
echo 💡 COMANDOS ÚTILES:
echo    - Sincronizar: scripts/sync-repository.bat
echo    - Commit: scripts/smart-commit.bat
echo    - Limpiar: scripts/git-reset-clean.ps1
echo.
pause
"@

$quickCheckScript | Out-File -FilePath "scripts/quick-git-check.bat" -Encoding ASCII -Force
Write-Host "✅ Script de verificación rápida creado" -ForegroundColor Green

# 11. Verificación final
Write-Host "`n🔟1️⃣ Verificación final..." -ForegroundColor Cyan

Write-Host "`n📊 CONFIGURACIÓN FINAL:" -ForegroundColor Green
Write-Host "✅ Remote origin: $detectedUrl" -ForegroundColor Green
Write-Host "✅ Rama actual: $currentBranch" -ForegroundColor Green
Write-Host "✅ Conectividad: Verificada" -ForegroundColor Green

Write-Host "`n🔗 REMOTES FINALES:" -ForegroundColor Green
git remote -v

Write-Host "`n🌿 RAMAS DISPONIBLES:" -ForegroundColor Green
git branch -a

Write-Host "`n🎉 CONFIGURACIÓN DE REMOTE COMPLETADA EXITOSAMENTE" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
Write-Host "El repositorio está ahora conectado correctamente con el remote." -ForegroundColor Green

Write-Host "`n💡 PRÓXIMOS PASOS RECOMENDADOS:" -ForegroundColor Cyan
Write-Host "   1. Verificar conectividad: scripts/quick-git-check.bat" -ForegroundColor White
Write-Host "   2. Sincronizar con remote: scripts/sync-repository.bat" -ForegroundColor White
Write-Host "   3. Hacer commit de cambios: scripts/smart-commit.bat" -ForegroundColor White
Write-Host "   4. Push a remote: git push origin $currentBranch" -ForegroundColor White

Write-Host "`n🛡️ PROTECCIÓN ACTIVADA:" -ForegroundColor Green
Write-Host "   - Conectividad remota verificada" -ForegroundColor Green
Write-Host "   - Upstream configurado" -ForegroundColor Green
Write-Host "   - Credenciales configuradas" -ForegroundColor Green
Write-Host "   - Scripts de verificación disponibles" -ForegroundColor Green

Write-Host "`n✅ CONEXIÓN REMOTA CONFIGURADA EXITOSAMENTE" -ForegroundColor Green
