param([switch]$Baseline)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'test-results\tray-menu'
New-Item -ItemType Directory -Force $out | Out-Null
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'MSVC C++ tools are required' }
Import-Module (Join-Path $vs 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'
Push-Location $out
try {
  & cl.exe /nologo /EHsc /std:c++17 /W4 /WX /DUNICODE /D_UNICODE "/I$root\third_party\tray_manager\windows" "$root\tests\tray-menu.cpp" /Fe:tray-menu-test.exe /link user32.lib
  if ($LASTEXITCODE -ne 0) { throw 'Tray regression build failed' }
  $options = @{
    FilePath = Join-Path $out 'tray-menu-test.exe'
    WindowStyle = 'Hidden'
    PassThru = $true
    RedirectStandardOutput = Join-Path $out 'result.txt'
  }
  if ($Baseline) { $options.ArgumentList = 'baseline' }
  $process = Start-Process @options
  $null = $process.Handle
  if (-not $process.WaitForExit(10000)) {
    $process.Kill()
    $process.WaitForExit()
    throw 'Tray menu tracking did not return'
  }
  Get-Content -LiteralPath (Join-Path $out 'result.txt')
  if ($process.ExitCode -ne 0) { throw "Tray regression failed: $($process.ExitCode)" }
  $process.Dispose()
} finally { Pop-Location }
