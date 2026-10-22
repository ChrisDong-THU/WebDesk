param([switch]$ExpectFailure)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$engine = Join-Path $root '.tools\webrtc-build\src'
$out = Join-Path $engine 'out-webdesk'
$test = Join-Path $engine 'webdesk-tests'
$buildFile = Join-Path $engine 'BUILD.gn'
$original = [IO.File]::ReadAllBytes($buildFile)
New-Item -ItemType Directory -Force $test | Out-Null
Copy-Item (Join-Path $root 'tests\desktop-capture-regression.cc') $test
Copy-Item (Join-Path $root 'tests\desktop-capture.BUILD.gn') (Join-Path $test 'BUILD.gn')
$python = Get-ChildItem (Join-Path $root '.tools\webrtc-build\vpython\store') -Filter python3.exe -Recurse | Where-Object { $_.FullName -match 'python_venv-.*Scripts' } | Select-Object -First 1 -ExpandProperty FullName
if (-not $python) { throw 'Run prepare:flutter first to prepare the native toolchain' }
$env:DEPOT_TOOLS_WIN_TOOLCHAIN = '0'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -version '[17.0,18.0)' -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio 2022 C++ tools required' }
$env:vs2022_install = $vs
$env:GYP_MSVS_OVERRIDE_PATH = $vs
$env:INCLUDE = $null
$env:LIB = $null
$env:LIBPATH = $null
$env:PATH = (Split-Path $python) + ';' + $env:PATH
try {
  Add-Content -LiteralPath $buildFile -Value "`ngroup(`"webdesk_capture_regressions`") {`n testonly = true`n deps = [`"//webdesk-tests:desktop_capture_regression`"]`n}"
  & (Join-Path $engine 'buildtools\win\gn.exe') gen $out "--root=$engine" "--script-executable=$python"
  if ($LASTEXITCODE -ne 0) { throw 'Regression GN generation failed' }
  & (Join-Path $engine 'third_party\ninja\ninja.exe') -C $out -j4 desktop_capture_regression
  if ($LASTEXITCODE -ne 0) { throw 'Capture regression compilation failed' }
  & (Join-Path $out 'desktop_capture_regression.exe')
  $code = $LASTEXITCODE
  if ($ExpectFailure) {
    if ($code -ne 1) { throw "Expected regression exit 1, got $code" }
  } elseif ($code -ne 0) { throw "Capture regression failed: $code" }
} finally { [IO.File]::WriteAllBytes($buildFile, $original) }
