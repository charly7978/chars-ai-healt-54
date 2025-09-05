# Script de Configuración Principal del Sistema Automático de Git
# Configura completamente el sistema de detección y reparación automática

param(
    [switch]$Force = $false,
    [switch]$SkipHooks = $false,
    [switch]$SkipMonitor = $false,
    [switch]$Verbose = $false
)

Write-Host "=== CONFIGURACIÓN DEL SISTEMA AUTOMÁTICO DE GIT ===" -ForegroundColor Cyan
Write-Host "Configurando sistema completo de detección y reparación automática..." -ForegroundColor Yellow

# Verificar si estamos en un repositorio Git
try {
    $null = git rev-parse --git-dir 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: No se detectó un repositorio Git válido" -ForegroundColor Red
        Write-Host "Asegúrate de estar en un directorio con un repositorio Git inicializado" -ForegroundColor Yellow
        exit 1
    }
}
catch {
    Write-Host "ERROR: No se detectó un repositorio Git válido" -ForegroundColor Red
    exit 1
}

$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = git rev-parse --show-toplevel

Write-Host "Repositorio: $RepoRoot" -ForegroundColor Green
Write-Host "Scripts: $ScriptsDir" -ForegroundColor Green

# Función para verificar dependencias
function Test-Dependencies {
    Write-Host "Verificando dependencias..." -ForegroundColor Yellow
    
    $dependencies = @{
        "Git" = $false
        "Node.js" = $false
        "npm" = $false
        "PowerShell" = $false
    }
    
    # Verificar Git
    try {
        $gitVersion = git --version
        $dependencies["Git"] = $true
        Write-Host "✓ Git: $gitVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Git no encontrado" -ForegroundColor Red
    }
    
    # Verificar Node.js
    try {
        $nodeVersion = node --version
        $dependencies["Node.js"] = $true
        Write-Host "✓ Node.js: $nodeVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Node.js no encontrado" -ForegroundColor Red
    }
    
    # Verificar npm
    try {
        $npmVersion = npm --version
        $dependencies["npm"] = $true
        Write-Host "✓ npm: $npmVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ npm no encontrado" -ForegroundColor Red
    }
    
    # Verificar PowerShell
    try {
        $psVersion = $PSVersionTable.PSVersion
        $dependencies["PowerShell"] = $true
        Write-Host "✓ PowerShell: $psVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ PowerShell no disponible" -ForegroundColor Red
    }
    
    $missingDeps = $dependencies.GetEnumerator() | Where-Object { -not $_.Value }
    
    if ($missingDeps) {
        Write-Host "Dependencias faltantes:" -ForegroundColor Red
        foreach ($dep in $missingDeps) {
            Write-Host "  - $($dep.Key)" -ForegroundColor Red
        }
        return $false
    }
    
    Write-Host "Todas las dependencias están disponibles" -ForegroundColor Green
    return $true
}

# Función para crear archivos de configuración
function New-ConfigurationFiles {
    Write-Host "Creando archivos de configuración..." -ForegroundColor Yellow
    
    # Crear .gitignore para scripts si no existe
    $gitignorePath = Join-Path $RepoRoot ".gitignore"
    $gitignoreContent = @"
# Archivos de configuración del sistema automático
scripts/git-monitor.log
scripts/hooks-config.txt
*.log

# Archivos temporales
*.tmp
*.temp
tamp*
tatus*
"et --hard*"

# node_modules (si no está ya)
node_modules/
"@
    
    if (Test-Path $gitignorePath) {
        $currentContent = Get-Content $gitignorePath -Raw
        if ($currentContent -notmatch "scripts/git-monitor.log") {
            Add-Content -Path $gitignorePath -Value "`n# Sistema automático de Git`nscripts/git-monitor.log`nscripts/hooks-config.txt" -Encoding UTF8
            Write-Host "Actualizado .gitignore" -ForegroundColor Green
        }
    }
    else {
        [System.IO.File]::WriteAllText($gitignorePath, $gitignoreContent, [System.Text.Encoding]::UTF8)
        Write-Host "Creado .gitignore" -ForegroundColor Green
    }
    
    # Crear archivo de configuración del sistema
    $configContent = @"
# Configuración del Sistema Automático de Git
# Fecha de instalación: $(Get-Date)
# Repositorio: $(try { git remote get-url origin } catch { "Local" })

[General]
Version = "1.0.0"
InstallDate = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Repository = "$(try { git remote get-url origin } catch { 'Local' })"

[Scripts]
AutoFixScript = "scripts/auto-fix-git.ps1"
PreCommitHook = "scripts/pre-commit-hook.ps1"
MonitorScript = "scripts/git-monitor.ps1"
InstallHooksScript = "scripts/install-hooks.ps1"

[Settings]
CheckInterval = 30
AutoCommit = true
AutoPush = true
VerboseLogging = $Verbose

[Features]
FileCleanup = true
DependencyRepair = true
GitStateRepair = true
ViteConfigRepair = true
RemoteSync = true
AutoCommit = true
AutoPush = true
"@
    
    $configPath = Join-Path $ScriptsDir "system-config.ini"
    [System.IO.File]::WriteAllText($configPath, $configContent, [System.Text.Encoding]::UTF8)
    Write-Host "Archivo de configuración creado: $configPath" -ForegroundColor Green
}

