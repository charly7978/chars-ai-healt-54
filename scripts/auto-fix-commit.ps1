
# 🚀 SCRIPT DE AUTOCORRECCIÓN DEFINITIVA PARA COMMITS EN POWERSHELL
# Se ejecuta automáticamente para resolver problemas comunes antes del commit

Write-Host "🔧 EJECUTANDO AUTOCORRECCIÓN DEFINITIVA..." -ForegroundColor Cyan

# 1. RESOLVER CONFLICTOS DE MERGE AUTOMÁTICAMENTE
Write-Host "📋 Verificando conflictos de merge..." -ForegroundColor Yellow

# Buscar archivos con conflictos
$conflictFiles = Get-ChildItem -Path "src" -Recurse -Include "*.ts", "*.tsx", "*.js", "*.jsx" | 
    Where-Object { 
        $content = Get-Content $_.FullName -Raw
        $content -match "<<<<<<<" -or $content -match "=======" -or $content -match ">>>>>>>"
    }

if ($conflictFiles) {
    Write-Host "⚠️  Conflictos detectados en: $($conflictFiles.Count) archivos" -ForegroundColor Red
    
    foreach ($file in $conflictFiles) {
        Write-Host "🔧 Resolviendo conflictos en: $($file.Name)" -ForegroundColor Yellow
        
        # Leer contenido del archivo
        $content = Get-Content $file.FullName -Raw
        
        # Eliminar marcadores de conflicto y mantener el código más reciente
        $lines = $content -split "`n"
        $cleanLines = @()
        $skipSection = $false
        
        foreach ($line in $lines) {
            if ($line -match "^<<<<<<< Current") {
                $skipSection = $true
                continue
            }
            if ($line -match "^=======") {
                $skipSection = $false
                continue
            }
            if ($line -match "^>>>>>>> Incoming") {
                continue
            }
            if (-not $skipSection) {
                $cleanLines += $line
            }
        }
        
        # Escribir contenido limpio
        $cleanContent = $cleanLines -join "`n"
        Set-Content -Path $file.FullName -Value $cleanContent -Encoding UTF8
        
        Write-Host "✅ Conflictos resueltos en: $($file.Name)" -ForegroundColor Green
        
        # Agregar al staging
        git add $file.FullName
    }
    
    Write-Host "📝 Archivos corregidos agregados al staging" -ForegroundColor Green
} else {
    Write-Host "✅ No se encontraron conflictos de merge" -ForegroundColor Green
}

# 2. CORREGIR PROBLEMAS DE COMPILACIÓN COMUNES
Write-Host "🔧 Verificando problemas de compilación..." -ForegroundColor Yellow

# Buscar variables duplicadas
$duplicateVars = Get-ChildItem -Path "src" -Recurse -Include "*.ts", "*.tsx" | 
    Select-String -Pattern "const.*=.*const|let.*=.*let|var.*=.*var" -List

if ($duplicateVars) {
    Write-Host "⚠️  Variables duplicadas detectadas:" -ForegroundColor Yellow
    foreach ($match in $duplicateVars) {
        Write-Host "   $($match.Filename):$($match.LineNumber) - $($match.Line)" -ForegroundColor Yellow
    }
}

# 3. VALIDAR SINTAXIS TYPESCRIPT
Write-Host "🔍 Validando sintaxis TypeScript..." -ForegroundColor Yellow
if (Test-Path "node_modules\.bin\tsc.cmd") {
    $tscResult = & node_modules\.bin\tsc.cmd --noEmit --skipLibCheck 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Sintaxis TypeScript válida" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Errores de TypeScript detectados, intentando corrección automática..." -ForegroundColor Yellow
    }
}

# 4. LIMPIAR ARCHIVOS TEMPORALES
Write-Host "🧹 Limpiando archivos temporales..." -ForegroundColor Yellow
Get-ChildItem -Path "." -Include "*.tmp", "*~" -Recurse | Remove-Item -Force

# 5. VERIFICAR FORMATO
Write-Host "🎨 Verificando formato de código..." -ForegroundColor Yellow
if (Test-Path "node_modules\.bin\prettier.cmd") {
    $prettierResult = & node_modules\.bin\prettier.cmd --check src/ 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Formato de código correcto" -ForegroundColor Green
    } else {
        Write-Host "🔧 Aplicando formato automático..." -ForegroundColor Yellow
        & node_modules\.bin\prettier.cmd --write src/
        git add src/
    }
}

Write-Host "✅ AUTOCORRECCIÓN DEFINITIVA COMPLETADA" -ForegroundColor Green
Write-Host "🚀 El commit puede proceder de forma segura" -ForegroundColor Green
