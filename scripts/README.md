# Sistema Automático de Detección y Reparación de Git

Este sistema proporciona detección y reparación automática de problemas comunes en repositorios Git, especialmente diseñado para proyectos de desarrollo con Vite y React.

## 🚀 Características

- **Detección Automática**: Identifica problemas comunes de Git, dependencias y configuración
- **Reparación Automática**: Corrige problemas sin intervención manual
- **Hooks de Git**: Se ejecuta automáticamente antes de cada commit
- **Monitoreo Continuo**: Opción de monitoreo en segundo plano
- **Limpieza de Archivos**: Elimina archivos problemáticos automáticamente
- **Sincronización**: Mantiene el repositorio sincronizado con el remoto

## 📁 Archivos del Sistema

### Scripts Principales
- `auto-fix-git.ps1` - Script principal de detección y reparación
- `pre-commit-hook.ps1` - Hook que se ejecuta antes de cada commit
- `git-monitor.ps1` - Monitor continuo del repositorio
- `setup-auto-git.ps1` - Script de configuración principal

### Scripts de Utilidad
- `install-hooks.ps1` - Instala los hooks de Git
- `uninstall-hooks.ps1` - Desinstala los hooks
- `system-status.ps1` - Muestra el estado del sistema
- `system-cleanup.ps1` - Limpia archivos temporales y logs
- `quick-start.ps1` - Guía de inicio rápido

## 🛠️ Instalación

### Instalación Automática (Recomendada)
```powershell
# Ejecutar desde la raíz del repositorio
.\scripts\setup-auto-git.ps1
```

### Instalación Manual
```powershell
# 1. Instalar hooks de Git
.\scripts\install-hooks.ps1

# 2. Verificar estado del sistema
.\scripts\system-status.ps1
```

## 🎯 Uso

### Reparación Manual
```powershell
# Ejecutar reparación completa
.\scripts\auto-fix-git.ps1

# Con mensaje personalizado
.\scripts\auto-fix-git.ps1 -CommitMessage "Fix: Reparación manual"
```

### Monitoreo Continuo
```powershell
# Iniciar monitor (modo interactivo)
.\scripts\git-monitor.ps1 start

# Iniciar monitor en segundo plano
.\scripts\git-monitor.ps1 start -Background

# Ver estado de monitores
.\scripts\git-monitor.ps1 status

# Detener monitores
.\scripts\git-monitor.ps1 stop
```

### Verificación del Sistema
```powershell
# Estado completo del sistema
.\scripts\system-status.ps1

# Limpiar archivos temporales
.\scripts\system-cleanup.ps1
```

## 🔧 Problemas que Detecta y Repara

### Archivos Problemáticos
- Archivos temporales corruptos (`tamp*`, `tatus*`, `et --hard*`)
- Archivos de timestamp de Vite corruptos
- Archivos de estado de Git malformados

### Estado de Git
- Cambios sin commitear
- Conflictos de merge en progreso
- Rebase en progreso
- Problemas de sincronización con remoto

### Dependencias
- `node_modules` corrupto o faltante
- Dependencias de TensorFlow problemáticas
- Configuración de Vite inválida

### Sincronización
- Diferencias con repositorio remoto
- Problemas de conexión
- Conflictos de push/pull

## ⚙️ Configuración

### Parámetros del Script Principal
```powershell
.\scripts\auto-fix-git.ps1 -CommitMessage "Mensaje personalizado" -Force -Verbose
```

- `-CommitMessage`: Mensaje para commits automáticos
- `-Force`: Forzar reparación incluso si no se detectan problemas
- `-Verbose`: Mostrar información detallada

### Parámetros del Monitor
```powershell
.\scripts\git-monitor.ps1 start -CheckInterval 60 -Background -Verbose
```

- `-CheckInterval`: Intervalo de verificación en segundos (default: 30)
- `-Background`: Ejecutar en segundo plano
- `-Verbose`: Modo verbose

## 🚨 Solución de Problemas

### El sistema no se ejecuta automáticamente
1. Verificar que los hooks estén instalados: `.\scripts\system-status.ps1`
2. Reinstalar hooks: `.\scripts\install-hooks.ps1 -Force`

### Errores de permisos
1. Ejecutar PowerShell como administrador
2. Configurar política de ejecución: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

### Problemas de dependencias
1. Verificar que Node.js y npm estén instalados
2. Limpiar e reinstalar: `Remove-Item node_modules -Recurse -Force; npm install`

### Monitor no responde
1. Detener todos los monitores: `.\scripts\git-monitor.ps1 stop`
2. Reiniciar monitor: `.\scripts\git-monitor.ps1 start`

## 📊 Logs y Monitoreo

### Archivos de Log
- `scripts/git-monitor.log` - Log del monitor continuo
- `scripts/hooks-config.txt` - Configuración de hooks
- `scripts/system-config.ini` - Configuración del sistema

### Verificación de Estado
```powershell
# Estado completo
.\scripts\system-status.ps1

# Solo monitores
.\scripts\git-monitor.ps1 status

# Logs del monitor
Get-Content scripts/git-monitor.log -Tail 20
```

## 🔄 Actualización del Sistema

Para actualizar el sistema:
1. Hacer pull de los cambios más recientes
2. Ejecutar: `.\scripts\setup-auto-git.ps1 -Force`

## 🗑️ Desinstalación

Para desinstalar completamente el sistema:
```powershell
# Desinstalar hooks
.\scripts\uninstall-hooks.ps1

# Detener monitores
.\scripts\git-monitor.ps1 stop

# Limpiar archivos
.\scripts\system-cleanup.ps1
```

## 📝 Notas Importantes

- El sistema está diseñado para ser no intrusivo y seguro
- Siempre hace backup de cambios importantes antes de reparar
- Los commits automáticos usan mensajes descriptivos
- El sistema respeta la configuración existente de Git

## 🤝 Soporte

Si encuentras problemas:
1. Verificar el estado del sistema: `.\scripts\system-status.ps1`
2. Revisar los logs: `Get-Content scripts/git-monitor.log`
3. Ejecutar reparación manual: `.\scripts\auto-fix-git.ps1 -Verbose`

---

**Desarrollado para el proyecto chars-ai-healt-54**
**Versión: 1.0.0**
**Última actualización: $(Get-Date -Format 'yyyy-MM-dd')**
