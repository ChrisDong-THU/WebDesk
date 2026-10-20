param(
  [string]$Plugin = (Join-Path (Split-Path $PSScriptRoot -Parent) 'third_party\flutter-webrtc'),
  [string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'test-results\task-runner'),
  [switch]$ExpectDeadlock
)
$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'MSVC C++ tools are required' }
$devShell = Join-Path $vs 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
Import-Module $devShell
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'
$Plugin = (Resolve-Path -LiteralPath $Plugin).Path
$out = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $out | Out-Null
Push-Location $out
try {
  & cl.exe /nologo /EHsc /std:c++17 /W4 /WX /DUNICODE /D_UNICODE "/I$Plugin\windows" "/I$Plugin\common\cpp\include" (Join-Path (Split-Path $PSScriptRoot -Parent) 'tests\task-runner-regression.cpp') "$Plugin\windows\task_runner_windows.cc" /Fe:task-runner-test.exe /link user32.lib
  if ($LASTEXITCODE -ne 0) { throw 'Native regression build failed' }
  foreach ($scenario in @('enqueue', 'reentrant', 'producer', 'destructor', 'fairness')) {
    $process = Start-Process -FilePath (Join-Path $out 'task-runner-test.exe') -ArgumentList $scenario -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $out "$scenario.txt")
    # Keep the process handle open so Windows PowerShell 5 retains ExitCode
    # after WaitForExit (the installer/CI uses that shell).
    $null = $process.Handle
    $completed = $process.WaitForExit(5000)
    if (-not $completed) {
      $process.Kill()
      $process.WaitForExit()
      if (-not $ExpectDeadlock) { throw "$scenario deadlocked" }
      Write-Host "$scenario reproduced deadlock"
    } else {
      if ($ExpectDeadlock) { throw "$scenario did not reproduce deadlock" }
      if ($process.ExitCode -ne 0) { throw "$scenario failed: $($process.ExitCode)" }
      Get-Content -LiteralPath (Join-Path $out "$scenario.txt")
    }
    $process.Dispose()
  }
  if (-not $ExpectDeadlock) {
    $root = Split-Path $PSScriptRoot -Parent
    & cl.exe /nologo /EHsc /std:c++17 /W4 /WX /DUNICODE /D_UNICODE "/I$root\desktop\flutter\windows\runner" "$root\tests\remote-caption-buttons.cpp" /Fe:remote-caption-test.exe /link user32.lib dwmapi.lib
    if ($LASTEXITCODE -ne 0) { throw 'Caption regression build failed' }
    $process = Start-Process -FilePath (Join-Path $out 'remote-caption-test.exe') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $out 'caption.txt')
    $null = $process.Handle
    if (-not $process.WaitForExit(5000)) {
      $process.Kill()
      $process.WaitForExit()
      throw 'Remote caption handling deadlocked'
    }
    if ($process.ExitCode -ne 0) { throw "Remote caption regression failed: $($process.ExitCode)" }
    Get-Content -LiteralPath (Join-Path $out 'caption.txt')
    $process.Dispose()
    & cl.exe /nologo /EHsc /std:c++17 /W4 /WX /DUNICODE /D_UNICODE "$root\tests\flutter-window-probe.cpp" /Fe:flutter-window-probe.exe /link user32.lib
    if ($LASTEXITCODE -ne 0) { throw 'Flutter window probe build failed' }
  }
} finally { Pop-Location }
