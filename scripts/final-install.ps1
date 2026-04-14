# Script de Instalación Final del Sistema Automático de Git
Write-Host "=== INSTALACIÓN FINAL DEL SISTEMA AUTOMÁTICO DE GIT ===" -ForegroundColor Cyan

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
$PreCommitPath = Join-Path $GitHooksDir "pre-commit"
$PreCommitContent = "#!/bin/sh`necho '=== HOOK PRE-COMMIT ACTIVADO ==='`necho 'Ejecutando reparación automática...'`npowershell.exe -ExecutionPolicy Bypass -File 'scripts/auto-fix-git.ps1' -CommitMessage 'Auto-fix pre-commit'`necho 'Hook pre-commit completado'"

[System.IO.File]::WriteAllText($PreCommitPath, $PreCommitContent, [System.Text.Encoding]::UTF8)
Write-Host "Hook pre-commit instalado" -ForegroundColor Green

# Crear hook post-commit
$PostCommitPath = Join-Path $GitHooksDir "post-commit"
$PostCommitContent = "#!/bin/sh`necho 'Commit realizado exitosamente: $(git log -1 --pretty=format:'%h - %s')'"

[System.IO.File]::WriteAllText($PostCommitPath, $PostCommitContent, [System.Text.Encoding]::UTF8)
Write-Host "Hook post-commit instalado" -ForegroundColor Green

# Crear script de estado
$StatusPath = "scripts/system-status.ps1"
$StatusContent = "Write-Host '=== ESTADO DEL SISTEMA AUTOMÁTICO DE GIT ===' -ForegroundColor Cyan`n`nWrite-Host 'Scripts disponibles:' -ForegroundColor Yellow`nif (Test-Path 'scripts/auto-fix-git.ps1') {`n    Write-Host '  ✓ auto-fix-git.ps1' -ForegroundColor Green`n} else {`n    Write-Host '  ✗ auto-fix-git.ps1' -ForegroundColor Red`n}`n`nif (Test-Path 'scripts/git-monitor.ps1') {`n    Write-Host '  ✓ git-monitor.ps1' -ForegroundColor Green`n} else {`n    Write-Host '  ✗ git-monitor.ps1' -ForegroundColor Red`n}`n`nWrite-Host '`nHooks de Git:' -ForegroundColor Yellow`nif (Test-Path '.git/hooks/pre-commit') {`n    Write-Host '  ✓ pre-commit' -ForegroundColor Green`n} else {`n    Write-Host '  ✗ pre-commit' -ForegroundColor Red`n}`n`nif (Test-Path '.git/hooks/post-commit') {`n    Write-Host '  ✓ post-commit' -ForegroundColor Green`n} else {`n    Write-Host '  ✗ post-commit' -ForegroundColor Red`n}`n`nWrite-Host '`nEstado del repositorio:' -ForegroundColor Yellow`ntry {`n    `$status = git status --porcelain`n    if (`$status) {`n        Write-Host '  ⚠ Cambios sin commitear detectados' -ForegroundColor Yellow`n    } else {`n        Write-Host '  ✓ Repositorio limpio' -ForegroundColor Green`n    }`n} catch {`n    Write-Host '  ✗ Error al verificar estado' -ForegroundColor Red`n}"

[System.IO.File]::WriteAllText($StatusPath, $StatusContent, [System.Text.Encoding]::UTF8)
Write-Host "Script de estado creado" -ForegroundColor Green

# Crear script de limpieza
$CleanupPath = "scripts/system-cleanup.ps1"
$CleanupContent = "Write-Host '=== LIMPIEZA DEL SISTEMA AUTOMÁTICO ===' -ForegroundColor Cyan`n`nWrite-Host 'Limpiando archivos temporales...' -ForegroundColor Yellow`n`$tempFiles = Get-ChildItem -Path . -Name @('tamp*', 'tatus*', 'et --hard*') -File -ErrorAction SilentlyContinue`nforeach (`$tempFile in `$tempFiles) {`n    Remove-Item `$tempFile -Force`n    Write-Host 'Archivo temporal eliminado: ' `$tempFile -ForegroundColor Green`n}`n`nWrite-Host 'Limpieza completada' -ForegroundColor Green"

[System.IO.File]::WriteAllText($CleanupPath, $CleanupContent, [System.Text.Encoding]::UTF8)
Write-Host "Script de limpieza creado" -ForegroundColor Green

# Crear script de inicio rápido
$QuickStartPath = "scripts/quick-start.ps1"
$QuickStartContent = "Write-Host '=== SISTEMA AUTOMÁTICO DE GIT - INICIO RÁPIDO ===' -ForegroundColor Cyan`nWrite-Host 'Comandos disponibles:' -ForegroundColor Yellow`nWrite-Host '  .\scripts\auto-fix-git.ps1          - Reparación manual' -ForegroundColor White`nWrite-Host '  .\scripts\system-status.ps1         - Estado del sistema' -ForegroundColor White`nWrite-Host '  .\scripts\system-cleanup.ps1        - Limpiar sistema' -ForegroundColor White`nWrite-Host '`nEl sistema está configurado y listo para usar.' -ForegroundColor Green`nWrite-Host 'Los hooks se ejecutarán automáticamente en cada commit.' -ForegroundColor Cyan"

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
