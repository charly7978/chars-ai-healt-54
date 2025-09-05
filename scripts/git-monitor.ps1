# Monitor Continuo de Git
# Monitorea el repositorio y ejecuta reparaciones automáticas cuando es necesario

param(
    [int]$CheckInterval = 30,  # Intervalo en segundos
    [switch]$Background = $false,
    [switch]$Verbose = $false
)

# Configuración
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AutoFixScript = Join-Path $ScriptDir "auto-fix-git.ps1"
$LogFile = Join-Path $ScriptDir "git-monitor.log"

# Función para logging
function Write-MonitorLog {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    
    # Escribir a consola
    $color = switch ($Level) {
        "ERROR" { "Red" }
        "WARNING" { "Yellow" }
        "SUCCESS" { "Green" }
        "INFO" { "Cyan" }
        default { "White" }
    }
    
    Write-Host $logEntry -ForegroundColor $color
    
    # Escribir a archivo de log
    Add-Content -Path $LogFile -Value $logEntry -Encoding UTF8
}

# Función para verificar el estado del repositorio
function Test-RepositoryHealth {
    $issues = @()
    
    try {
        # Verificar si estamos en un repositorio Git
        $null = git rev-parse --git-dir 2>$null
        if ($LASTEXITCODE -ne 0) {
            $issues += "No es un repositorio Git válido"
            return $issues
        }
        
        # Verificar archivos problemáticos
        $problematicFiles = Get-ChildItem -Path . -Name @("tamp*", "tatus*", "et --hard*") -File -ErrorAction SilentlyContinue
        if ($problematicFiles) {
            $issues += "Archivos problemáticos detectados: $($problematicFiles -join ', ')"
        }
        
        # Verificar estado de Git
        $status = git status --porcelain
        if ($status) {
            $issues += "Cambios sin commitear detectados"
        }
        
        # Verificar conflictos de merge
        if (Test-Path ".git/MERGE_HEAD") {
            $issues += "Merge en progreso detectado"
        }
        
        # Verificar rebase en progreso
        if (Test-Path ".git/rebase-merge") {
            $issues += "Rebase en progreso detectado"
        }
        
        # Verificar dependencias
        if (Test-Path "package.json") {
            if (-not (Test-Path "node_modules")) {
                $issues += "node_modules faltante"
            }
            else {
                $nodeModulesSize = (Get-ChildItem "node_modules" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
                if ($nodeModulesSize -lt 1MB) {
                    $issues += "node_modules corrupto"
                }
            }
        }
        
        # Verificar sincronización con remoto
        try {
            git fetch origin --dry-run 2>$null
            if ($LASTEXITCODE -ne 0) {
                $issues += "Error de conexión con repositorio remoto"
            }
        }
        catch {
            $issues += "Error al verificar repositorio remoto"
        }
        
    }
    catch {
        $issues += "Error general: $($_.Exception.Message)"
    }
    
    return $issues
}

# Función para ejecutar reparación automática
function Invoke-AutoRepair {
    Write-MonitorLog "Ejecutando reparación automática..." "INFO"
    
    try {
        $result = & $AutoFixScript -Verbose:$Verbose
        Write-MonitorLog "Reparación completada" "SUCCESS"
        return $true
    }
    catch {
        Write-MonitorLog "Error en reparación automática: $($_.Exception.Message)" "ERROR"
        return $false
    }
}

# Función principal de monitoreo
function Start-Monitoring {
    Write-MonitorLog "=== INICIANDO MONITOR DE GIT ===" "INFO"
    Write-MonitorLog "Intervalo de verificación: $CheckInterval segundos" "INFO"
    Write-MonitorLog "Modo background: $Background" "INFO"
    Write-MonitorLog "Archivo de log: $LogFile" "INFO"
    
    $iteration = 0
    
    while ($true) {
        $iteration++
        Write-MonitorLog "Verificación #$iteration" "INFO"
        
        # Verificar salud del repositorio
        $issues = Test-RepositoryHealth
        
        if ($issues.Count -gt 0) {
            Write-MonitorLog "Se detectaron $($issues.Count) problemas:" "WARNING"
            foreach ($issue in $issues) {
                Write-MonitorLog "  - $issue" "WARNING"
            }
            
            # Ejecutar reparación automática
            $repairSuccess = Invoke-AutoRepair
            
            if ($repairSuccess) {
                Write-MonitorLog "Problemas reparados exitosamente" "SUCCESS"
            }
            else {
                Write-MonitorLog "Error al reparar problemas" "ERROR"
            }
        }
        else {
            Write-MonitorLog "Repositorio en buen estado" "SUCCESS"
        }
        
        # Esperar antes de la siguiente verificación
        if ($Background) {
            Start-Sleep -Seconds $CheckInterval
        }
        else {
            Write-Host "Presiona Ctrl+C para detener el monitor..." -ForegroundColor Yellow
            Start-Sleep -Seconds $CheckInterval
        }
    }
}

# Función para ejecutar en background
function Start-BackgroundMonitor {
    Write-MonitorLog "Iniciando monitor en segundo plano..." "INFO"
    
    $job = Start-Job -ScriptBlock {
        param($ScriptPath, $CheckInterval, $Verbose)
        
        # Importar el script de monitoreo
        . $ScriptPath -CheckInterval $CheckInterval -Background -Verbose:$Verbose
    } -ArgumentList $MyInvocation.MyCommand.Path, $CheckInterval, $Verbose
    
    Write-MonitorLog "Monitor iniciado con Job ID: $($job.Id)" "SUCCESS"
    Write-MonitorLog "Para detener: Stop-Job $($job.Id); Remove-Job $($job.Id)" "INFO"
    
    return $job
}

# Función para mostrar estado del monitor
function Show-MonitorStatus {
    $jobs = Get-Job | Where-Object { $_.Command -like "*git-monitor*" }
    
    if ($jobs) {
        Write-Host "Monitores activos:" -ForegroundColor Cyan
        foreach ($job in $jobs) {
            $status = if ($job.State -eq "Running") { "Activo" } else { $job.State }
            Write-Host "  Job $($job.Id): $status" -ForegroundColor Green
        }
    }
    else {
        Write-Host "No hay monitores activos" -ForegroundColor Yellow
    }
}

# Función para detener monitores
function Stop-AllMonitors {
    $jobs = Get-Job | Where-Object { $_.Command -like "*git-monitor*" }
    
    if ($jobs) {
        foreach ($job in $jobs) {
            Stop-Job $job.Id
            Remove-Job $job.Id
            Write-MonitorLog "Monitor $($job.Id) detenido" "INFO"
        }
        Write-Host "Todos los monitores han sido detenidos" -ForegroundColor Green
    }
    else {
        Write-Host "No hay monitores activos para detener" -ForegroundColor Yellow
    }
}

# Manejo de parámetros de línea de comandos
switch ($args[0]) {
    "start" {
        if ($Background) {
            Start-BackgroundMonitor
        }
        else {
            Start-Monitoring
        }
    }
    "status" {
        Show-MonitorStatus
    }
    "stop" {
        Stop-AllMonitors
    }
    "repair" {
        Invoke-AutoRepair
    }
    default {
        Write-Host "=== MONITOR DE GIT ===" -ForegroundColor Cyan
        Write-Host "Uso:" -ForegroundColor Yellow
        Write-Host "  .\git-monitor.ps1 start          - Iniciar monitor" -ForegroundColor White
        Write-Host "  .\git-monitor.ps1 start -Background - Iniciar en segundo plano" -ForegroundColor White
        Write-Host "  .\git-monitor.ps1 status         - Mostrar estado" -ForegroundColor White
        Write-Host "  .\git-monitor.ps1 stop           - Detener monitores" -ForegroundColor White
        Write-Host "  .\git-monitor.ps1 repair         - Ejecutar reparación manual" -ForegroundColor White
        Write-Host ""
        Write-Host "Parámetros:" -ForegroundColor Yellow
        Write-Host "  -CheckInterval <segundos>        - Intervalo de verificación (default: 30)" -ForegroundColor White
        Write-Host "  -Background                      - Ejecutar en segundo plano" -ForegroundColor White
        Write-Host "  -Verbose                         - Modo verbose" -ForegroundColor White
    }
}

# Si no se especificó comando, iniciar monitor por defecto
if (-not $args) {
    Start-Monitoring
}
