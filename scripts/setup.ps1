# Script de Instalación Simple
Write-Host "=== INSTALACIÓN DEL SISTEMA AUTOMÁTICO ===" -ForegroundColor Cyan

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
$preCommitContent = "#!/bin/sh`necho '=== HOOK PRE-COMMIT ACTIVADO ==='`necho 'Ejecutando reparación automática...'`npowershell.exe -ExecutionPolicy Bypass -File 'scripts/auto-fix-git.ps1' -CommitMessage 'Auto-fix pre-commit'`necho 'Hook pre-commit completado'"

Set-Content -Path "$hooksDir/pre-commit" -Value $preCommitContent -Encoding UTF8
Write-Host "Hook pre-commit instalado" -ForegroundColor Green

# Crear hook post-commit
$postCommitContent = "#!/bin/sh`necho 'Commit realizado: $(git log -1 --pretty=format:'%h - %s')'"

Set-Content -Path "$hooksDir/post-commit" -Value $postCommitContent -Encoding UTF8
Write-Host "Hook post-commit instalado" -ForegroundColor Green

# Crear script de estado
$statusContent = "Write-Host '=== ESTADO DEL SISTEMA ===' -ForegroundColor Cyan`nWrite-Host 'Scripts disponibles:' -ForegroundColor Yellow`nif (Test-Path 'scripts/auto-fix-git.ps1') { Write-Host '  ✓ auto-fix-git.ps1' -ForegroundColor Green } else { Write-Host '  ✗ auto-fix-git.ps1' -ForegroundColor Red }`nif (Test-Path 'scripts/git-monitor.ps1') { Write-Host '  ✓ git-monitor.ps1' -ForegroundColor Green } else { Write-Host '  ✗ git-monitor.ps1' -ForegroundColor Red }`nWrite-Host 'Hooks de Git:' -ForegroundColor Yellow`nif (Test-Path '.git/hooks/pre-commit') { Write-Host '  ✓ pre-commit' -ForegroundColor Green } else { Write-Host '  ✗ pre-commit' -ForegroundColor Red }`nif (Test-Path '.git/hooks/post-commit') { Write-Host '  ✓ post-commit' -ForegroundColor Green } else { Write-Host '  ✗ post-commit' -ForegroundColor Red }"

Set-Content -Path "scripts/estado.ps1" -Value $statusContent -Encoding UTF8
Write-Host "Script de estado creado" -ForegroundColor Green

# Crear script de limpieza
$cleanupContent = "Write-Host '=== LIMPIEZA DEL SISTEMA ===' -ForegroundColor Cyan`nWrite-Host 'Limpiando archivos temporales...' -ForegroundColor Yellow`nGet-ChildItem -Path . -Name @('tamp*', 'tatus*', 'et --hard*') -File -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item `$_ -Force; Write-Host 'Eliminado: ' `$_ -ForegroundColor Green }`nWrite-Host 'Limpieza completada' -ForegroundColor Green"

Set-Content -Path "scripts/limpiar.ps1" -Value $cleanupContent -Encoding UTF8
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
