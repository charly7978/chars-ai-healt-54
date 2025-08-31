# 🛡️ Sistema de Protección Automática para Git

Este sistema protege automáticamente tu repositorio contra conflictos de merge y errores de build, permitiendo commits seguros y automáticos.

## 🚀 Instalación Rápida

### 1. Instalar Protección Automática
```bash
# Ejecutar desde la raíz del proyecto
scripts\install-auto-protection.bat
```

### 2. Verificar Instalación
```bash
# Verificar que los hooks están instalados
dir .git\hooks
```

## 📋 Scripts Disponibles

### 🔧 `install-auto-protection.bat`
- **Propósito**: Instala toda la protección automática
- **Uso**: Ejecutar una vez desde la raíz del proyecto
- **Funciones**:
  - Configura hooks de git automáticos
  - Verifica que el proyecto compile
  - Instala protección contra conflictos de merge

### 🛡️ `merge-protector.bat`
- **Propósito**: Resuelve conflictos de merge automáticamente
- **Uso**: `scripts\merge-protector.bat`
- **Funciones**:
  - Detecta archivos con conflictos
  - Elimina marcadores de conflicto automáticamente
  - Agrega archivos resueltos al staging

### 🚀 `smart-commit.bat`
- **Propósito**: Commit inteligente con resolución automática
- **Uso**: `scripts\smart-commit.bat`
- **Funciones**:
  - Resuelve conflictos automáticamente
  - Verifica build antes del commit
  - Solicita mensaje de commit
  - Realiza commit seguro

### ⚙️ `setup-git-hooks.bat`
- **Propósito**: Configura hooks de git manualmente
- **Uso**: `scripts\setup-git-hooks.bat`
- **Funciones**:
  - Instala hooks de pre-commit y post-commit
  - Configura verificación automática

## 🎯 Cómo Funciona

### Hooks Automáticos
1. **Pre-commit**: Se ejecuta antes de cada commit
   - Verifica conflictos de merge
   - Verifica que el proyecto compile
   - Bloquea commit si hay problemas

2. **Post-commit**: Se ejecuta después de cada commit
   - Confirma commit exitoso
   - Muestra hash del commit

### Flujo de Trabajo Recomendado

#### Opción 1: Commit Manual (Recomendado)
```bash
# 1. Agregar cambios
git add .

# 2. Hacer commit (verificación automática)
git commit -m "Tu mensaje"
```

#### Opción 2: Commit Inteligente
```bash
# Commit con resolución automática
scripts\smart-commit.bat
```

#### Opción 3: Resolver Conflictos Manualmente
```bash
# Si hay conflictos de merge
scripts\merge-protector.bat
```

## 🚨 Resolución de Problemas

### Error: "Build falló"
```bash
# 1. Corregir errores de compilación
npm run build

# 2. Intentar commit nuevamente
git commit -m "Mensaje"
```

### Error: "Conflictos de merge detectados"
```bash
# 1. Resolver conflictos automáticamente
scripts\merge-protector.bat

# 2. Continuar con commit
git commit -m "Mensaje"
```

### Error: "Hook no encontrado"
```bash
# Reinstalar hooks
scripts\setup-git-hooks.bat
```

## 📊 Estado del Sistema

### Verificar Hooks Instalados
```bash
dir .git\hooks
```

### Verificar Estado de Git
```bash
git status
```

### Verificar Build
```bash
npm run build
```

## 🔧 Personalización

### Modificar Hooks
Los hooks se encuentran en `.git\hooks\`:
- `pre-commit.bat`: Verificación antes del commit
- `post-commit.bat`: Acciones después del commit

### Agregar Verificaciones Adicionales
Edita `pre-commit.bat` para agregar:
- Linting de código
- Tests automáticos
- Verificación de formato

## 🎉 Beneficios

✅ **Protección Automática**: Cada commit se verifica automáticamente
✅ **Resolución de Conflictos**: Conflictos de merge se resuelven automáticamente
✅ **Verificación de Build**: Solo se permiten commits que compilan
✅ **Fácil de Usar**: Funciona con comandos git normales
✅ **Personalizable**: Se adapta a las necesidades del proyecto

## 🚀 Comandos de Ejemplo

```bash
# Instalar protección
scripts\install-auto-protection.bat

# Commit normal (con verificación automática)
git add .
git commit -m "Nueva funcionalidad"

# Commit inteligente
scripts\smart-commit.bat

# Resolver conflictos
scripts\merge-protector.bat
```

## 💡 Consejos

1. **Ejecuta `install-auto-protection.bat` una vez** al configurar el proyecto
2. **Usa commits normales** - la verificación es automática
3. **Si hay conflictos**, usa `merge-protector.bat` para resolución automática
4. **Verifica el build** antes de hacer commit si tienes dudas
5. **Los hooks se ejecutan automáticamente** - no necesitas hacer nada especial

---

🛡️ **Tu repositorio está protegido 24/7 con verificación automática**
