# Configuración de Git Segura - Evita problemas automáticos
Write-Host "🔧 Configurando Git de forma segura..." -ForegroundColor Green

# Configurar Git para NO agregar archivos automáticamente
git config --global core.autocrlf true
git config --global core.safecrlf warn
git config --global core.ignorecase false

# Configurar para NO hacer tracking de archivos temporales
git config --global core.excludesfile ~/.gitignore_global

# Crear archivo global de .gitignore
$globalGitignore = @"
# Archivos temporales del sistema
*.tmp
*.temp
*.swp
*.swo
*~

# Archivos de build
build/
dist/
*.o
*.obj
*.exe
*.dll
*.so
*.dylib

# Archivos de IDE
.vscode/
.idea/
*.iml
*.ipr
*.iws

# Archivos de sistema
Thumbs.db
ehthumbs.db
Desktop.ini
.DS_Store

# Archivos de caché
.cache/
*.cache

# Archivos de lock (excepto package-lock.json)
yarn.lock
pnpm-lock.yaml
bun.lockb

# Archivos de Android temporales
android/.gradle/
android/app/build/
android/local.properties
android/build/
android/.idea/
android/*.iml

# Archivos de React Native temporales
react-native/android/.gradle/
react-native/android/app/build/
react-native/android/local.properties
react-native/android/build/
react-native/android/.idea/
react-native/android/*.iml
"@

$globalGitignorePath = "$env:USERPROFILE\.gitignore_global"
$globalGitignore | Out-File -FilePath $globalGitignorePath -Encoding UTF8

Write-Host "✅ Archivo global .gitignore creado en: $globalGitignorePath" -ForegroundColor Green

# Configurar alias útiles
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.unstage 'reset HEAD --'
git config --global alias.last 'log -1 HEAD'
git config --global alias.visual '!gitk'

# Configurar para hacer commits más seguros
git config --global commit.verbose true
git config --global commit.template ~/.gitmessage

# Crear template de commit
$commitTemplate = @"
# Commit: [TIPO] Descripción breve

# Descripción detallada (opcional)
# 
# Cambios realizados:
# - 
# - 
# - 

# Archivos modificados:
# 
# Notas adicionales:
# 
# [TIPO]: feat, fix, docs, style, refactor, test, chore
"@

$commitTemplatePath = "$env:USERPROFILE\.gitmessage"
$commitTemplate | Out-File -FilePath $commitTemplatePath -Encoding UTF8

Write-Host "✅ Template de commit creado en: $commitTemplatePath" -ForegroundColor Green

# Configurar para NO hacer tracking de archivos de configuración local
git config --global core.autocrlf true
git config --global core.safecrlf warn

Write-Host ""
Write-Host "🎉 Configuración de Git completada!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Comandos útiles configurados:" -ForegroundColor Cyan
Write-Host "   git st     → git status" -ForegroundColor White
Write-Host "   git co     → git checkout" -ForegroundColor White
Write-Host "   git ci     → git commit" -ForegroundColor White
Write-Host "   git br     → git branch" -ForegroundColor White
Write-Host ""
Write-Host "💡 Para hacer commits seguros:" -ForegroundColor Yellow
Write-Host "   1. Usa: .\scripts\smart_commit.ps1 'Mensaje'" -ForegroundColor White
Write-Host "   2. O manual: git add archivos-específicos" -ForegroundColor White
Write-Host "   3. NUNCA uses: git add . (sin revisar)" -ForegroundColor White
Write-Host ""
Write-Host "🔒 Archivos temporales ahora se ignoran automáticamente" -ForegroundColor Green
