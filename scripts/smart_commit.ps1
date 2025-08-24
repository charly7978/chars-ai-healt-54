# Script de Commit Inteligente - SOLO archivos importantes
# Autor: Asistente de IA
# Uso: .\scripts\smart_commit.ps1 "Mensaje del commit"

param(
    [Parameter(Mandatory=$true)]
    [string]$CommitMessage
)

Write-Host "🚀 Iniciando Commit Inteligente..." -ForegroundColor Green

# Verificar que estamos en un repositorio Git
if (!(Test-Path ".git")) {
    Write-Host "❌ No estás en un repositorio Git" -ForegroundColor Red
    exit 1
}

# Limpiar archivos temporales antes del commit
Write-Host "🧹 Limpiando archivos temporales..." -ForegroundColor Yellow

# Eliminar archivos de build
$buildDirs = @(
    "build",
    "dist",
    "android/.gradle",
    "android/app/build",
    "react-native/android/.gradle",
    "react-native/android/app/build"
)

foreach ($dir in $buildDirs) {
    if (Test-Path $dir) {
        Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
        Write-Host "✅ Limpiado: $dir" -ForegroundColor Green
    }
}

# Agregar SOLO archivos importantes
Write-Host "📁 Agregando archivos importantes..." -ForegroundColor Yellow

# Archivos de configuración del proyecto
$importantFiles = @(
    "src/**/*",
    "components/**/*",
    "scripts/**/*",
    "*.ts",
    "*.tsx",
    "*.js",
    "*.jsx",
    "*.json",
    "*.md",
    "*.css",
    "*.scss",
    "*.html",
    "*.xml",
    "*.gradle",
    "*.properties",
    "gradlew*",
    "gradle/wrapper/*.properties"
)

# Agregar archivos importantes
foreach ($pattern in $importantFiles) {
    try {
        $files = Get-ChildItem -Path $pattern -Recurse -ErrorAction SilentlyContinue
        foreach ($file in $files) {
            if ($file.FullName -notlike "*node_modules*" -and 
                $file.FullName -notlike "*.gradle*" -and
                $file.FullName -notlike "*build*" -and
                $file.FullName -notlike "*dist*") {
                
                git add $file.FullName 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "✅ Agregado: $($file.Name)" -ForegroundColor Green
                }
            }
        }
    } catch {
        # Ignorar errores de patrones que no coincidan
    }
}

# Agregar archivos específicos de configuración
$configFiles = @(
    "react-native/android/settings.gradle",
    "react-native/android/build.gradle",
    "react-native/android/gradle.properties",
    "react-native/android/gradle/wrapper/gradle-wrapper.properties",
    "react-native/android/gradlew",
    "react-native/android/gradlew.bat"
)

foreach ($file in $configFiles) {
    if (Test-Path $file) {
        git add $file
        Write-Host "✅ Config agregado: $file" -ForegroundColor Green
    }
}

# Verificar estado
Write-Host "📊 Estado del repositorio:" -ForegroundColor Cyan
git status --short

# Preguntar si continuar
Write-Host ""
$response = Read-Host "¿Continuar con el commit? (s/n)"
if ($response -ne "s" -and $response -ne "S") {
    Write-Host "❌ Commit cancelado" -ForegroundColor Red
    exit 0
}

# Hacer el commit
Write-Host "💾 Haciendo commit..." -ForegroundColor Yellow
git commit -m $CommitMessage

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Commit exitoso!" -ForegroundColor Green
    
    # Preguntar si hacer push
    $pushResponse = Read-Host "¿Hacer push al repositorio remoto? (s/n)"
    if ($pushResponse -eq "s" -or $pushResponse -eq "S") {
        Write-Host "🚀 Haciendo push..." -ForegroundColor Yellow
        git push origin main
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Push exitoso!" -ForegroundColor Green
        } else {
            Write-Host "❌ Error en push" -ForegroundColor Red
        }
    }
} else {
    Write-Host "❌ Error en commit" -ForegroundColor Red
}

Write-Host "🎉 Proceso completado!" -ForegroundColor Green
