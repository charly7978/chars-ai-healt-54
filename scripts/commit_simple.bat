@echo off
echo ========================================
echo    COMMIT SIMPLE Y SEGURO
echo ========================================
echo.

if "%1"=="" (
    echo ERROR: Debes proporcionar un mensaje de commit
    echo Uso: commit_simple.bat "Mensaje del commit"
    echo.
    pause
    exit /b 1
)

echo Limpiando archivos temporales...
if exist "build" rmdir /s /q "build" 2>nul
if exist "dist" rmdir /s /q "dist" 2>nul
if exist "android\.gradle" rmdir /s /q "android\.gradle" 2>nul
if exist "react-native\android\.gradle" rmdir /s /q "react-native\android\.gradle" 2>nul

echo.
echo Agregando archivos importantes...
git add src/
git add components/
git add scripts/
git add *.ts
git add *.tsx
git add *.js
git add *.jsx
git add *.json
git add *.md
git add *.css
git add *.html
git add *.xml

echo.
echo Agregando archivos de configuracion Android...
git add react-native/android/settings.gradle
git add react-native/android/build.gradle
git add react-native/android/gradle.properties
git add react-native/android/gradle/wrapper/gradle-wrapper.properties
git add react-native/android/gradlew
git add react-native/android/gradlew.bat

echo.
echo Estado del repositorio:
git status --short

echo.
echo Haciendo commit con mensaje: %1
git commit -m "%1"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo    COMMIT EXITOSO!
    echo ========================================
    echo.
    set /p push="¿Hacer push al repositorio? (s/n): "
    if /i "%push%"=="s" (
        echo Haciendo push...
        git push origin main
        if %ERRORLEVEL% EQU 0 (
            echo PUSH EXITOSO!
        ) else (
            echo Error en push
        )
    )
) else (
    echo ERROR en commit
)

echo.
pause
