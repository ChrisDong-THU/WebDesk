$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$env:PUB_CACHE = Join-Path $root '.tools\pub-cache'
$app = Join-Path $root 'desktop\flutter'
Push-Location $app
try {
  & (Join-Path $root '.tools\flutter\bin\flutter.bat') build windows --release --no-pub --target test_driver/audio_loopback.dart
  if ($LASTEXITCODE -ne 0) { throw 'Audio test build failed' }
} finally { Pop-Location }
$testRoot = Join-Path $root ('test-results\audio-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
Copy-Item -Path (Join-Path $app 'build\windows\x64\runner\Release\*') -Destination $testRoot -Recurse
$env:WEBDESK_AUDIO_TEST_DIR = $testRoot
$toneScript = Join-Path $testRoot 'play-tone.ps1'
@'
$player = New-Object System.Media.SoundPlayer
$player.SoundLocation = Join-Path $env:WEBDESK_AUDIO_TEST_DIR 'tone.wav'
$player.Load()
'ready' | Set-Content (Join-Path $env:WEBDESK_AUDIO_TEST_DIR 'tone-started')
$player.PlaySync()
'@ | Set-Content -LiteralPath $toneScript -Encoding utf8
$testProcess = $null
$toneProcess = $null
try {
  $testProcess = Start-Process -FilePath (Join-Path $testRoot 'WebDesk.exe') -ArgumentList $testRoot -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'stdout.txt') -RedirectStandardError (Join-Path $testRoot 'stderr.txt')
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Path -LiteralPath (Join-Path $testRoot 'tone-ready'))) {
    if ($testProcess.HasExited -or (Get-Date) -gt $deadline) { throw "Audio test did not become ready: $testRoot" }
    Start-Sleep -Milliseconds 100
  }
  $toneProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',"`"$toneScript`"") -WindowStyle Hidden -PassThru
  if (-not $testProcess.WaitForExit(30000)) { throw 'Audio test timed out' }
  $result = Get-Content -LiteralPath (Join-Path $testRoot 'result.json') -Raw | ConvertFrom-Json
  if (-not $result.ok) { throw ($result | ConvertTo-Json -Depth 8) }
  Write-Host "System audio on/off, video independence and restart passed: $testRoot\result.json"
} finally {
  if ($toneProcess -and -not $toneProcess.HasExited) { $toneProcess.Kill() }
  if ($testProcess -and -not $testProcess.HasExited) { $testProcess.Kill() }
  Remove-Item Env:\WEBDESK_AUDIO_TEST_DIR -ErrorAction SilentlyContinue
}
