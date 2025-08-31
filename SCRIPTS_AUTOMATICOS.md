# SCRIPTS AUTOMÁTICOS DE CORRECCIÓN

## Descripción

Estos scripts corrigen automáticamente los errores de merge y compilan el proyecto APS sin intervención manual.

## Scripts Disponibles

### 1. `fix_merge_and_build.cmd` (Windows CMD)
Script de línea de comandos de Windows que:
- Detecta conflictos de merge automáticamente
- Los corrige usando PowerShell
- Instala dependencias
- Compila el proyecto

### 2. `fix_merge_and_build.ps1` (PowerShell)
Script de PowerShell más robusto que:
- Busca recursivamente conflictos en todos los archivos TypeScript/JavaScript
- Corrige conflictos de merge de forma inteligente
- Maneja errores de forma elegante
- Proporciona feedback visual detallado

## Cómo Usar

### Opción 1: Doble clic (Windows CMD)
```
1. Hacer doble clic en fix_merge_and_build.cmd
2. El script se ejecutará automáticamente
3. Esperar a que termine la compilación
```

### Opción 2: Línea de comandos (Windows CMD)
```cmd
fix_merge_and_build.cmd
```

### Opción 3: PowerShell
```powershell
.\fix_merge_and_build.ps1
```

### Opción 4: Ejecutar desde cualquier ubicación
```powershell
# Desde cualquier directorio
& "C:\Users\nispero\OneDrive\Documentos\GitHub\chars-ai-healt-48\fix_merge_and_build.ps1"
```

## Qué Hace Cada Script

### Fase 1: Verificación
- ✅ Verifica el estado del repositorio Git
- ✅ Comprueba que no haya cambios pendientes

### Fase 2: Corrección de Conflictos
- 🔍 Busca archivos con marcadores de merge (`<<<<<<<`, `=======`, `>>>>>>>`)
- 🛠️ Corrige automáticamente los conflictos
- 🧹 Limpia archivos temporales

### Fase 3: Instalación
- 📦 Ejecuta `npm install` para asegurar dependencias actualizadas

### Fase 4: Compilación
- 🔨 Ejecuta `npm run build`
- ✅ Verifica que la compilación sea exitosa
- 📁 Genera archivos en el directorio `dist/`

## Archivos que Corrige

Los scripts están configurados para corregir automáticamente conflictos en:

- `src/hooks/useSignalProcessor.ts`
- `src/modules/signal-processing/MultiChannelManager.ts`
- `src/modules/signal-processing/PPGChannel.ts`
- Cualquier otro archivo `.ts`, `.tsx`, `.js`, `.jsx` en `src/`

## Casos de Uso

### 1. Después de un Pull con Conflictos
```bash
git pull origin main
# Si hay conflictos, ejecutar:
.\fix_merge_and_build.ps1
```

### 2. Después de un Merge Manual
```bash
git merge feature-branch
# Si hay conflictos, ejecutar:
.\fix_merge_and_build.ps1
```

### 3. Verificación Periódica
```bash
# Ejecutar semanalmente para verificar integridad
.\fix_merge_and_build.ps1
```

### 4. Antes de un Deploy
```bash
# Asegurar que todo compile correctamente
.\fix_merge_and_build.ps1
```

## Ventajas

✅ **Automático**: No requiere intervención manual
✅ **Seguro**: No modifica archivos sin conflictos
✅ **Completo**: Corrige, instala y compila en un solo comando
✅ **Inteligente**: Detecta y corrige solo lo necesario
✅ **Feedback**: Proporciona información detallada del proceso

## Troubleshooting

### Error: "No se puede ejecutar scripts"
```powershell
# Ejecutar en PowerShell como administrador:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Error: "Git no encontrado"
- Asegurar que Git esté instalado y en el PATH
- Verificar que estés en un repositorio Git válido

### Error: "npm no encontrado"
- Asegurar que Node.js y npm estén instalados
- Verificar que estés en el directorio del proyecto

### Conflictos Persistentes
Si quedan conflictos después de ejecutar el script:
1. Revisar manualmente los archivos marcados
2. Ejecutar `git status` para ver el estado
3. Resolver conflictos restantes manualmente

## Logs y Debugging

Los scripts proporcionan logs detallados:
- 🔵 **Azul**: Información del proceso
- 🟡 **Amarillo**: Advertencias y correcciones
- 🟢 **Verde**: Operaciones exitosas
- 🔴 **Rojo**: Errores críticos

## Mantenimiento

### Actualizar Scripts
Los scripts se actualizan automáticamente con el repositorio. Para versiones personalizadas:

1. Copiar el script a una ubicación personalizada
2. Modificar según necesidades específicas
3. Mantener copia de respaldo

### Personalización
Puedes modificar los scripts para:
- Agregar más tipos de archivo
- Cambiar la lógica de corrección
- Agregar validaciones adicionales
- Integrar con otros sistemas

---

**Nota**: Estos scripts están diseñados específicamente para el proyecto APS y corrigen los conflictos de merge más comunes. Para casos complejos, siempre es recomendable revisar manualmente.
