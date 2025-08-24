# Script para descargar gradle-wrapper.jar
Write-Host "📥 Descargando gradle-wrapper.jar..." -ForegroundColor Green

$gradleWrapperUrl = "https://github.com/gradle/gradle/raw/v8.3.0/gradle/wrapper/gradle-wrapper.jar"
$outputPath = "react-native/android/gradle/wrapper/gradle-wrapper.jar"

# Crear directorio si no existe
$directory = Split-Path $outputPath -Parent
if (!(Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

try {
    # Descargar archivo
    Invoke-WebRequest -Uri $gradleWrapperUrl -OutFile $outputPath
    Write-Host "✅ gradle-wrapper.jar descargado correctamente" -ForegroundColor Green
} catch {
    Write-Host "❌ Error al descargar: $_" -ForegroundColor Red
    Write-Host "💡 Descarga manual desde: $gradleWrapperUrl" -ForegroundColor Yellow
}
