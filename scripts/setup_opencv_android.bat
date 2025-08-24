@echo off
setlocal enabledelayedexpansion

:: OpenCV Android SDK Setup Script for Windows
:: This script helps with the manual integration of OpenCV Android SDK

echo [INFO] Starting OpenCV Android SDK setup...

:: Check if Android SDK is configured
if "%ANDROID_HOME%"=="" (
    echo [ERROR] ANDROID_HOME environment variable is not set.
    echo Please set ANDROID_HOME to your Android SDK path and run this script again.
    exit /b 1
) else (
    echo [INFO] ANDROID_HOME is set to: %ANDROID_HOME%
)

:: Create required directories
echo [INFO] Creating required directories...
mkdir "android\app\src\main\jniLibs" 2>nul
mkdir "android\app\src\main\3rdparty" 2>nul
mkdir "android\app\src\main\assets" 2>nul

:: Check if OpenCV Android SDK is already downloaded
if not exist "android\opencv-android-sdk" (
    echo [WARNING] OpenCV Android SDK not found.
    echo Please download the OpenCV Android SDK from:
    echo    https://opencv.org/releases/
    echo    - Choose the Android pack (e.g., 'OpenCV-4.8.0-android-sdk.zip')
    echo    - Extract it to "android\opencv-android-sdk" directory
    echo.
    echo You can also use the following steps:
    echo 1. cd android
    echo 2. curl -L -o opencv-sdk.zip https://github.com/opencv/opencv/releases/download/4.8.0/opencv-4.8.0-android-sdk.zip
    echo 3. tar -xf opencv-sdk.zip
    echo 4. ren OpenCV-android-sdk opencv-android-sdk
    echo.
    echo After downloading and extracting, run this script again.
    exit /b 1
) else (
    echo [INFO] Found OpenCV Android SDK in android\opencv-android-sdk
)

:: Copy OpenCV native libraries
echo [INFO] Copying OpenCV native libraries...
if exist "android\opencv-android-sdk\sdk\native\libs\*" (
    xcopy /E /I /Y "android\opencv-android-sdk\sdk\native\libs\*" "android\app\src\main\jniLibs\"
    echo [INFO] Copied native libraries to jniLibs\
) else (
    echo [ERROR] Could not find OpenCV native libraries. The SDK might be corrupted.
    exit /b 1
)

:: Copy OpenCV Java interface
echo [INFO] Copying OpenCV Java interface...
if exist "android\opencv-android-sdk\sdk\java\*" (
    xcopy /E /I /Y "android\opencv-android-sdk\sdk\java\*" "android\app\src\main\3rdparty\"
    echo [INFO] Copied Java interface to 3rdparty\
) else (
    echo [ERROR] Could not find OpenCV Java interface. The SDK might be corrupted.
    exit /b 1
)

:: Update settings.gradle to include OpenCV module
echo [INFO] Updating settings.gradle...
findstr /i /c:":opencv" "android\settings.gradle" >nul
if %ERRORLEVEL% NEQ 0 (
    (
        echo.
        echo include ':opencv'
        echo project(':opencv').projectDir = new File(rootProject.projectDir,'opencv-android-sdk/sdk')
    ) >> "android\settings.gradle"
    echo [INFO] Added OpenCV module to settings.gradle
) else (
    echo [INFO] OpenCV module already included in settings.gradle
)

