# OpenCV Setup Verification Script for Windows
# This script helps verify that OpenCV is properly integrated into the Android project

# Display header
Write-Host "=== OpenCV Integration Verification ===" -ForegroundColor Cyan
Write-Host "Checking OpenCV setup in the Android project..."

# Check if we're in the project root
$projectRoot = (Get-Item -Path ".").FullName
$androidDir = Join-Path $projectRoot "android"
$appDir = Join-Path $androidDir "app"

# 1. Check for OpenCV SDK directory
Write-Host "`n[1/6] Checking OpenCV SDK directory..." -ForegroundColor Yellow
$opencvSdkDir = Join-Path $androidDir "opencv-android-sdk"
if (Test-Path $opencvSdkDir) {
    Write-Host "✓ OpenCV SDK found at: $opencvSdkDir" -ForegroundColor Green
} else {
    Write-Host "✗ OpenCV SDK not found at: $opencvSdkDir" -ForegroundColor Red
    Write-Host "   Please download and extract the OpenCV Android SDK to this location" -ForegroundColor Yellow
    exit 1
}

# 2. Check for native libraries
Write-Host "`n[2/6] Checking native libraries..." -ForegroundColor Yellow
$jniLibsDir = Join-Path $appDir "src\main\jniLibs"
if (Test-Path $jniLibsDir) {
    $abiDirs = Get-ChildItem -Directory -Path $jniLibsDir | Select-Object -ExpandProperty Name
    if ($abiDirs) {
        Write-Host "✓ Found native libraries for ABIs: $($abiDirs -join ', ')" -ForegroundColor Green
    } else {
        Write-Host "✗ No ABI directories found in jniLibs" -ForegroundColor Red
    }
} else {
    Write-Host "✗ jniLibs directory not found at: $jniLibsDir" -ForegroundColor Red
}

# 3. Check settings.gradle for OpenCV module
Write-Host "`n[3/6] Checking settings.gradle..." -ForegroundColor Yellow
$settingsGradle = Join-Path $androidDir "settings.gradle"
if (Test-Path $settingsGradle) {
    $settingsContent = Get-Content $settingsGradle -Raw
    if ($settingsContent -match ":opencv") {
        Write-Host "✓ OpenCV module is included in settings.gradle" -ForegroundColor Green
    } else {
        Write-Host "✗ OpenCV module is not included in settings.gradle" -ForegroundColor Red
    }
} else {
    Write-Host "✗ settings.gradle not found at: $settingsGradle" -ForegroundColor Red
}

# 4. Check app/build.gradle for OpenCV dependency
Write-Host "`n[4/6] Checking app/build.gradle..." -ForegroundColor Yellow
$appBuildGradle = Join-Path $appDir "build.gradle"
if (Test-Path $appBuildGradle) {
    $buildContent = Get-Content $appBuildGradle -Raw
    if ($buildContent -match "implementation project\\(['\"]:opencv['\"]\)") {
        Write-Host "✓ OpenCV dependency found in app/build.gradle" -ForegroundColor Green
    } else {
        Write-Host "✗ OpenCV dependency not found in app/build.gradle" -ForegroundColor Red
    }
    
    # Check for packaging options
    if ($buildContent -match "packagingOptions") {
        Write-Host "✓ packagingOptions found in app/build.gradle" -ForegroundColor Green
    } else {
        Write-Host "✗ packagingOptions not found in app/build.gradle" -ForegroundColor Yellow
    }
} else {
    Write-Host "✗ app/build.gradle not found at: $appBuildGradle" -ForegroundColor Red
}

# 5. Check for OpenCV loader helper
Write-Host "`n[5/6] Checking OpenCV loader helper..." -ForegroundColor Yellow
$loaderHelperPath = Join-Path $appDir "src\main\java\com\opencv\OpenCVLoaderHelper.java"
if (Test-Path $loaderHelperPath) {
    Write-Host "✓ OpenCVLoaderHelper found at: $loaderHelperPath" -ForegroundColor Green
} else {
    Write-Host "✗ OpenCVLoaderHelper not found at: $loaderHelperPath" -ForegroundColor Red
}

# 6. Check MainApplication for OpenCV initialization
Write-Host "`n[6/6] Checking MainApplication for OpenCV initialization..." -ForegroundColor Yellow
$mainAppPath = Join-Path $appDir "src\main\java\com\precisioncapturesuite\MainApplication.java"
if (Test-Path $mainAppPath) {
    $mainAppContent = Get-Content $mainAppPath -Raw
    if ($mainAppContent -match "OpenCVLoaderHelper\.initOpenCV") {
        Write-Host "✓ OpenCV initialization found in MainApplication" -ForegroundColor Green
    } else {
        Write-Host "✗ OpenCV initialization not found in MainApplication" -ForegroundColor Red
    }
} else {
    Write-Host "✗ MainApplication.java not found at: $mainAppPath" -ForegroundColor Yellow
}

# Display summary and next steps
Write-Host "`n=== Verification Complete ===" -ForegroundColor Cyan
Write-Host "`nNext steps:"
Write-Host "1. Open the project in Android Studio"
Write-Host "2. Sync project with Gradle files"
Write-Host "3. Build the project"
Write-Host "4. Run the app on a device or emulator"
Write-Host "`nIf you encounter any issues, refer to the documentation at docs/opencv-android-integration.md"

# Exit with success code
exit 0
