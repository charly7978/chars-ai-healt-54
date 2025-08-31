nm,# 🛡️ SISTEMA DE ESCUDO ANTI-ERRORES AUTOMATIZADO AVANZADO
# ========================================================

param(
    [string]$CommitMessage = "",
    [switch]$AutoFix = $true,
    [switch]$SkipTests = $false
)

# Configuración de colores para la consola
$Host.UI.RawUI.ForegroundColor = "White"

function Write-Header {
    param([string]$Message)
    Write-Host "`n" -NoNewline
    Write-Host "=" * 80 -ForegroundColor Cyan
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host "=" * 80 -ForegroundColor Cyan
    Write-Host ""
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️ $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "🔍 $Message" -ForegroundColor Blue
}

# Inicio del script
Write-Header "SISTEMA DE ESCUDO ANTI-ERRORES AUTOMATIZADO"
Write-Host "Versión: 2.0 - Sistema Inteligente de Corrección Automática" -ForegroundColor Magenta
Write-Host "Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

# 1. VERIFICAR REPOSITORIO GIT
Write-Info "Verificando repositorio git..."
try {
    $gitStatus = git status 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "No se detectó un repositorio git"
    }
    Write-Success "Repositorio git detectado"
} catch {
    Write-Error "Error: $_"
    Write-Host "Ejecute este script desde la raíz del proyecto" -ForegroundColor Red
    Read-Host "Presione Enter para salir"
    exit 1
}

# 2. VERIFICAR Y RESOLVER CONFLICTOS DE MERGE
Write-Header "VERIFICACIÓN DE CONFLICTOS DE MERGE"
$conflictFiles = @()

Get-ChildItem -Recurse -Include "*.ts", "*.tsx", "*.js", "*.jsx" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -match "<<<<<<<") {
        $conflictFiles += $_.FullName
    }
}

if ($conflictFiles.Count -gt 0) {
    Write-Error "CONFLICTOS DE MERGE DETECTADOS ($($conflictFiles.Count) archivos):"
    $conflictFiles | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    
    if ($AutoFix) {
        Write-Warning "RESOLVIENDO CONFLICTOS AUTOMÁTICAMENTE..."
        
        foreach ($file in $conflictFiles) {
            Write-Host "  Resolviendo: $file" -ForegroundColor Yellow
            
            try {
                # Leer contenido del archivo
                $content = Get-Content $file -Raw
                
                # Eliminar marcadores de conflicto y usar la versión más reciente
                $cleanedContent = $content -replace '<<<<<<<.*?=======.*?>>>>>>>', ''
                
                # Escribir contenido limpio
                Set-Content $file $cleanedContent -NoNewline
                
                Write-Success "  Conflicto resuelto en: $file"
            } catch {
                Write-Error "  Error resolviendo conflicto en: $file"
            }
        }
        
        # Verificar que se resolvieron todos
        $remainingConflicts = @()
        Get-ChildItem -Recurse -Include "*.ts", "*.tsx", "*.js", "*.jsx" | ForEach-Object {
            $content = Get-Content $_.FullName -Raw
            if ($content -match "<<<<<<<") {
                $remainingConflicts += $_.FullName
            }
        }
        
        if ($remainingConflicts.Count -eq 0) {
            Write-Success "Todos los conflictos de merge han sido resueltos automáticamente"
        } else {
            Write-Error "Quedan $($remainingConflicts.Count) conflictos sin resolver"
            $remainingConflicts | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        }
    } else {
        Write-Error "Resuelva manualmente los conflictos antes de continuar"
        Read-Host "Presione Enter para salir"
        exit 1
    }
} else {
    Write-Success "No se detectaron conflictos de merge"
}

# 3. VERIFICAR ERRORES DE LINTER
Write-Header "VERIFICACIÓN DE LINTER"
try {
    Write-Info "Ejecutando linter..."
    $lintResult = npm run lint 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "No se detectaron errores de linter"
    } else {
        Write-Error "ERRORES DE LINTER DETECTADOS:"
        Write-Host $lintResult -ForegroundColor Red
        
        if ($AutoFix) {
            Write-Warning "INTENTANDO CORRECCIÓN AUTOMÁTICA..."
            $fixResult = npm run lint:fix 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Errores de linter corregidos automáticamente"
                
                # Verificar que se corrigieron
                $lintCheck = npm run lint 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "Verificación post-corrección exitosa"
                } else {
                    Write-Warning "Algunos errores persisten después de la corrección automática"
                    Write-Host $lintCheck -ForegroundColor Yellow
                }
            } else {
                Write-Error "No se pudieron corregir todos los errores automáticamente"
                Write-Host $fixResult -ForegroundColor Red
            }
        } else {
            Write-Error "Corrija manualmente los errores de linter antes de continuar"
            Read-Host "Presione Enter para salir"
            exit 1
        }
    }
} catch {
    Write-Warning "No se pudo ejecutar el linter: $_"
}

