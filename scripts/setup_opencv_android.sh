#!/bin/bash

# OpenCV Android SDK Setup Script
# This script helps with the manual integration of OpenCV Android SDK

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting OpenCV Android SDK setup...${NC}"

# Check if running on macOS or Linux
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    echo "Detected macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    echo "Detected Linux"
else
    echo -e "${RED}❌ Unsupported operating system. This script only supports macOS and Linux.${NC}"
    exit 1
fi

# Check if Android SDK is configured
if [ -z "$ANDROID_HOME" ]; then
    echo -e "${YELLOW}⚠️  ANDROID_HOME environment variable is not set.${NC}"
    echo "Please set ANDROID_HOME to your Android SDK path and run this script again."
    exit 1
else
    echo -e "✅ ANDROID_HOME is set to: ${GREEN}$ANDROID_HOME${NC}"
fi

# Create required directories
echo -e "\n${GREEN}📂 Creating required directories...${NC}"
mkdir -p android/app/src/main/jniLibs
mkdir -p android/app/src/main/3rdparty
mkdir -p android/app/src/main/assets

echo -e "✅ Created required directories"

# Check if OpenCV Android SDK is already downloaded
if [ ! -d "android/opencv-android-sdk" ]; then
    echo -e "\n${YELLOW}📥 OpenCV Android SDK not found.${NC}"
    echo "Please download the OpenCV Android SDK from:"
    echo "   https://opencv.org/releases/"
    echo "   - Choose the Android pack (e.g., 'OpenCV-4.8.0-android-sdk.zip')"
    echo -e "   - Extract it to ${YELLOW}android/opencv-android-sdk${NC} directory"
    echo -e "\nYou can also run the following commands (adjust the OpenCV version as needed):"
    echo "  cd android"
    echo "  wget https://github.com/opencv/opencv/releases/download/4.8.0/opencv-4.8.0-android-sdk.zip"
    echo "  unzip opencv-4.8.0-android-sdk.zip"
    echo "  mv OpenCV-android-sdk opencv-android-sdk"
    echo -e "\nAfter downloading and extracting, run this script again."
    exit 1
else
    echo -e "\n✅ Found OpenCV Android SDK in android/opencv-android-sdk"
fi

# Copy OpenCV native libraries
echo -e "\n${GREEN}📦 Copying OpenCV native libraries...${NC}"
cp -r android/opencv-android-sdk/sdk/native/libs/* android/app/src/main/jniLibs/
echo -e "✅ Copied native libraries to jniLibs/"

# Copy OpenCV Java interface
echo -e "\n${GREEN}📦 Copying OpenCV Java interface...${NC}"
cp -r android/opencv-android-sdk/sdk/java/* android/app/src/main/3rdparty/
echo -e "✅ Copied Java interface to 3rdparty/"

# Update settings.gradle to include OpenCV module
echo -e "\n${GREEN}🔄 Updating settings.gradle...${NC}"
if ! grep -q "opencv" android/settings.gradle; then
    echo "include ':opencv'" >> android/settings.gradle
    echo "project(':opencv').projectDir = new File(rootProject.projectDir,'opencv-android-sdk/sdk')" >> android/settings.gradle
    echo -e "✅ Added OpenCV module to settings.gradle"
else
    echo -e "ℹ️  OpenCV module already included in settings.gradle"
fi

# Update app-level build.gradle
echo -e "\n${GREEN}🔄 Updating app/build.gradle...${NC}"
if ! grep -q "opencv" android/app/build.gradle; then
    # Add OpenCV dependency
    sed -i.bak '/dependencies {/a\    implementation project(path: ":opencv")' android/app/build.gradle
    
    # Add packaging options to avoid duplicate files
    if ! grep -q "packagingOptions" android/app/build.gradle; then
        echo -e "\nandroid {
    packagingOptions {
        pickFirst '**/*.so'
        exclude 'META-INF/DEPENDENCIES'
        exclude 'META-INF/NOTICE'
        exclude 'META-INF/LICENSE'
        exclude 'META-INF/LICENSE.txt'
        exclude 'META-INF/NOTICE.txt'
    }\n}" >> android/app/build.gradle
    fi
    
    echo -e "✅ Added OpenCV dependency to app/build.gradle"
else
    echo -e "ℹ️  OpenCV dependency already present in app/build.gradle"
fi

# Create OpenCV loader helper class
echo -e "\n${GREEN}📝 Creating OpenCV loader helper...${NC}"
mkdir -p android/app/src/main/java/com/opencv

cat > android/app/src/main/java/com/opencv/OpenCVLoaderHelper.java << 'EOL'
package com.opencv;

import android.content.Context;
import android.util.Log;

import org.opencv.android.OpenCVLoader;

public class OpenCVLoaderHelper {
    private static final String TAG = "OpenCVLoaderHelper";
    private static boolean initialized = false;

    public static boolean initOpenCV(Context context) {
        if (!initialized) {
            try {
                initialized = OpenCVLoader.initDebug();
                if (initialized) {
                    Log.i(TAG, "OpenCV loaded successfully");
                } else {
                    Log.e(TAG, "OpenCV initialization failed");
                }
            } catch (UnsatisfiedLinkError e) {
                Log.e(TAG, "OpenCV was not loaded. Error: " + e.getMessage());
                initialized = false;
            }
        }
        return initialized;
    }

    public static boolean isInitialized() {
        return initialized;
    }
}
EOL

echo -e "✅ Created OpenCV loader helper"

# Update MainApplication.java to initialize OpenCV
echo -e "\n${GREEN}🔄 Updating MainApplication.java...${NC}"
MAIN_APP_FILE="android/app/src/main/java/com/precisioncapturesuite/MainApplication.java"
if [ -f "$MAIN_APP_FILE" ]; then
    # Add import
    if ! grep -q "import com.opencv.OpenCVLoaderHelper;" "$MAIN_APP_FILE"; then
        sed -i.bak '/^package /a\
import com.opencv.OpenCVLoaderHelper;' "$MAIN_APP_FILE"
    fi
    
    # Initialize OpenCV in onCreate
    if ! grep -q "OpenCVLoaderHelper.initOpenCV" "$MAIN_APP_FILE"; then
        sed -i.bak '/super.onCreate();/a\        OpenCVLoaderHelper.initOpenCV(this);' "$MAIN_APP_FILE"
    fi
    
    echo -e "✅ Updated MainApplication.java"
else
    echo -e "${YELLOW}⚠️  MainApplication.java not found. You'll need to manually initialize OpenCV in your Application class.${NC}"
fi

echo -e "\n${GREEN}🎉 OpenCV Android SDK setup completed!${NC}"
echo -e "\nNext steps:"
echo "1. Open the project in Android Studio"
echo "2. Sync project with Gradle files"
echo "3. Build the project"
echo -e "\nIf you encounter any build errors, make sure to:"
echo "- Set the correct NDK version in local.properties"
echo "- Verify the OpenCV SDK path"
echo "- Clean and rebuild the project"

exit 0
