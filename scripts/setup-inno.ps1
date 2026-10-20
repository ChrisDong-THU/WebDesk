$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$spec = (Get-Content (Join-Path $projectRoot 'native/flutter/dependencies.json') -Raw | ConvertFrom-Json).innoSetup
$tools = Join-Path $projectRoot '.tools'
$destination = Join-Path $tools 'inno'
$download = Join-Path $tools "innosetup-$($spec.version).exe"
New-Item -ItemType Directory -Force -Path $tools | Out-Null
if (-not (Test-Path -LiteralPath $download)) { Invoke-WebRequest -Uri $spec.url -OutFile $download }
if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $spec.sha256) { throw 'Inno Setup checksum mismatch' }
$process = Start-Process -FilePath $download -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',"/DIR=`"$destination`"") -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Inno Setup installation failed: $($process.ExitCode)" }
if (-not (Test-Path -LiteralPath (Join-Path $destination 'ISCC.exe'))) { throw 'Inno Setup compiler missing' }
