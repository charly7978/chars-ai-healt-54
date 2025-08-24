#!/bin/bash

# OpenCV Setup Verification Script for macOS/Linux
# This script helps verify that OpenCV is properly integrated into the Android project

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== OpenCV Integration Verification ===${NC}"
echo "Checking OpenCV setup in the Android project..."

# Check if we're in the project root
project_root=$(pwd)
android_dir="$project_root/android"
app_dir="$android_dir/app"

# 1. Check for OpenCV SDK directory
echo -e "\n${YELLOW}[1/6] Checking OpenCV SDK directory...${NC}"
opencv_sdk_dir="$android_dir/opencv-android-sdk"
if [ -d "$opencv_sdk_dir" ]; then
    echo -e "${GREEN}✓ OpenCV SDK found at: $opencv_sdk_dir${NC}"
else
    echo -e "${RED}✗ OpenCV SDK not found at: $opencv_sdk_dir${NC}"
    echo -e "${YELLOW}   Please download and extract the OpenCV Android SDK to this location${NC}"
    exit 1
fi

# 2. Check for native libraries
echo -e "\n${YELLOW}[2/6] Checking native libraries...${NC}"
jni_libs_dir="$app_dir/src/main/jniLibs"
if [ -d "$jni_libs_dir" ]; then
    abi_dirs=($(ls -d $jni_libs_dir/*/ 2>/dev/null | xargs -n 1 basename 2>/dev/null))
    if [ ${#abi_dirs[@]} -gt 0 ]; then
        echo -e "${GREEN}✓ Found native libraries for ABIs: ${abi_dirs[*]}${NC}"
    else
        echo -e "${RED}✗ No ABI directories found in jniLibs${NC}"
    fi
else
    echo -e "${RED}✗ jniLibs directory not found at: $jni_libs_dir${NC}"
fi

# 3. Check settings.gradle for OpenCV module
echo -e "\n${YELLOW}[3/6] Checking settings.gradle...${NC}"
settings_gradle="$android_dir/settings.gradle"
if [ -f "$settings_gradle" ]; then
    if grep -q ":opencv" "$settings_gradle"; then
        echo -e "${GREEN}✓ OpenCV module is included in settings.gradle${NC}"
    else
        echo -e "${RED}✗ OpenCV module is not included in settings.gradle${NC}"
    fi
else
    echo -e "${RED}✗ settings.gradle not found at: $settings_gradle${NC}"
fi

# 4. Check app/build.gradle for OpenCV dependency
echo -e "\n${YELLOW}[4/6] Checking app/build.gradle...${NC}"
app_build_gradle="$app_dir/build.gradle"
if [ -f "$app_build_gradle" ]; then
    if grep -q "implementation project\s*(['\"]:opencv['\"])" "$app_build_gradle"; then
        echo -e "${GREEN}✓ OpenCV dependency found in app/build.gradle${NC}"
    else
        echo -e "${RED}✗ OpenCV dependency not found in app/build.gradle${NC}"
    fi
    
    # Check for packaging options
    if grep -q "packagingOptions" "$app_build_gradle"; then
        echo -e "${GREEN}✓ packagingOptions found in app/build.gradle${NC}"
    else
        echo -e "${YELLOW}✗ packagingOptions not found in app/build.gradle${NC}"
    fi
else
    echo -e "${RED}✗ app/build.gradle not found at: $app_build_gradle${NC}"
fi

# 5. Check for OpenCV loader helper
echo -e "\n${YELLOW}[5/6] Checking OpenCV loader helper...${NC}"
loader_helper_path="$app_dir/src/main/java/com/opencv/OpenCVLoaderHelper.java"
if [ -f "$loader_helper_path" ]; then
    echo -e "${GREEN}✓ OpenCVLoaderHelper found at: $loader_helper_path${NC}"
else
    echo -e "${RED}✗ OpenCVLoaderHelper not found at: $loader_helper_path${NC}"
fi

# 6. Check MainApplication for OpenCV initialization
echo -e "\n${YELLOW}[6/6] Checking MainApplication for OpenCV initialization...${NC}"
main_app_path="$app_dir/src/main/java/com/precisioncapturesuite/MainApplication.java"
if [ -f "$main_app_path" ]; then
    if grep -q "OpenCVLoaderHelper\\.initOpenCV" "$main_app_path"; then
        echo -e "${GREEN}✓ OpenCV initialization found in MainApplication${NC}"
    else
        echo -e "${RED}✗ OpenCV initialization not found in MainApplication${NC}"
    fi
else
    echo -e "${YELLOW}✗ MainApplication.java not found at: $main_app_path${NC}"
fi

# Display summary and next steps
echo -e "\n${GREEN}=== Verification Complete ===${NC}"
echo -e "\nNext steps:"
echo "1. Open the project in Android Studio"
echo "2. Sync project with Gradle files"
echo "3. Build the project"
echo "4. Run the app on a device or emulator"
echo -e "\nIf you encounter any issues, refer to the documentation at docs/opencv-android-integration.md"

# Exit with success code
exit 0
