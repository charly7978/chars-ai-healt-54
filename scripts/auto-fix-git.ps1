# Script Automático de Detección y Reparación de Problemas Git
# Autor: Sistema de Reparación Automática
# Descripción: Detecta y repara automáticamente problemas comunes de Git y GitHub

param(
    [string]$CommitMessage = "Auto-fix: Reparación automática de problemas detectados",
    [switch]$Force = $false,
    [switch]$Verbose = $false
)

# Configuración de colores para output
$ErrorColor = "Red"
$SuccessColor = "Green"
$WarningColor = "Yellow"
$InfoColor = "Cyan"

# Función para logging
function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Level) {
        "ERROR" { $ErrorColor }
        "SUCCESS" { $SuccessColor }
        "WARNING" { $WarningColor }
        "INFO" { $InfoColor }
        default { "White" }
    }
    
    Write-Host "[$timestamp] [$Level] $Message" -ForegroundColor $color
}

# Función para verificar si estamos en un repositorio Git
function Test-GitRepository {
    try {
        $null = git rev-parse --git-dir 2>$null
        return $true
    }
    catch {
        return $false
    }
}

# Función para limpiar archivos problemáticos
function Clear-ProblematicFiles {
    Write-Log "Limpiando archivos problemáticos..." "INFO"
    
    $problematicPatterns = @(
        "tamp*",
        "tatus*",
        "et --hard*",
        "*.timestamp-*",
        "*.mjs.timestamp-*"
    )
    
    $cleanedFiles = @()
    
    foreach ($pattern in $problematicPatterns) {
        $files = Get-ChildItem -Path . -Name $pattern -File -ErrorAction SilentlyContinue
        foreach ($file in $files) {
            try {
                Remove-Item $file -Force
                $cleanedFiles += $file
                Write-Log "Archivo eliminado: $file" "SUCCESS"
            }
            catch {
                Write-Log "Error al eliminar $file : $($_.Exception.Message)" "ERROR"
            }
        }
    }
    
    return $cleanedFiles
}

# Función para verificar y reparar el estado de Git
function Repair-GitState {
    Write-Log "Verificando estado de Git..." "INFO"
    
    $issues = @()
    $fixes = @()
    
    # Verificar si hay cambios sin commitear
    $status = git status --porcelain
    if ($status) {
        Write-Log "Se encontraron cambios sin commitear" "WARNING"
        $issues += "Cambios sin commitear"
        
        # Agregar todos los cambios
        git add .
        $fixes += "Agregados todos los cambios al staging area"
        Write-Log "Cambios agregados al staging area" "SUCCESS"
    }
    
    # Verificar si hay conflictos de merge
    $mergeHead = Test-Path ".git/MERGE_HEAD"
    if ($mergeHead) {
        Write-Log "Se detectó un merge en progreso" "WARNING"
        $issues += "Merge en progreso"
        
        # Intentar completar el merge
        try {
            git merge --abort
            $fixes += "Merge abortado"
            Write-Log "Merge abortado exitosamente" "SUCCESS"
        }
        catch {
            Write-Log "Error al abortar merge: $($_.Exception.Message)" "ERROR"
        }
    }
    
    # Verificar si hay rebase en progreso
    $rebaseHead = Test-Path ".git/rebase-merge"
    if ($rebaseHead) {
        Write-Log "Se detectó un rebase en progreso" "WARNING"
        $issues += "Rebase en progreso"
        
        try {
            git rebase --abort
            $fixes += "Rebase abortado"
            Write-Log "Rebase abortado exitosamente" "SUCCESS"
        }
        catch {
            Write-Log "Error al abortar rebase: $($_.Exception.Message)" "ERROR"
        }
    }
    
    return @{
        Issues = $issues
        Fixes = $fixes
    }
}

# Función para verificar y reparar dependencias
function Repair-Dependencies {
    Write-Log "Verificando dependencias..." "INFO"
    
    $issues = @()
    $fixes = @()
    
    # Verificar si existe package.json
    if (Test-Path "package.json") {
        # Verificar si node_modules existe y está corrupto
        if (Test-Path "node_modules") {
            $nodeModulesSize = (Get-ChildItem "node_modules" -Recurse | Measure-Object -Property Length -Sum).Sum
            if ($nodeModulesSize -lt 1MB) {
                Write-Log "node_modules parece estar corrupto" "WARNING"
                $issues += "node_modules corrupto"
                
                try {
                    Remove-Item "node_modules" -Recurse -Force
                    $fixes += "node_modules eliminado"
                    Write-Log "node_modules eliminado" "SUCCESS"
                }
                catch {
                    Write-Log "Error al eliminar node_modules: $($_.Exception.Message)" "ERROR"
                }
            }
        }
        
        # Reinstalar dependencias
        try {
            Write-Log "Reinstalando dependencias..." "INFO"
            npm install --no-audit --no-fund
            $fixes += "Dependencias reinstaladas"
            Write-Log "Dependencias instaladas correctamente" "SUCCESS"
        }
        catch {
            Write-Log "Error al instalar dependencias: $($_.Exception.Message)" "ERROR"
            $issues += "Error en instalación de dependencias"
        }
    }
    
    return @{
        Issues = $issues
        Fixes = $fixes
    }
}

