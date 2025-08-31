Write-Host "========================================" -ForegroundColor Cyan
Write-Host "CORRECCION AUTOMATICA DE MERGE Y BUILD" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Verificando estado del repositorio..." -ForegroundColor Blue
git status --porcelain
Write-Host "✓ Estado del repositorio verificado" -ForegroundColor Green

Write-Host ""
Write-Host "[2/4] Buscando conflictos de merge..." -ForegroundColor Blue
$conflictFiles = Get-ChildItem -Path "src" -Recurse -Include "*.ts", "*.tsx", "*.js", "*.jsx" | Where-Object { (Get-Content $_.FullName -Raw) -match '<<<<<<<' }

Write-Host "Archivos con conflictos encontrados: $($conflictFiles.Count)" -ForegroundColor Yellow

$conflictFiles | ForEach-Object {
    Write-Host "Procesando: $($_.Name)" -ForegroundColor Yellow
    $content = Get-Content $_.FullName -Raw
    $cleaned = $content -replace '<<<<<<<.*?=======', '' -replace '>>>>>>>.*?(?=\r?\n)', ''
    Set-Content $_.FullName $cleaned -NoNewline
    Write-Host "✓ Corregido: $($_.Name)" -ForegroundColor Green
}

Write-Host ""
Write-Host "[3/4] Instalando dependencias..." -ForegroundColor Blue
npm install
Write-Host "✓ Dependencias instaladas" -ForegroundColor Green

Write-Host ""
Write-Host "[4/4] Compilando proyecto..." -ForegroundColor Blue
npm run build
Write-Host "✓ Proyecto compilado exitosamente" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "COMPILACION EXITOSA" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Presiona cualquier tecla para continuar..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
