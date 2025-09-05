# Hook de Git Pre-Commit
# Se ejecuta automáticamente antes de cada commit
# Detecta y repara problemas automáticamente

param(
    [string]$CommitMessage = ""
)

# Obtener la ruta del script principal
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AutoFixScript = Join-Path $ScriptDir "auto-fix-git.ps1"

Write-Host "=== HOOK PRE-COMMIT ACTIVADO ===" -ForegroundColor Cyan
Write-Host "Detectando y reparando problemas automáticamente..." -ForegroundColor Yellow

# Ejecutar el script de reparación automática
try {
    & $AutoFixScript -CommitMessage "Auto-fix pre-commit: $CommitMessage" -Verbose
    Write-Host "Hook pre-commit completado exitosamente" -ForegroundColor Green
    exit 0
}
catch {
    Write-Host "Error en hook pre-commit: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