# Función para verificar y reparar configuración de Vite
function Repair-ViteConfig {
    Write-Log "Verificando configuración de Vite..." "INFO"
    
    $issues = @()
    $fixes = @()
    
    # Verificar si vite.config.ts existe
    if (Test-Path "vite.config.ts") {
        $configContent = Get-Content "vite.config.ts" -Raw
        
        # Verificar si hay referencias a TensorFlow
        if ($configContent -match "@tensorflow") {
            Write-Log "Se encontraron referencias a TensorFlow en la configuración" "WARNING"
            $issues += "Referencias a TensorFlow en vite.config.ts"
        }
        
        # Verificar si el archivo es válido
        try {
            node -e "require('./vite.config.ts')" 2>$null
            Write-Log "Configuración de Vite válida" "SUCCESS"
        }
        catch {
            Write-Log "Configuración de Vite inválida" "ERROR"
            $issues += "Configuración de Vite inválida"
        }
    }
    
    return @{
        Issues = $issues
        Fixes = $fixes
    }
}

# Función para sincronizar con el repositorio remoto
function Sync-WithRemote {
    Write-Log "Sincronizando con repositorio remoto..." "INFO"
    
    $issues = @()
    $fixes = @()
    
    try {
        # Obtener cambios remotos
        git fetch origin
        
        # Verificar si hay diferencias con origin/main
        $localCommit = git rev-parse HEAD
        $remoteCommit = git rev-parse origin/main
        
        if ($localCommit -ne $remoteCommit) {
            Write-Log "Se encontraron diferencias con el repositorio remoto" "WARNING"
            $issues += "Diferencias con repositorio remoto"
            
            # Intentar hacer pull
            try {
                git pull origin main --no-edit
                $fixes += "Cambios sincronizados con remoto"
                Write-Log "Cambios sincronizados exitosamente" "SUCCESS"
            }
            catch {
                Write-Log "Error al sincronizar: $($_.Exception.Message)" "ERROR"
                $issues += "Error en sincronización"
            }
        }
        else {
            Write-Log "Repositorio local está sincronizado" "SUCCESS"
        }
    }
    catch {
        Write-Log "Error al verificar repositorio remoto: $($_.Exception.Message)" "ERROR"
        $issues += "Error al verificar repositorio remoto"
    }
    
    return @{
        Issues = $issues
        Fixes = $fixes
    }
}

# Función para hacer commit automático
function New-AutoCommit {
    param([string]$Message)
    
    Write-Log "Creando commit automático..." "INFO"
    
    try {
        # Verificar si hay cambios para commitear
        $status = git status --porcelain
        if ($status) {
            git add .
            git commit -m $Message
            Write-Log "Commit creado exitosamente: $Message" "SUCCESS"
            return $true
        }
        else {
            Write-Log "No hay cambios para commitear" "INFO"
            return $false
        }
    }
    catch {
        Write-Log "Error al crear commit: $($_.Exception.Message)" "ERROR"
        return $false
    }
}

# Función para hacer push automático
function Push-ToRemote {
    Write-Log "Enviando cambios al repositorio remoto..." "INFO"
    
    try {
        git push origin main
        Write-Log "Cambios enviados exitosamente" "SUCCESS"
        return $true
    }
    catch {
        Write-Log "Error al enviar cambios: $($_.Exception.Message)" "ERROR"
        return $false
    }
}

# Función principal
function Start-AutoFix {
    Write-Log "=== INICIANDO REPARACIÓN AUTOMÁTICA DE GIT ===" "INFO"
    Write-Log "Repositorio: $(Get-Location)" "INFO"
    Write-Log "Fecha: $(Get-Date)" "INFO"
    
    # Verificar si estamos en un repositorio Git
    if (-not (Test-GitRepository)) {
        Write-Log "ERROR: No se detectó un repositorio Git válido" "ERROR"
        exit 1
    }
    
    $allIssues = @()
    $allFixes = @()
    
    # 1. Limpiar archivos problemáticos
    $cleanedFiles = Clear-ProblematicFiles
    if ($cleanedFiles.Count -gt 0) {
        $allFixes += "Archivos problemáticos eliminados: $($cleanedFiles -join ', ')"
    }
    
    # 2. Reparar estado de Git
    $gitResult = Repair-GitState
    $allIssues += $gitResult.Issues
    $allFixes += $gitResult.Fixes
    
    # 3. Reparar dependencias
    $depResult = Repair-Dependencies
    $allIssues += $depResult.Issues
    $allFixes += $depResult.Fixes
    
    # 4. Reparar configuración de Vite
    $viteResult = Repair-ViteConfig
    $allIssues += $viteResult.Issues
    $allFixes += $viteResult.Fixes
    
    # 5. Sincronizar con remoto
    $syncResult = Sync-WithRemote
    $allIssues += $syncResult.Issues
    $allFixes += $syncResult.Fixes
    
    # 6. Crear commit si hay cambios
    $commitCreated = New-AutoCommit -Message $CommitMessage
    
    # 7. Hacer push si se creó un commit
    if ($commitCreated) {
        $pushSuccess = Push-ToRemote
    }
    
    # Resumen final
    Write-Log "=== RESUMEN DE REPARACIÓN ===" "INFO"
    Write-Log "Problemas detectados: $($allIssues.Count)" "INFO"
    Write-Log "Reparaciones aplicadas: $($allFixes.Count)" "INFO"
    
    if ($allIssues.Count -gt 0) {
        Write-Log "Problemas encontrados:" "WARNING"
        foreach ($issue in $allIssues) {
            Write-Log "  - $issue" "WARNING"
        }
    }
    
    if ($allFixes.Count -gt 0) {
        Write-Log "Reparaciones aplicadas:" "SUCCESS"
        foreach ($fix in $allFixes) {
            Write-Log "  - $fix" "SUCCESS"
        }
    }
    
    Write-Log "=== REPARACIÓN COMPLETADA ===" "SUCCESS"
    
    return @{
        Issues = $allIssues
        Fixes = $allFixes
        CommitCreated = $commitCreated
        PushSuccess = $pushSuccess
    }
}

# Ejecutar la función principal
if ($MyInvocation.InvocationName -ne '.') {
    Start-AutoFix
}