# Función para crear scripts de utilidad
function New-UtilityScripts {
    Write-Host "Creando scripts de utilidad..." -ForegroundColor Yellow
    
    # Script de estado del sistema
    $statusScript = @'
# Script de Estado del Sistema Automático de Git
Write-Host "=== ESTADO DEL SISTEMA AUTOMÁTICO DE GIT ===" -ForegroundColor Cyan

# Verificar scripts
$scripts = @(
    "auto-fix-git.ps1",
    "pre-commit-hook.ps1", 
    "git-monitor.ps1",
    "install-hooks.ps1"
)

Write-Host "Scripts disponibles:" -ForegroundColor Yellow
foreach ($script in $scripts) {
    $path = "scripts/$script"
    if (Test-Path $path) {
        Write-Host "  ✓ $script" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $script" -ForegroundColor Red
    }
}

# Verificar hooks
Write-Host "`nHooks de Git:" -ForegroundColor Yellow
$hooks = @("pre-commit", "pre-push", "post-commit")
foreach ($hook in $hooks) {
    $hookPath = ".git/hooks/$hook"
    if (Test-Path $hookPath) {
        Write-Host "  ✓ $hook" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $hook" -ForegroundColor Red
    }
}

# Verificar monitores activos
Write-Host "`nMonitores activos:" -ForegroundColor Yellow
$jobs = Get-Job | Where-Object { $_.Command -like "*git-monitor*" }
if ($jobs) {
    foreach ($job in $jobs) {
        Write-Host "  ✓ Monitor $($job.Id): $($job.State)" -ForegroundColor Green
    }
} else {
    Write-Host "  ✗ No hay monitores activos" -ForegroundColor Red
}

# Estado del repositorio
Write-Host "`nEstado del repositorio:" -ForegroundColor Yellow
try {
    $status = git status --porcelain
    if ($status) {
        Write-Host "  ⚠ Cambios sin commitear detectados" -ForegroundColor Yellow
    } else {
        Write-Host "  ✓ Repositorio limpio" -ForegroundColor Green
    }
} catch {
    Write-Host "  ✗ Error al verificar estado" -ForegroundColor Red
}
'@
    
    $statusPath = Join-Path $ScriptsDir "system-status.ps1"
    [System.IO.File]::WriteAllText($statusPath, $statusScript, [System.Text.Encoding]::UTF8)
    Write-Host "Script de estado creado: $statusPath" -ForegroundColor Green
    
    # Script de limpieza
    $cleanupScript = @'
# Script de Limpieza del Sistema
Write-Host "=== LIMPIEZA DEL SISTEMA AUTOMÁTICO ===" -ForegroundColor Cyan

# Detener monitores
Write-Host "Deteniendo monitores..." -ForegroundColor Yellow
$jobs = Get-Job | Where-Object { $_.Command -like "*git-monitor*" }
foreach ($job in $jobs) {
    Stop-Job $job.Id
    Remove-Job $job.Id
    Write-Host "Monitor $($job.Id) detenido" -ForegroundColor Green
}

# Limpiar archivos de log
Write-Host "Limpiando archivos de log..." -ForegroundColor Yellow
$logFiles = Get-ChildItem -Path "scripts" -Name "*.log" -ErrorAction SilentlyContinue
foreach ($logFile in $logFiles) {
    Remove-Item "scripts/$logFile" -Force
    Write-Host "Log eliminado: $logFile" -ForegroundColor Green
}

# Limpiar archivos temporales
Write-Host "Limpiando archivos temporales..." -ForegroundColor Yellow
$tempFiles = Get-ChildItem -Path . -Name @("tamp*", "tatus*", "et --hard*") -File -ErrorAction SilentlyContinue
foreach ($tempFile in $tempFiles) {
    Remove-Item $tempFile -Force
    Write-Host "Archivo temporal eliminado: $tempFile" -ForegroundColor Green
}

Write-Host "Limpieza completada" -ForegroundColor Green
'@
    
    $cleanupPath = Join-Path $ScriptsDir "system-cleanup.ps1"
    [System.IO.File]::WriteAllText($cleanupPath, $cleanupScript, [System.Text.Encoding]::UTF8)
    Write-Host "Script de limpieza creado: $cleanupPath" -ForegroundColor Green
}

