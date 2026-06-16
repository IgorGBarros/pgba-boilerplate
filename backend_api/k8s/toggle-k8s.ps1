param (
    [Parameter(Mandatory=$true)]
    [ValidateSet("on", "off")]
    [string]$mode
)

Write-Host "🌐 Alternando Kubernetes para: $mode"

# Detecta o caminho do settings.json
$settingsPath = Join-Path $env:APPDATA "Docker\settings-store.json"

if (-Not (Test-Path $settingsPath)) {
    Write-Host "❌ Arquivo de configurações do Docker Desktop não encontrado em:"
    Write-Host $settingsPath
    exit 1
}

# Lê o conteúdo do settings.json
$json = Get-Content $settingsPath | ConvertFrom-Json

# Altera a chave do Kubernetes
$json.kubernetesEnabled = if ($mode -eq "on") { $true } else { $false }

# Salva as alterações
$json | ConvertTo-Json -Depth 100 | Set-Content $settingsPath

# Reinicia o Docker Desktop
Write-Host "🔄 Reiniciando Docker Desktop..."
Stop-Process -Name "Docker Desktop" -Force -ErrorAction SilentlyContinue
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"

Write-Host "✅ Kubernetes $mode com sucesso!"
