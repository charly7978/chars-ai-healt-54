# Script para resolver problemas de compilación de Android
# Autor: Asistente de IA
# Fecha: $(Get-Date)

Write-Host "🔧 Iniciando reparación del proyecto Android..." -ForegroundColor Green

# Cambiar al directorio del proyecto React Native
Set-Location "react-native"

Write-Host "📁 Directorio actual: $(Get-Location)" -ForegroundColor Blue

# Limpiar node_modules y reinstalar dependencias
Write-Host "🧹 Limpiando node_modules..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Remove-Item -Recurse -Force "node_modules"
    Write-Host "✅ node_modules eliminado" -ForegroundColor Green
}

Write-Host "📦 Reinstalando dependencias..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Dependencias instaladas correctamente" -ForegroundColor Green
} else {
    Write-Host "❌ Error al instalar dependencias" -ForegroundColor Red
    exit 1
}

# Limpiar caché de Gradle
Write-Host "🧹 Limpiando caché de Gradle..." -ForegroundColor Yellow
if (Test-Path "android\.gradle") {
    Remove-Item -Recurse -Force "android\.gradle"
    Write-Host "✅ Caché de Gradle eliminado" -ForegroundColor Green
}

if (Test-Path "android\build") {
    Remove-Item -Recurse -Force "android\build"
    Write-Host "✅ Directorio build eliminado" -ForegroundColor Green
}

# Limpiar caché de Metro
Write-Host "🧹 Limpiando caché de Metro..." -ForegroundColor Yellow
if (Test-Path "android\app\build") {
    Remove-Item -Recurse -Force "android\app\build"
    Write-Host "✅ Build de la app eliminado" -ForegroundColor Green
}

# Verificar que el archivo settings.gradle esté correcto
Write-Host "🔍 Verificando archivo settings.gradle..." -ForegroundColor Yellow
$settingsGradlePath = "android\settings.gradle"
if (Test-Path $settingsGradlePath) {
    Write-Host "✅ settings.gradle encontrado" -ForegroundColor Green
} else {
    Write-Host "❌ settings.gradle no encontrado" -ForegroundColor Red
    exit 1
}

# Verificar que el archivo build.gradle esté correcto
Write-Host "🔍 Verificando archivo build.gradle..." -ForegroundColor Yellow
$buildGradlePath = "android\build.gradle"
if (Test-Path $buildGradlePath) {
    Write-Host "✅ build.gradle encontrado" -ForegroundColor Green
} else {
    Write-Host "❌ build.gradle no encontrado" -ForegroundColor Red
    exit 1
}

# Verificar que el archivo gradle.properties esté correcto
Write-Host "🔍 Verificando archivo gradle.properties..." -ForegroundColor Yellow
$gradlePropertiesPath = "android\gradle.properties"
if (Test-Path $gradlePropertiesPath) {
    Write-Host "✅ gradle.properties encontrado" -ForegroundColor Green
} else {
    Write-Host "❌ gradle.properties no encontrado" -ForegroundColor Red
    exit 1
}

# Verificar que el archivo gradlew esté presente
Write-Host "🔍 Verificando archivo gradlew..." -ForegroundColor Yellow
$gradlewPath = "android\gradlew"
if (Test-Path $gradlewPath) {
    Write-Host "✅ gradlew encontrado" -ForegroundColor Green
} else {
    Write-Host "❌ gradlew no encontrado" -ForegroundColor Red
    exit 1
}

# Hacer gradlew ejecutable (en sistemas Unix)
if ($IsLinux -or $IsMacOS) {
    Write-Host "🔧 Haciendo gradlew ejecutable..." -ForegroundColor Yellow
    chmod +x "android\gradlew"
    Write-Host "✅ gradlew hecho ejecutable" -ForegroundColor Green
}

# Verificar versión de Java
Write-Host "🔍 Verificando versión de Java..." -ForegroundColor Yellow
try {
    $javaVersion = java -version 2>&1 | Select-String "version"
    Write-Host "✅ Java encontrado: $javaVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Java no encontrado o no está en el PATH" -ForegroundColor Red
    Write-Host "💡 Asegúrate de tener Java 11 o 17 instalado" -ForegroundColor Yellow
}

# Verificar versión de Android SDK
Write-Host "🔍 Verificando variables de entorno de Android..." -ForegroundColor Yellow
$androidHome = $env:ANDROID_HOME
$androidSdkRoot = $env:ANDROID_SDK_ROOT

if ($androidHome -or $androidSdkRoot) {
    Write-Host "✅ Variables de entorno de Android configuradas" -ForegroundColor Green
    Write-Host "   ANDROID_HOME: $androidHome" -ForegroundColor Cyan
    Write-Host "   ANDROID_SDK_ROOT: $androidSdkRoot" -ForegroundColor Cyan
} else {
    Write-Host "⚠️  Variables de entorno de Android no configuradas" -ForegroundColor Yellow
    Write-Host "💡 Configura ANDROID_HOME y ANDROID_SDK_ROOT" -ForegroundColor Yellow
}

# Intentar limpiar con Gradle
Write-Host "🧹 Ejecutando limpieza de Gradle..." -ForegroundColor Yellow
Set-Location "android"
try {
    .\gradlew clean
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Limpieza de Gradle completada" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Limpieza de Gradle falló, pero continuando..." -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  Error al ejecutar gradlew clean: $_" -ForegroundColor Yellow
}

# Volver al directorio raíz
Set-Location ".."

Write-Host "🎉 Reparación completada!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Pasos siguientes:" -ForegroundColor Cyan
Write-Host "1. Ejecuta: cd react-native" -ForegroundColor White
Write-Host "2. Ejecuta: npm run android" -ForegroundColor White
Write-Host "3. Si hay errores, revisa los logs de Gradle" -ForegroundColor White
Write-Host ""
Write-Host "💡 Si el problema persiste, verifica:" -ForegroundColor Yellow
Write-Host "   - Versión de Java (11 o 17)" -ForegroundColor White
Write-Host "   - Variables de entorno de Android SDK" -ForegroundColor White
Write-Host "   - Versión de Gradle (7.5.1+)" -ForegroundColor White
Write-Host "   - Versión de Android Build Tools (34.0.0+)" -ForegroundColor White
