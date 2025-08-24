#!/bin/bash

# Script para configurar el entorno de desarrollo Android con OpenCV y Google Test

# Colores para la salida
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Configuración del entorno de desarrollo Android ===${NC}"

# Verificar si estamos en el directorio raíz del proyecto
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Debes ejecutar este script desde el directorio raíz del proyecto.${NC}"
    exit 1
fi

# Instalar dependencias de Node.js
echo -e "${YELLOW}Instalando dependencias de Node.js...${NC}"
npm install

# Instalar OpenCV para React Native
echo -e "${YELLOW}Instalando OpenCV para React Native...${NC}"
npm install --save @techstark/opencv-js

# Instalar Google Test como dependencia de desarrollo
echo -e "${YELLOW}Instalando Google Test...${NC}"
mkdir -p third_party
cd third_party

echo -e "${YELLOW}Clonando Google Test...${NC}"
if [ ! -d "googletest" ]; then
    git clone https://github.com/google/googletest.git
    cd googletest
    git checkout release-1.12.1  # Última versión estable
    cd ..
fi

# Crear enlace simbólico a node_modules para que CMake lo encuentre
echo -e "${YELLOW}Configurando enlaces simbólicos...${NC}"
cd ..
mkdir -p node_modules
echo "Enlaces simbólicos configurados correctamente."

# Configurar variables de entorno para Android NDK
echo -e "${YELLOW}Configurando variables de entorno de Android NDK...${NC}"
if [ -z "$ANDROID_HOME" ]; then
    echo -e "${RED}ADVERTENCIA: ANDROID_HOME no está configurado. Configurando valores por defecto...${NC}"
    export ANDROID_HOME=$HOME/Android/Sdk
fi

if [ -z "$ANDROID_NDK_HOME" ]; then
    export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/$(ls $ANDROID_HOME/ndk | sort -V | tail -1)
    echo "ANDROID_NDK_HOME configurado a: $ANDROID_NDK_HOME"
fi

# Verificar que el NDK está instalado
if [ ! -d "$ANDROID_NDK_HOME" ]; then
    echo -e "${RED}Error: No se encontró el NDK de Android en $ANDROID_NDK_HOME${NC}"
    echo -e "Por favor, instala el NDK desde Android Studio o configúralo manualmente."
    exit 1
fi

# Configurar OpenCV para Android
echo -e "${YELLOW}Configurando OpenCV para Android...${NC}"
if [ ! -d "third_party/opencv-android" ]; then
    echo -e "${YELLOW}Descargando OpenCV para Android...${NC}"
    OPENCV_VERSION="4.8.0"
    wget -q https://github.com/opencv/opencv/releases/download/${OPENCV_VERSION}/opencv-${OPENCV_VERSION}-android-sdk.zip
    unzip -q opencv-${OPENCV_VERSION}-android-sdk.zip -d third_party/
    mv third_party/OpenCV-android-sdk third_party/opencv-android
    rm opencv-${OPENCV_VERSION}-android-sdk.zip
    
    # Crear archivo local.properties si no existe
    if [ ! -f "android/local.properties" ]; then
        echo "sdk.dir=$ANDROID_HOME" > android/local.properties
    fi
    
    # Actualizar settings.gradle para incluir OpenCV
    if ! grep -q "opencv-android" "android/settings.gradle"; then
        echo "include ':opencv'" >> android/settings.gradle
        echo "project(':opencv').projectDir = new File(rootProject.projectDir, '../third_party/opencv-android/sdk')" >> android/settings.gradle
    fi
    
    echo -e "${GREEN}OpenCV para Android configurado correctamente.${NC}"
else
    echo -e "${GREEN}OpenCV para Android ya está configurado.${NC}"
fi

# Configurar build.gradle para pruebas nativas
echo -e "${YELLOW}Configurando build.gradle para pruebas nativas...${NC}"

# Crear directorio de pruebas si no existe
mkdir -p android/app/src/test/cpp

# Crear archivo de prueba de ejemplo si no existe
if [ ! -f "android/app/src/test/cpp/CMakeLists.txt" ]; then
    cat > android/app/src/test/cpp/CMakeLists.txt << 'EOL'
cmake_minimum_required(VERSION 3.10.2)

# Nombre del proyecto
project(PrecisionCaptureTests)

# Configuración de C++
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Incluir directorios
include_directories(
    ${CMAKE_SOURCE_DIR}/src/main/cpp
    ${CMAKE_SOURCE_DIR}/src/test/cpp
)

# Configurar Google Test
add_subdirectory(${CMAKE_SOURCE_DIR}/../../../third_party/googletest
                ${CMAKE_BINARY_DIR}/googletest
                EXCLUDE_FROM_ALL)

# Configurar OpenCV
find_package(OpenCV REQUIRED)
include_directories(${OpenCV_INCLUDE_DIRS})

# Ejecutable de pruebas
add_executable(
    precision_capture_tests
    test_main.cpp
    measurement_tests.cpp
)

# Enlazar dependencias
target_link_libraries(
    precision_capture_tests
    PRIVATE
    gtest_main
    gmock
    ${OpenCV_LIBS}
    android
    log
)

# Agregar pruebas
include(GoogleTest)
gtest_discover_tests(precision_capture_tests)
EOL
fi

echo -e "${GREEN}Configuración completada exitosamente!${NC}"
echo -e "${YELLOW}Ahora puedes construir y ejecutar las pruebas con:${NC}"
echo "cd android && ./gradlew assembleDebug testDebugUnitTest"
