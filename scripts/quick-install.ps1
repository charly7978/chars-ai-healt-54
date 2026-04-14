# Script de Instalación Rápida del Sistema Automático de Git
Write-Host "=== INSTALACIÓN RÁPIDA DEL SISTEMA AUTOMÁTICO DE GIT ===" -ForegroundColor Cyan

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

# Crear hook pre-commit simple
$PreCommitPath = Join-Path $GitHooksDir "pre-commit"
$PreCommitContent = @"
#!/bin/sh
echo "=== HOOK PRE-COMMIT ACTIVADO ==="
echo "Ejecutando reparación automática..."
powershell.exe -ExecutionPolicy Bypass -File "scripts/auto-fix-git.ps1" -CommitMessage "Auto-fix pre-commit"
echo "Hook pre-commit completado"
"@

[System.IO.File]::WriteAllText($PreCommitPath, $PreCommitContent, [System.Text.Encoding]::UTF8)
Write-Host "Hook pre-commit instalado" -ForegroundColor Green

# Crear hook post-commit simple
$PostCommitPath = Join-Path $GitHooksDir "post-commit"
$PostCommitContent = @"
#!/bin/sh
echo "Commit realizado exitosamente: $(git log -1 --pretty=format:'%h - %s')"
"@

[System.IO.File]::WriteAllText($PostCommitPath, $PostCommitContent, [System.Text.Encoding]::UTF8)
Write-Host "Hook post-commit instalado" -ForegroundColor Green

# Crear script de estado simple
$StatusPath = "scripts/system-status.ps1"
$StatusContent = @"
Write-Host "=== ESTADO DEL SISTEMA AUTOMÁTICO DE GIT ===" -ForegroundColor Cyan

Write-Host "Scripts disponibles:" -ForegroundColor Yellow
if (Test-Path "scripts/auto-fix-git.ps1") {
    Write-Host "  ✓ auto-fix-git.ps1" -ForegroundColor Green
} else {
    Write-Host "  ✗ auto-fix-git.ps1" -ForegroundColor Red
}

if (Test-Path "scripts/git-monitor.ps1") {
    Write-Host "  ✓ git-monitor.ps1" -ForegroundColor Green
} else {
    Write-Host "  ✗ git-monitor.ps1" -ForegroundColor Red
}

Write-Host "`nHooks de Git:" -ForegroundColor Yellow
if (Test-Path ".git/hooks/pre-commit") {
    Write-Host "  ✓ pre-commit" -ForegroundColor Green
} else {
    Write-Host "  ✗ pre-commit" -ForegroundColor Red
}

if (Test-Path ".git/hooks/post-commit") {
    Write-Host "  ✓ post-commit" -ForegroundColor Green
} else {
    Write-Host "  ✗ post-commit" -ForegroundColor Red
}

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
"@

[System.IO.File]::WriteAllText($StatusPath, $StatusContent, [System.Text.Encoding]::UTF8)
Write-Host "Script de estado creado" -ForegroundColor Green

# Crear script de limpieza simple
$CleanupPath = "scripts/system-cleanup.ps1"
$CleanupContent = @"
Write-Host "=== LIMPIEZA DEL SISTEMA AUTOMÁTICO ===" -ForegroundColor Cyan

Write-Host "Limpiando archivos temporales..." -ForegroundColor Yellow
$tempFiles = Get-ChildItem -Path . -Name @("tamp*", "tatus*", "et --hard*") -File -ErrorAction SilentlyContinue
foreach ($tempFile in $tempFiles) {
    Remove-Item $tempFile -Force
    Write-Host "Archivo temporal eliminado: $tempFile" -ForegroundColor Green
}

Write-Host "Limpieza completada" -ForegroundColor Green
"@

[System.IO.File]::WriteAllText($CleanupPath, $CleanupContent, [System.Text.Encoding]::UTF8)
Write-Host "Script de limpieza creado" -ForegroundColor Green

# Crear script de inicio rápido
$QuickStartPath = "scripts/quick-start.ps1"
$QuickStartContent = @"
Write-Host "=== SISTEMA AUTOMÁTICO DE GIT - INICIO RÁPIDO ===" -ForegroundColor Cyan
Write-Host "Comandos disponibles:" -ForegroundColor Yellow
Write-Host "  .\scripts\auto-fix-git.ps1          - Reparación manual" -ForegroundColor White
Write-Host "  .\scripts\system-status.ps1         - Estado del sistema" -ForegroundColor White
Write-Host "  .\scripts\system-cleanup.ps1        - Limpiar sistema" -ForegroundColor White
Write-Host "`nEl sistema está configurado y listo para usar." -ForegroundColor Green
Write-Host "Los hooks se ejecutarán automáticamente en cada commit." -ForegroundColor Cyan
"@

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