:: Update app-level build.gradle
echo [INFO] Updating app\build.gradle...
findstr /i /c:"opencv" "android\app\build.gradle" >nul
if %ERRORLEVEL% NEQ 0 (
    :: Create a temporary file with the new content
    (
        echo implementation project(path: ":opencv")
        echo.
        echo android {
        echo     packagingOptions {
        echo         pickFirst '**/*.so'
        echo         exclude 'META-INF/DEPENDENCIES'
        echo         exclude 'META-INF/NOTICE'
        echo         exclude 'META-INF/LICENSE'
        echo         exclude 'META-INF/LICENSE.txt'
        echo         exclude 'META-INF/NOTICE.txt'
        echo     }
        echo }
    ) > temp_gradle_content.txt
    
    :: Insert the content after the dependencies block
    powershell -Command "(Get-Content 'android\app\build.gradle') -replace 'dependencies \{', 'dependencies {
    implementation project(":opencv")' | Set-Content 'android\app\build.gradle'"
    
    :: Append the packaging options
    type temp_gradle_content.txt | findstr /v "implementation project" >> "android\app\build.gradle"
    del temp_gradle_content.txt
    
    echo [INFO] Added OpenCV dependency to app\build.gradle
) else (
    echo [INFO] OpenCV dependency already present in app\build.gradle
)

:: Create OpenCV loader helper class
echo [INFO] Creating OpenCV loader helper...
mkdir "android\app\src\main\java\com\opencv" 2>nul

(
    echo package com.opencv;
    echo.
    echo import android.content.Context;
    echo import android.util.Log;
    echo.
    echo import org.opencv.android.OpenCVLoader;
    echo.
    echo public class OpenCVLoaderHelper {
    echo     private static final String TAG = "OpenCVLoaderHelper";
    echo     private static boolean initialized = false;
    echo.
    echo     public static boolean initOpenCV(Context context) {
    echo         if (!initialized) {
    echo             try {
    echo                 initialized = OpenCVLoader.initDebug();
    echo                 if (initialized) {
    echo                     Log.i(TAG, "OpenCV loaded successfully");
    echo                 } else {
    echo                     Log.e(TAG, "OpenCV initialization failed");
    echo                 }
    echo             } catch (UnsatisfiedLinkError e) {
    echo                 Log.e(TAG, "OpenCV was not loaded. Error: " + e.getMessage());
    echo                 initialized = false;
    echo             }
    echo         }
    echo         return initialized;
    echo     }
    echo.
    echo     public static boolean isInitialized() {
    echo         return initialized;
    echo     }
    echo }
) > "android\app\src\main\java\com\opencv\OpenCVLoaderHelper.java"

echo [INFO] Created OpenCV loader helper

:: Try to update MainApplication.java
echo [INFO] Attempting to update MainApplication.java...
set "MAIN_APP_FILE=android\app\src\main\java\com\precisioncapturesuite\MainApplication.java"

if exist "%MAIN_APP_FILE%" (
    findstr /i /c:"import com.opencv.OpenCVLoaderHelper;" "%MAIN_APP_FILE%" >nul
    if %ERRORLEVEL% NEQ 0 (
        powershell -Command "(Get-Content '%MAIN_APP_FILE%') -replace '^package ', 'import com.opencv.OpenCVLoaderHelper;

package ' | Set-Content '%MAIN_APP_FILE%'"
    )
    
    findstr /i /c:"OpenCVLoaderHelper.initOpenCV" "%MAIN_APP_FILE%" >nul
    if %ERRORLEVEL% NEQ 0 (
        powershell -Command "(Get-Content '%MAIN_APP_FILE%') -replace 'super.onCreate\(\);', 'super.onCreate();
        OpenCVLoaderHelper.initOpenCV(this);' | Set-Content '%MAIN_APP_FILE%'"
    )
    
    echo [INFO] Updated MainApplication.java
) else (
    echo [WARNING] MainApplication.java not found. You'll need to manually initialize OpenCV in your Application class.
)

echo.
echo [SUCCESS] OpenCV Android SDK setup completed!
echo.
echo Next steps:
echo 1. Open the project in Android Studio
echo 2. Sync project with Gradle files
echo 3. Build the project
echo.
echo If you encounter any build errors, make sure to:
echo - Set the correct NDK version in local.properties
echo - Verify the OpenCV SDK path
echo - Clean and rebuild the project
echo.

exit /b 0
