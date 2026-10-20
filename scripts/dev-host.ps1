$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$env:PUB_CACHE = Join-Path $root '.tools\pub-cache'
Push-Location (Join-Path $root 'desktop\flutter')
try {
  & (Join-Path $root '.tools\flutter\bin\flutter.bat') run -d windows
  if ($LASTEXITCODE -ne 0) { throw 'Flutter development host failed' }
} finally { Pop-Location }