# Función para probar el sistema
function Test-System {
    Write-Host "Probando sistema..." -ForegroundColor Yellow
    
    # Probar script de reparación automática
    try {
        Write-Host "Probando script de reparación automática..." -ForegroundColor Cyan
        & (Join-Path $ScriptsDir "auto-fix-git.ps1") -Verbose:$Verbose
        Write-Host "✓ Script de reparación funcionando" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Error en script de reparación: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # Probar script de estado
    try {
        Write-Host "Probando script de estado..." -ForegroundColor Cyan
        & (Join-Path $ScriptsDir "system-status.ps1")
        Write-Host "✓ Script de estado funcionando" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Error en script de estado: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Función principal
function Start-Setup {
    Write-Host "Iniciando configuración del sistema..." -ForegroundColor Yellow
    
    # 1. Verificar dependencias
    if (-not (Test-Dependencies)) {
        Write-Host "ERROR: Faltan dependencias requeridas" -ForegroundColor Red
        exit 1
    }
    
    # 2. Crear archivos de configuración
    New-ConfigurationFiles
    
    # 3. Crear scripts de utilidad
    New-UtilityScripts
    
    # 4. Instalar hooks (si no se saltó)
    if (-not $SkipHooks) {
        Write-Host "Instalando hooks de Git..." -ForegroundColor Yellow
        & (Join-Path $ScriptsDir "install-hooks.ps1") -Force:$Force
    }
    
    # 5. Probar sistema
    Test-System
    
    # 6. Crear script de inicio rápido
    $quickStartScript = @'
# Script de Inicio Rápido del Sistema Automático de Git
Write-Host "=== SISTEMA AUTOMÁTICO DE GIT - INICIO RÁPIDO ===" -ForegroundColor Cyan

Write-Host "Comandos disponibles:" -ForegroundColor Yellow
Write-Host "  .\scripts\auto-fix-git.ps1          - Reparación manual" -ForegroundColor White
Write-Host "  .\scripts\git-monitor.ps1 start     - Iniciar monitor" -ForegroundColor White
Write-Host "  .\scripts\git-monitor.ps1 status    - Ver estado" -ForegroundColor White
Write-Host "  .\scripts\system-status.ps1         - Estado del sistema" -ForegroundColor White
Write-Host "  .\scripts\system-cleanup.ps1        - Limpiar sistema" -ForegroundColor White

Write-Host "`nEl sistema está configurado y listo para usar." -ForegroundColor Green
Write-Host "Los hooks se ejecutarán automáticamente en cada commit." -ForegroundColor Cyan
'@
    
    $quickStartPath = Join-Path $ScriptsDir "quick-start.ps1"
    [System.IO.File]::WriteAllText($quickStartPath, $quickStartScript, [System.Text.Encoding]::UTF8)
    Write-Host "Script de inicio rápido creado: $quickStartPath" -ForegroundColor Green
    
    Write-Host "`n=== CONFIGURACIÓN COMPLETADA ===" -ForegroundColor Green
    Write-Host "Sistema automático de Git configurado exitosamente" -ForegroundColor Green
    Write-Host "Para usar: .\scripts\quick-start.ps1" -ForegroundColor Cyan
}

# Ejecutar configuración
Start-Setup
