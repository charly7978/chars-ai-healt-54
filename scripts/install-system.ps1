# Script de Instalación del Sistema Automático de Git
Write-Host "=== INSTALACIÓN DEL SISTEMA AUTOMÁTICO DE GIT ===" -ForegroundColor Cyan

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

Write-Host "Repositorio detectado correctamente" -ForegroundColor Green

# Crear directorio de hooks si no existe
$GitHooksDir = Join-Path (git rev-parse --git-dir) "hooks"
if (-not (Test-Path $GitHooksDir)) {
    New-Item -ItemType Directory -Path $GitHooksDir -Force | Out-Null
    Write-Host "Directorio de hooks creado" -ForegroundColor Green
}

# Crear hook pre-commit
$PreCommitContent = "#!/bin/sh`n# Hook pre-commit automático`necho '=== HOOK PRE-COMMIT ACTIVADO ==='`necho 'Ejecutando reparación automática...'`n`npowershell.exe -ExecutionPolicy Bypass -File 'scripts/auto-fix-git.ps1' -CommitMessage 'Auto-fix pre-commit'`n`nif [ `$? -eq 0 ]; then`n    echo 'Hook pre-commit completado exitosamente'`n    exit 0`nelse`n    echo 'Error en hook pre-commit'`n    exit 1`nfi"

$PreCommitPath = Join-Path $GitHooksDir "pre-commit"
[System.IO.File]::WriteAllText($PreCommitPath, $PreCommitContent, [System.Text.Encoding]::UTF8)
Write-Host "Hook pre-commit instalado" -ForegroundColor Green

# Crear hook post-commit
$PostCommitContent = "#!/bin/sh`n# Hook post-commit para notificaciones`necho 'Commit realizado exitosamente: $(git log -1 --pretty=format:'%h - %s')'"

$PostCommitPath = Join-Path $GitHooksDir "post-commit"
[System.IO.File]::WriteAllText($PostCommitPath, $PostCommitContent, [System.Text.Encoding]::UTF8)
Write-Host "Hook post-commit instalado" -ForegroundColor Green

# Crear script de estado
$StatusContent = @"
Write-Host "=== ESTADO DEL SISTEMA AUTOMÁTICO DE GIT ===" -ForegroundColor Cyan

# Verificar scripts
`$scripts = @("auto-fix-git.ps1", "pre-commit-hook.ps1", "git-monitor.ps1")
Write-Host "Scripts disponibles:" -ForegroundColor Yellow
foreach (`$script in `$scripts) {
    `$path = "scripts/`$script"
    if (Test-Path `$path) {
        Write-Host "  ✓ `$script" -ForegroundColor Green
    } else {
        Write-Host "  ✗ `$script" -ForegroundColor Red
    }
}

# Verificar hooks
Write-Host "`nHooks de Git:" -ForegroundColor Yellow
`$hooks = @("pre-commit", "post-commit")
foreach (`$hook in `$hooks) {
    `$hookPath = ".git/hooks/`$hook"
    if (Test-Path `$hookPath) {
        Write-Host "  ✓ `$hook" -ForegroundColor Green
    } else {
        Write-Host "  ✗ `$hook" -ForegroundColor Red
    }
}

# Estado del repositorio
Write-Host "`nEstado del repositorio:" -ForegroundColor Yellow
try {
    `$status = git status --porcelain
    if (`$status) {
        Write-Host "  ⚠ Cambios sin commitear detectados" -ForegroundColor Yellow
    } else {
        Write-Host "  ✓ Repositorio limpio" -ForegroundColor Green
    }
} catch {
    Write-Host "  ✗ Error al verificar estado" -ForegroundColor Red
}
"@

$StatusPath = "scripts/system-status.ps1"
[System.IO.File]::WriteAllText($StatusPath, $StatusContent, [System.Text.Encoding]::UTF8)
Write-Host "Script de estado creado" -ForegroundColor Green

# Crear script de limpieza
$CleanupContent = @"
Write-Host "=== LIMPIEZA DEL SISTEMA AUTOMÁTICO ===" -ForegroundColor Cyan

# Limpiar archivos temporales
Write-Host "Limpiando archivos temporales..." -ForegroundColor Yellow
`$tempFiles = Get-ChildItem -Path . -Name @("tamp*", "tatus*", "et --hard*") -File -ErrorAction SilentlyContinue
foreach (`$tempFile in `$tempFiles) {
    Remove-Item `$tempFile -Force
    Write-Host "Archivo temporal eliminado: `$tempFile" -ForegroundColor Green
}

Write-Host "Limpieza completada" -ForegroundColor Green
"@

$CleanupPath = "scripts/system-cleanup.ps1"
[System.IO.File]::WriteAllText($CleanupPath, $CleanupContent, [System.Text.Encoding]::UTF8)
Write-Host "Script de limpieza creado" -ForegroundColor Green

# Crear script de inicio rápido
$QuickStartContent = @"
Write-Host "=== SISTEMA AUTOMÁTICO DE GIT - INICIO RÁPIDO ===" -ForegroundColor Cyan
Write-Host "Comandos disponibles:" -ForegroundColor Yellow
Write-Host "  .\scripts\auto-fix-git.ps1          - Reparación manual" -ForegroundColor White
Write-Host "  .\scripts\system-status.ps1         - Estado del sistema" -ForegroundColor White
Write-Host "  .\scripts\system-cleanup.ps1        - Limpiar sistema" -ForegroundColor White
Write-Host "`nEl sistema está configurado y listo para usar." -ForegroundColor Green
Write-Host "Los hooks se ejecutarán automáticamente en cada commit." -ForegroundColor Cyan
"@

$QuickStartPath = "scripts/quick-start.ps1"
[System.IO.File]::WriteAllText($QuickStartPath, $QuickStartContent, [System.Text.Encoding]::UTF8)
Write-Host "Script de inicio rápido creado" -ForegroundColor Green

# Probar el sistema
Write-Host "`nProbando sistema..." -ForegroundColor Yellow
try {
    & "scripts/auto-fix-git.ps1" -Verbose
    Write-Host "✓ Sistema funcionando correctamente" -ForegroundColor Green
}
catch {
    Write-Host "✗ Error en prueba del sistema: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== INSTALACIÓN COMPLETADA ===" -ForegroundColor Green
Write-Host "Sistema automático de Git instalado exitosamente" -ForegroundColor Green
Write-Host "Para usar: .\scripts\quick-start.ps1" -ForegroundColor Cyan
