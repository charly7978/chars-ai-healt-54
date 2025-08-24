#!/bin/bash

# Colores para la salida
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Sincronización de Dependencias Android ===${NC}"

# Verificar si estamos en el directorio raíz del proyecto
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Debes ejecutar este script desde el directorio raíz del proyecto.${NC}"
    exit 1
fi

# Navegar al directorio de Android
cd "$(dirname "$0")/../react-native/android" || exit 1

# Limpiar el proyecto
echo -e "${YELLOW}Limpiando el proyecto...${NC}"
./gradlew clean

# Eliminar archivos generados
echo -e "${YELLOW}Eliminando archivos generados...${NC}"
rm -rf .gradle
rm -rf build
rm -rf app/build
rm -f .idea/workspace.xml
rm -f .idea/libraries/*.xml

# Sincronizar con Gradle
echo -e "${YELLOW}Sincronizando con Gradle...${NC}"
./gradlew --stop
./gradlew clean build --refresh-dependencies

# Verificar si la sincronización fue exitosa
if [ $? -eq 0 ]; then
    echo -e "${GREEN}¡Sincronización completada con éxito!${NC}"
    
    # Ejecutar tareas de verificación
    echo -e "${YELLOW}Ejecutando tareas de verificación...${NC}"
    ./gradlew checkDependencies
    ./gradlew dependencies
    
    echo -e "${GREEN}¡Proceso completado!${NC}"
    echo -e "Puedes abrir el proyecto en Android Studio ahora."
else
    echo -e "${RED}Error durante la sincronización. Revisa los mensajes de error.${NC}"
    exit 1
fi
