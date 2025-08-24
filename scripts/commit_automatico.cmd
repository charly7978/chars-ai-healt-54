@echo off
title COMMIT AUTOMATICO - PRECISION CAPTURE SUITE
color 0A

echo.
echo ========================================
echo    COMMIT AUTOMATICO Y SEGURO
echo    Precision Capture Suite
echo ========================================
echo.

echo Limpiando archivos temporales...
if exist "build" (
    rmdir /s /q "build" 2>nul
    echo ✅ build/ eliminado
)
if exist "dist" (
    rmdir /s /q "dist" 2>nul
    echo ✅ dist/ eliminado
)
if exist "android\.gradle" (
    rmdir /s /q "android\.gradle" 2>nul
    echo ✅ android\.gradle/ eliminado
)
if exist "react-native\android\.gradle" (
    rmdir /s /q "react-native\android\.gradle" 2>nul
    echo ✅ react-native\android\.gradle/ eliminado
)

echo.
echo Agregando archivos importantes...
git add src/ 2>nul && echo ✅ src/ agregado
git add components/ 2>nul && echo ✅ components/ agregado
git add scripts/ 2>nul && echo ✅ scripts/ agregado
git add *.ts 2>nul && echo ✅ *.ts agregado
git add *.tsx 2>nul && echo ✅ *.tsx agregado
git add *.js 2>nul && echo ✅ *.js agregado
git add *.jsx 2>nul && echo ✅ *.jsx agregado
git add *.json 2>nul && echo ✅ *.json agregado
git add *.md 2>nul && echo ✅ *.md agregado
git add *.css 2>nul && echo ✅ *.css agregado
git add *.html 2>nul && echo ✅ *.html agregado
git add *.xml 2>nul && echo ✅ *.xml agregado

echo.
echo Agregando archivos de configuracion Android...
git add react-native/android/settings.gradle 2>nul && echo ✅ settings.gradle agregado
git add react-native/android/build.gradle 2>nul && echo ✅ build.gradle agregado
git add react-native/android/gradle.properties 2>nul && echo ✅ gradle.properties agregado
git add react-native/android/gradle/wrapper/gradle-wrapper.properties 2>nul && echo ✅ gradle-wrapper.properties agregado
git add react-native/android/gradlew 2>nul && echo ✅ gradlew agregado
git add react-native/android/gradlew.bat 2>nul && echo ✅ gradlew.bat agregado

echo.
echo ========================================
echo    ESTADO DEL REPOSITORIO
echo ========================================
git status --short

echo.
echo ========================================
echo    ESCRIBE TU MENSAJE DE COMMIT
echo ========================================
echo Ejemplo: Mejorada funcionalidad de camara
echo.
set /p mensaje="Mensaje: "

if "%mensaje%"=="" (
    echo.
    echo ❌ ERROR: Debes escribir un mensaje
    echo.
    pause
    exit /b 1
)

echo.
echo Haciendo commit con mensaje: "%mensaje%"
git commit -m "%mensaje%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo    ✅ COMMIT EXITOSO!
    echo ========================================
    echo.
    echo ¿Quieres hacer push al repositorio?
    echo s = Si, hacer push
    echo n = No, solo commit local
    echo.
    set /p push="Tu eleccion (s/n): "
    
    if /i "%push%"=="s" (
        echo.
        echo 🚀 Haciendo push a GitHub...
        git push origin main
        
        if %ERRORLEVEL% EQU 0 (
            echo.
            echo ========================================
            echo    ✅ PUSH EXITOSO!
            echo    Tu codigo esta en GitHub
            echo ========================================
        ) else (
            echo.
            echo ❌ Error en push
            echo Revisa tu conexion a internet
        )
    ) else (
        echo.
        echo ℹ️  Solo commit local realizado
        echo Para hacer push despues usa: git push origin main
    )
) else (
    echo.
    echo ❌ ERROR en commit
    echo Revisa el estado del repositorio
)

echo.
echo ========================================
echo    PROCESO COMPLETADO
echo ========================================
echo.
echo Presiona cualquier tecla para cerrar...
pause >nul
