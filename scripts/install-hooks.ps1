# Script de Instalación de Hooks de Git
# Configura automáticamente los hooks para detección y reparación automática

param(
    [switch]$Force = $false
)

Write-Host "=== INSTALANDO HOOKS DE GIT AUTOMÁTICOS ===" -ForegroundColor Cyan

# Verificar si estamos en un repositorio Git
try {
    $null = git rev-parse --git-dir 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: No se detectó un repositorio Git válido" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "ERROR: No se detectó un repositorio Git válido" -ForegroundColor Red
    exit 1
}

# Obtener la ruta del directorio .git/hooks
$GitHooksDir = Join-Path (git rev-parse --git-dir) "hooks"
$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Crear directorio de hooks si no existe
if (-not (Test-Path $GitHooksDir)) {
    New-Item -ItemType Directory -Path $GitHooksDir -Force | Out-Null
    Write-Host "Directorio de hooks creado: $GitHooksDir" -ForegroundColor Green
}

# Función para instalar un hook
function Install-Hook {
    param(
        [string]$HookName,
        [string]$SourceScript
    )
    
    $HookPath = Join-Path $GitHooksDir $HookName
    $SourcePath = Join-Path $ScriptsDir $SourceScript
    
    if (Test-Path $HookPath -and -not $Force) {
        Write-Host "Hook $HookName ya existe. Usa -Force para sobrescribir." -ForegroundColor Yellow
        return
    }
    
    try {
        # Crear el contenido del hook
        $HookContent = @"
#!/bin/sh
# Hook automático generado por el sistema de reparación
# Ejecuta el script de PowerShell correspondiente

powershell.exe -ExecutionPolicy Bypass -File "$SourcePath" "$@"
"@
        
        # Escribir el archivo del hook
        [System.IO.File]::WriteAllText($HookPath, $HookContent, [System.Text.Encoding]::UTF8)
        
        # Hacer el archivo ejecutable (en sistemas Unix)
        if ($IsLinux -or $IsMacOS) {
            chmod +x $HookPath
        }
        
        Write-Host "Hook $HookName instalado exitosamente" -ForegroundColor Green
    }
    catch {
        Write-Host "Error al instalar hook $HookName : $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Instalar hooks
Write-Host "Instalando hooks de Git..." -ForegroundColor Yellow

# Pre-commit hook
Install-Hook -HookName "pre-commit" -SourceScript "pre-commit-hook.ps1"

# Pre-push hook (opcional)
Install-Hook -HookName "pre-push" -SourceScript "pre-commit-hook.ps1"

# Post-commit hook (para notificaciones)
$PostCommitContent = @"
#!/bin/sh
# Post-commit hook para notificaciones
echo "Commit realizado exitosamente: $(git log -1 --pretty=format:'%h - %s')"
"@

$PostCommitPath = Join-Path $GitHooksDir "post-commit"
[System.IO.File]::WriteAllText($PostCommitPath, $PostCommitContent, [System.Text.Encoding]::UTF8)

if ($IsLinux -or $IsMacOS) {
    chmod +x $PostCommitPath
}

Write-Host "Hook post-commit instalado" -ForegroundColor Green

# Crear script de desinstalación
$UninstallScript = @"
# Script de Desinstalación de Hooks
Write-Host "Desinstalando hooks de Git..." -ForegroundColor Yellow

`$GitHooksDir = Join-Path (git rev-parse --git-dir) "hooks"
`$HooksToRemove = @("pre-commit", "pre-push", "post-commit")

foreach (`$hook in `$HooksToRemove) {
    `$hookPath = Join-Path `$GitHooksDir `$hook
    if (Test-Path `$hookPath) {
        Remove-Item `$hookPath -Force
        Write-Host "Hook `$hook desinstalado" -ForegroundColor Green
    }
}

Write-Host "Hooks desinstalados exitosamente" -ForegroundColor Green
"@

$UninstallPath = Join-Path $ScriptsDir "uninstall-hooks.ps1"
[System.IO.File]::WriteAllText($UninstallPath, $UninstallScript, [System.Text.Encoding]::UTF8)

Write-Host "Script de desinstalación creado: $UninstallPath" -ForegroundColor Green

# Crear archivo de configuración
$ConfigContent = @"
# Configuración de Hooks Automáticos
# Fecha de instalación: $(Get-Date)
# Repositorio: $(git remote get-url origin)

# Hooks instalados:
# - pre-commit: Ejecuta reparación automática antes de cada commit
# - pre-push: Ejecuta reparación automática antes de cada push
# - post-commit: Muestra notificación después de cada commit

# Scripts disponibles:
# - auto-fix-git.ps1: Script principal de reparación
# - pre-commit-hook.ps1: Hook de pre-commit
# - install-hooks.ps1: Script de instalación
# - uninstall-hooks.ps1: Script de desinstalación

# Para ejecutar reparación manual:
# powershell.exe -ExecutionPolicy Bypass -File "scripts/auto-fix-git.ps1"
"@

$ConfigPath = Join-Path $ScriptsDir "hooks-config.txt"
[System.IO.File]::WriteAllText($ConfigPath, $ConfigContent, [System.Text.Encoding]::UTF8)

Write-Host "Archivo de configuración creado: $ConfigPath" -ForegroundColor Green

Write-Host "=== INSTALACIÓN COMPLETADA ===" -ForegroundColor Green
Write-Host "Los hooks se ejecutarán automáticamente en cada commit" -ForegroundColor Cyan
Write-Host "Para desinstalar, ejecuta: scripts/uninstall-hooks.ps1" -ForegroundColor Yellow
