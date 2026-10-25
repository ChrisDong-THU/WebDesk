param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'test-results\file-selection-flutter'
New-Item -ItemType Directory -Force $out | Out-Null
$probe = Join-Path $root 'test-results\task-runner\flutter-window-probe.exe'
if (-not (Test-Path -LiteralPath $probe)) { throw 'Run test-flutter-task-runner.ps1 first to build the native probe' }
$env:PUB_CACHE = Join-Path $root '.tools\pub-cache'
Push-Location (Join-Path $root 'desktop\flutter')
try {
  & (Join-Path $root '.tools\flutter\bin\flutter.bat') build windows --release --no-pub --target test_driver/file_selection_smoke.dart
  if ($LASTEXITCODE -ne 0) { throw 'File selection Flutter build failed' }
} finally { Pop-Location }
$stage = Join-Path $out ('host-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $stage | Out-Null
Copy-Item -Path (Join-Path $root 'desktop\flutter\build\windows\x64\runner\Release\*') -Destination $stage -Recurse
$report = Join-Path $stage 'result.json'
$executable = Join-Path $stage 'WebDesk.exe'
& node (Join-Path $root 'scripts\exe-manifest.cjs') $executable --as-invoker
if ($LASTEXITCODE -ne 0) { throw 'Unexpected test fixture execution level' }
$process = Start-Process -FilePath $executable -ArgumentList ('"{0}" "{1}"' -f $report,$probe) -WorkingDirectory $stage -WindowStyle Hidden -PassThru
$null = $process.Handle
try {
  if (-not $process.WaitForExit(30000)) {
    $process.Kill()
    $process.WaitForExit()
    throw 'File selection Flutter regression timed out'
  }
  if (-not (Test-Path -LiteralPath $report)) { throw 'File selection Flutter report missing' }
  $result = Get-Content -LiteralPath $report -Raw -Encoding UTF8 | ConvertFrom-Json
  $result | ConvertTo-Json -Depth 6
  Copy-Item -LiteralPath $report -Destination (Join-Path $out 'result.json')
  if ($process.ExitCode -ne 0 -or -not $result.ok) { throw 'File selection Flutter regression failed' }
} finally { $process.Dispose() }
