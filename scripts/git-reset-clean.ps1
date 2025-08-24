# Script para limpiar completamente el repositorio Git
# SOLUCIÓN DEFINITIVA PARA PROBLEMAS DE MERGE Y COMMIT

Write-Host "🧹 LIMPIEZA COMPLETA DEL REPOSITORIO GIT" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Verificar si estamos en el directorio correcto
if (-not (Test-Path ".git")) {
    Write-Host "❌ ERROR: No se encontró el directorio .git" -ForegroundColor Red
    Write-Host "Ejecuta este script desde la raíz del repositorio" -ForegroundColor Red
    exit 1
}

Write-Host "📁 Directorio actual: $(Get-Location)" -ForegroundColor Yellow
Write-Host "🔍 Verificando estado del repositorio..." -ForegroundColor Yellow

# Mostrar estado actual
Write-Host "`n📊 ESTADO ACTUAL:" -ForegroundColor Green
git status --porcelain

Write-Host "`n🔗 REMOTES CONFIGURADOS:" -ForegroundColor Green
git remote -v

Write-Host "`n🌿 RAMAS DISPONIBLES:" -ForegroundColor Green
git branch -a

Write-Host "`n⚠️  ADVERTENCIA: Este script realizará las siguientes acciones:" -ForegroundColor Red
Write-Host "   1. Limpiar el working directory" -ForegroundColor Red
Write-Host "   2. Resetear HEAD al último commit" -ForegroundColor Red
Write-Host "   3. Eliminar archivos no rastreados" -ForegroundColor Red
Write-Host "   4. Limpiar stash" -ForegroundColor Red
Write-Host "   5. Reconfigurar remotes si es necesario" -ForegroundColor Red

$confirmation = Read-Host "`n¿Continuar? (s/N)"
if ($confirmation -ne "s" -and $confirmation -ne "S") {
    Write-Host "❌ Operación cancelada" -ForegroundColor Yellow
    exit 0
}

Write-Host "`n🚀 INICIANDO LIMPIEZA COMPLETA..." -ForegroundColor Green

# 1. Limpiar working directory
Write-Host "`n1️⃣ Limpiando working directory..." -ForegroundColor Cyan
git reset --hard HEAD
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Working directory limpiado" -ForegroundColor Green
} else {
    Write-Host "❌ Error al limpiar working directory" -ForegroundColor Red
}

# 2. Limpiar archivos no rastreados
Write-Host "`n2️⃣ Eliminando archivos no rastreados..." -ForegroundColor Cyan
git clean -fd
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Archivos no rastreados eliminados" -ForegroundColor Green
} else {
    Write-Host "❌ Error al eliminar archivos no rastreados" -ForegroundColor Red
}

# 3. Limpiar stash
Write-Host "`n3️⃣ Limpiando stash..." -ForegroundColor Cyan
git stash clear
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Stash limpiado" -ForegroundColor Green
} else {
    Write-Host "❌ Error al limpiar stash" -ForegroundColor Red
}

# 4. Verificar y configurar remotes
Write-Host "`n4️⃣ Verificando configuración de remotes..." -ForegroundColor Cyan
$remotes = git remote -v
if ([string]::IsNullOrEmpty($remotes)) {
    Write-Host "⚠️  No hay remotes configurados. Configurando origin..." -ForegroundColor Yellow
    
    # Intentar detectar la URL del repositorio
    $repoUrl = "https://github.com/charly7978/chars-ai-healt-48.git"
    Write-Host "🔗 Agregando remote origin: $repoUrl" -ForegroundColor Yellow
    
    git remote add origin $repoUrl
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Remote origin configurado" -ForegroundColor Green
    } else {
        Write-Host "❌ Error al configurar remote origin" -ForegroundColor Red
    }
} else {
    Write-Host "✅ Remotes ya configurados" -ForegroundColor Green
}

# 5. Verificar estado final
Write-Host "`n5️⃣ Verificando estado final..." -ForegroundColor Cyan
Write-Host "`n📊 ESTADO FINAL:" -ForegroundColor Green
git status

Write-Host "`n🔗 REMOTES FINALES:" -ForegroundColor Green
git remote -v

Write-Host "`n🌿 RAMA ACTUAL:" -ForegroundColor Green
git branch --show-current

Write-Host "`n✅ LIMPIEZA COMPLETA FINALIZADA" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green
Write-Host "El repositorio está ahora en un estado limpio y estable" -ForegroundColor Green
Write-Host "`n💡 PRÓXIMOS PASOS RECOMENDADOS:" -ForegroundColor Cyan
Write-Host "   1. Verificar que no hay conflictos: git status" -ForegroundColor White
Write-Host "   2. Hacer pull de los cambios remotos: git pull origin main" -ForegroundColor White
Write-Host "   3. Crear un nuevo commit limpio" -ForegroundColor White
Write-Host "   4. Configurar pre-commit hooks para prevenir problemas futuros" -ForegroundColor White
