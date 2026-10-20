param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$arguments = @("/DAppVersion=$version")
if ($ValidateOnly) { $arguments += '/O-' }
& (Join-Path $projectRoot '.tools\inno\ISCC.exe') @arguments (Join-Path $projectRoot 'build\inno\Preview.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer preview compilation failed' }