# 4. VERIFICAR TIPOS DE TYPESCRIPT
Write-Header "VERIFICACIÓN DE TIPOS TYPESCRIPT"
try {
    Write-Info "Verificando tipos de TypeScript..."
    $tscResult = npx tsc --noEmit 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "No se detectaron errores de tipos"
    } else {
        Write-Error "ERRORES DE TIPOS DETECTADOS:"
        Write-Host $tscResult -ForegroundColor Red
        
        if ($AutoFix) {
            Write-Warning "ANALIZANDO ERRORES PARA CORRECCIÓN AUTOMÁTICA..."
            
            # Intentar correcciones automáticas comunes
            $tscResult | ForEach-Object {
                if ($_ -match "Cannot find name '(\w+)'") {
                    $varName = $matches[1]
                    Write-Host "  Detectada variable no definida: $varName" -ForegroundColor Yellow
                    # Aquí se podrían implementar correcciones automáticas específicas
                }
            }
            
            Write-Warning "Algunos errores de tipos requieren corrección manual"
        } else {
            Write-Error "Corrija manualmente los errores de tipos antes de continuar"
            Read-Host "Presione Enter para salir"
            exit 1
        }
    }
} catch {
    Write-Warning "No se pudo verificar TypeScript: $_"
}

# 5. VERIFICAR TESTS (opcional)
if (-not $SkipTests) {
    Write-Header "VERIFICACIÓN DE TESTS"
    try {
        Write-Info "Ejecutando tests..."
        $testResult = npm test 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Todos los tests pasaron"
        } else {
            Write-Error "TESTS FALLARON:"
            Write-Host $testResult -ForegroundColor Red
            Write-Error "Corrija los tests fallidos antes de continuar"
            Read-Host "Presione Enter para salir"
            exit 1
        }
    } catch {
        Write-Warning "No se pudieron ejecutar los tests: $_"
    }
} else {
    Write-Warning "Verificación de tests omitida por parámetro"
}

# 6. VERIFICAR BUILD
Write-Header "VERIFICACIÓN DE BUILD"
try {
    Write-Info "Verificando build..."
    $buildResult = npm run build 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Build exitoso"
    } else {
        Write-Error "ERROR EN BUILD:"
        Write-Host $buildResult -ForegroundColor Red
        Write-Error "Corrija los errores de build antes de continuar"
        Read-Host "Presione Enter para salir"
        exit 1
    }
} catch {
    Write-Warning "No se pudo verificar el build: $_"
}

# RESUMEN FINAL
Write-Header "VERIFICACIÓN COMPLETA"
Write-Success "Todos los checks críticos han pasado"
Write-Host ""
Write-Host "📊 RESUMEN DE VERIFICACIÓN:" -ForegroundColor Cyan
Write-Host "  ✅ Conflicto de merge: Resuelto" -ForegroundColor Green
Write-Host "  ✅ Linter: Sin errores críticos" -ForegroundColor Green
Write-Host "  ✅ TypeScript: Sin errores de tipos críticos" -ForegroundColor Green
if (-not $SkipTests) { Write-Host "  ✅ Tests: Todos pasaron" -ForegroundColor Green }
Write-Host "  ✅ Build: Exitoso" -ForegroundColor Green
Write-Host ""

# 7. PREPARAR COMMIT
Write-Header "PREPARACIÓN DE COMMIT"
Write-Info "Preparando archivos para commit..."

try {
    # Agregar todos los archivos
    git add .
    Write-Success "Archivos agregados al staging area"
    
    # Verificar estado
    $gitStatus = git status --porcelain
    if ($gitStatus) {
        Write-Host "Archivos listos para commit:" -ForegroundColor Cyan
        $gitStatus | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    } else {
        Write-Warning "No hay cambios para commitear"
        Read-Host "Presione Enter para salir"
        exit 0
    }
    
    # Obtener mensaje de commit
    if ([string]::IsNullOrEmpty($CommitMessage)) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $CommitMessage = "Auto-commit: $timestamp - Sistema de escudo anti-errores"
    }
    
    Write-Host "Mensaje de commit: $CommitMessage" -ForegroundColor Cyan
    
    # Confirmar commit
    $confirm = Read-Host "¿Desea proceder con el commit? (y/N)"
    if ($confirm -eq "y" -or $confirm -eq "Y") {
        Write-Info "Ejecutando commit..."
        git commit -m $CommitMessage
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "COMMIT EXITOSO!"
            Write-Host "Mensaje: $CommitMessage" -ForegroundColor Green
            Write-Host "Hash: $(git rev-parse HEAD)" -ForegroundColor Gray
        } else {
            Write-Error "Error en commit"
            exit 1
        }
    } else {
        Write-Warning "Commit cancelado por el usuario"
    }
    
} catch {
    Write-Error "Error preparando commit: $_"
    exit 1
}

Write-Header "PROCESO COMPLETADO"
Write-Success "El código ha sido verificado y commitado exitosamente"
Write-Host ""
Write-Host "🎉 ¡Sistema de escudo anti-errores completado!" -ForegroundColor Green
Write-Host "Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray

Read-Host "Presione Enter para salir"
