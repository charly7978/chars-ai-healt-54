# Script de Instalación del Sistema Automático de Git
Write-Host "=== INSTALACIÓN DEL SISTEMA AUTOMÁTICO DE GIT ===" -ForegroundColor Cyan

# Verificar repositorio Git
if (-not (Test-Path ".git")) {
    Write-Host "ERROR: No se detectó un repositorio Git" -ForegroundColor Red
    exit 1
}

Write-Host "Repositorio Git detectado" -ForegroundColor Green

# Crear directorio de hooks
$hooksDir = ".git/hooks"
if (-not (Test-Path $hooksDir)) {
    New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
}

# Crear hook pre-commit
$preCommitHook = @"
#!/bin/sh
echo "=== HOOK PRE-COMMIT ACTIVADO ==="
echo "Ejecutando reparación automática..."
powershell.exe -ExecutionPolicy Bypass -File "scripts/auto-fix-git.ps1" -CommitMessage "Auto-fix pre-commit"
echo "Hook pre-commit completado"
"@

Set-Content -Path "$hooksDir/pre-commit" -Value $preCommitHook -Encoding UTF8
Write-Host "Hook pre-commit instalado" -ForegroundColor Green

# Crear hook post-commit
$postCommitHook = @"
#!/bin/sh
echo "Commit realizado: $(git log -1 --pretty=format:'%h - %s')"
"@

Set-Content -Path "$hooksDir/post-commit" -Value $postCommitHook -Encoding UTF8
Write-Host "Hook post-commit instalado" -ForegroundColor Green

# Crear script de estado
$statusScript = @"
Write-Host "=== ESTADO DEL SISTEMA ===" -ForegroundColor Cyan
Write-Host "Scripts disponibles:" -ForegroundColor Yellow
if (Test-Path "scripts/auto-fix-git.ps1") { Write-Host "  ✓ auto-fix-git.ps1" -ForegroundColor Green } else { Write-Host "  ✗ auto-fix-git.ps1" -ForegroundColor Red }
if (Test-Path "scripts/git-monitor.ps1") { Write-Host "  ✓ git-monitor.ps1" -ForegroundColor Green } else { Write-Host "  ✗ git-monitor.ps1" -ForegroundColor Red }
Write-Host "Hooks de Git:" -ForegroundColor Yellow
if (Test-Path ".git/hooks/pre-commit") { Write-Host "  ✓ pre-commit" -ForegroundColor Green } else { Write-Host "  ✗ pre-commit" -ForegroundColor Red }
if (Test-Path ".git/hooks/post-commit") { Write-Host "  ✓ post-commit" -ForegroundColor Green } else { Write-Host "  ✗ post-commit" -ForegroundColor Red }
"@

Set-Content -Path "scripts/estado.ps1" -Value $statusScript -Encoding UTF8
Write-Host "Script de estado creado" -ForegroundColor Green

# Crear script de limpieza
$cleanupScript = @"
Write-Host "=== LIMPIEZA DEL SISTEMA ===" -ForegroundColor Cyan
Write-Host "Limpiando archivos temporales..." -ForegroundColor Yellow
Get-ChildItem -Path . -Name @("tamp*", "tatus*", "et --hard*") -File -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item $_ -Force; Write-Host "Eliminado: $_" -ForegroundColor Green }
Write-Host "Limpieza completada" -ForegroundColor Green
"@

Set-Content -Path "scripts/limpiar.ps1" -Value $cleanupScript -Encoding UTF8
Write-Host "Script de limpieza creado" -ForegroundColor Green

# Probar sistema
Write-Host "`nProbando sistema..." -ForegroundColor Yellow
try {
    & "scripts/auto-fix-git.ps1" -Verbose
    Write-Host "✓ Sistema funcionando" -ForegroundColor Green
}
catch {
    Write-Host "✗ Error en prueba: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== INSTALACIÓN COMPLETADA ===" -ForegroundColor Green
Write-Host "Sistema instalado exitosamente" -ForegroundColor Green
Write-Host "Comandos disponibles:" -ForegroundColor Cyan
Write-Host "  .\scripts\auto-fix-git.ps1  - Reparación manual" -ForegroundColor White
Write-Host "  .\scripts\estado.ps1        - Estado del sistema" -ForegroundColor White
Write-Host "  .\scripts\limpiar.ps1       - Limpiar sistema" -ForegroundColor White
