# Configuración simple de Git segura
Write-Host "Configurando Git de forma segura..." -ForegroundColor Green

# Configurar Git para NO agregar archivos automáticamente
git config --global core.autocrlf true
git config --global core.safecrlf warn

# Crear alias útiles
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.ci commit

Write-Host "Configuracion completada!" -ForegroundColor Green
Write-Host ""
Write-Host "Comandos utiles:" -ForegroundColor Cyan
Write-Host "  git st  -> git status" -ForegroundColor White
Write-Host "  git co  -> git checkout" -ForegroundColor White
Write-Host "  git ci  -> git commit" -ForegroundColor White
Write-Host ""
Write-Host "Para commits seguros:" -ForegroundColor Yellow
Write-Host "  .\scripts\smart_commit.ps1 'Mensaje'" -ForegroundColor White
