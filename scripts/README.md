# 🛡️ Sistema de Escudo Anti-Errores Automatizado

Este directorio contiene scripts automatizados para prevenir errores antes de hacer commit y mantener la calidad del código.

## 📁 Archivos Disponibles

### 1. `auto-commit-shield.ps1` (PowerShell - Recomendado)
- **Sistema avanzado** con interfaz colorida y funciones inteligentes
- **Corrección automática** de conflictos de merge
- **Análisis detallado** de errores de linter y TypeScript
- **Verificación completa** de build y tests
- **Compatible con Windows 10/11** y PowerShell 5.1+

### 2. `auto-commit-shield.bat` (Batch - Compatibilidad)
- **Script simple** para sistemas Windows básicos
- **Funcionalidad esencial** de verificación
- **Compatible con CMD** y versiones antiguas de Windows

## 🚀 Uso Rápido

### Opción 1: PowerShell (Recomendado)
```powershell
# Desde la raíz del proyecto
.\scripts\auto-commit-shield.ps1

# Con mensaje personalizado
.\scripts\auto-commit-shield.ps1 -CommitMessage "Mi mensaje personalizado"

# Omitir tests
.\scripts\auto-commit-shield.ps1 -SkipTests

# Desactivar corrección automática
.\scripts\auto-commit-shield.ps1 -AutoFix:$false
```

### Opción 2: Batch
```cmd
# Desde la raíz del proyecto
scripts\auto-commit-shield.bat
```

## 🔧 Funcionalidades

### ✅ Verificaciones Automáticas
1. **Repositorio Git**: Confirma que estás en un proyecto git válido
2. **Conflictos de Merge**: Detecta y resuelve automáticamente conflictos
3. **Linter**: Ejecuta ESLint y corrige errores automáticamente
4. **TypeScript**: Verifica tipos y detecta errores de compilación
5. **Tests**: Ejecuta suite de tests (opcional)
6. **Build**: Verifica que el proyecto compile correctamente

### 🚨 Corrección Automática
- **Conflictos de Merge**: Elimina marcadores automáticamente
- **Errores de Linter**: Ejecuta `npm run lint:fix`
- **Análisis Inteligente**: Detecta patrones de errores comunes

### 📊 Reportes Detallados
- **Estado Visual**: Colores y emojis para fácil identificación
- **Resumen Completo**: Lista de todas las verificaciones
- **Historial de Cambios**: Timestamp y hash del commit

## ⚠️ Requisitos Previos

### Dependencias del Proyecto
```bash
# Asegúrate de tener estas dependencias instaladas
npm install
npm run build  # Verifica que el proyecto compile
```

### Scripts NPM Requeridos
```json
{
  "scripts": {
    "lint": "eslint src/**/*.{ts,tsx}",
    "lint:fix": "eslint src/**/*.{ts,tsx} --fix",
    "build": "your-build-command",
    "test": "your-test-command"
  }
}
```

## 🎯 Casos de Uso

### 1. Commit Diario
```powershell
# Ejecutar antes de cada commit
.\scripts\auto-commit-shield.ps1
```

### 2. Integración Continua
```powershell
# Para CI/CD, omitir interacción del usuario
.\scripts\auto-commit-shield.ps1 -AutoFix -SkipTests
```

### 3. Resolución de Conflictos
```powershell
# Después de merge/pull con conflictos
.\scripts\auto-commit-shield.ps1 -AutoFix
```

## 🔍 Solución de Problemas

### Error: "No se detectó un repositorio git"
- **Solución**: Ejecuta el script desde la raíz del proyecto
- **Verificar**: `git status` debe funcionar

### Error: "No se pudo ejecutar el linter"
- **Solución**: Instala dependencias con `npm install`
- **Verificar**: `npm run lint` debe funcionar

### Error: "Conflictos sin resolver"
- **Solución**: Revisa manualmente los archivos marcados
- **Verificar**: Busca `<<<<<<<` en los archivos

### Error: "Build falló"
- **Solución**: Corrige errores de compilación manualmente
- **Verificar**: `npm run build` debe funcionar

## 📈 Beneficios

### 🚀 Productividad
- **Ahorro de tiempo**: Verificación automática en segundos
- **Prevención de errores**: Detecta problemas antes del commit
- **Flujo de trabajo**: Proceso estandarizado para todo el equipo

### 🛡️ Calidad del Código
- **Consistencia**: Mismos estándares en todos los commits
- **Detección temprana**: Errores encontrados antes de llegar a producción
- **Documentación**: Historial claro de cambios y verificaciones

### 🔄 Automatización
- **Sin intervención manual**: Corrección automática de errores comunes
- **Configuración inteligente**: Adapta correcciones según el contexto
- **Reportes claros**: Información detallada de cada verificación

## 🎨 Personalización

### Modificar Umbrales
```powershell
# En el script PowerShell, ajusta estos valores:
$MIN_QUALITY_THRESHOLD = 0.8
$MAX_ERROR_COUNT = 5
$SKIP_TESTS_BY_DEFAULT = $false
```

### Agregar Verificaciones
```powershell
# Agregar nuevas verificaciones al script
Write-Header "NUEVA VERIFICACIÓN"
# Tu lógica aquí
```

## 📞 Soporte

### Reportar Problemas
- **GitHub Issues**: Crea un issue con detalles del error
- **Logs**: Incluye la salida completa del script
- **Reproducción**: Describe los pasos para reproducir el problema

### Contribuir
- **Fork**: Crea tu fork del proyecto
- **Mejoras**: Implementa nuevas funcionalidades
- **Tests**: Asegúrate de que los tests pasen
- **Pull Request**: Envía tu contribución

---

## 🎯 Resumen de Comandos

| Acción | PowerShell | Batch |
|--------|------------|-------|
| **Ejecutar** | `.\scripts\auto-commit-shield.ps1` | `scripts\auto-commit-shield.bat` |
| **Mensaje personalizado** | `-CommitMessage "texto"` | Manual |
| **Omitir tests** | `-SkipTests` | No disponible |
| **Sin corrección automática** | `-AutoFix:$false` | No disponible |

**¡Mantén tu código limpio y libre de errores con el Sistema de Escudo Anti-Errores!** 🛡️✨
