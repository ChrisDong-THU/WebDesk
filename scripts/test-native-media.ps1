$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$engine = Join-Path $root '.tools\webrtc-build\src'
$output = Join-Path $engine 'out-webdesk'
$python = Get-ChildItem (Join-Path $root '.tools\webrtc-build\vpython\store') -Filter python3.exe -Recurse | Where-Object { $_.FullName -match 'python_venv-.*Scripts' } | Select-Object -First 1 -ExpandProperty FullName
if (-not $python) { throw 'Run prepare:flutter first' }
# The preceding desktop-capture regression prepares the isolated capture test
# dependencies. This runner does not change GN or capture desktop pixels.
& $python (Join-Path $root 'tests\run-capture-policy-native.py')
if ($LASTEXITCODE -ne 0) { throw 'Capture policy / GPU conversion regression failed' }
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
& (Join-Path $engine 'third_party\ninja\ninja.exe') -C $output -j4 webdesk_h264_unittests webdesk_nvenc_unittests
if ($LASTEXITCODE -ne 0) { throw 'Native codec regression compilation failed' }
$previousDisable = $env:WEBDESK_DISABLE_HARDWARE_H264
try {
  $env:WEBDESK_DISABLE_HARDWARE_H264 = $null
  & (Join-Path $output 'webdesk_h264_unittests.exe') '--gtest_filter=-WebDeskH264.ProcessDisableSwitchBypassesProbeAndHardwareSelection'
  if ($LASTEXITCODE -ne 0) { throw 'Media Foundation H264 regression failed' }
  & (Join-Path $output 'webdesk_nvenc_unittests.exe')
  if ($LASTEXITCODE -ne 0) { throw 'NVENC regression failed' }
  # Capability results are cached per process. Each ordering must therefore
  # start before any earlier test has initialized either driver API.
  foreach ($scenario in @('MfProbeBeforeNvencAndRealEncoding', 'NvencProbeBeforeMfAndRealEncoding', 'ConcurrentProbesAndFactoryKeepNvenc')) {
    & (Join-Path $output 'webdesk_nvenc_unittests.exe') "--gtest_filter=WebDeskNvenc.$scenario" '--gtest_color=no'
    if ($LASTEXITCODE -ne 0) { throw "Fresh-process encoder initialization failed: $scenario" }
  }
  $env:WEBDESK_DISABLE_HARDWARE_H264 = '1'
  & (Join-Path $output 'webdesk_h264_unittests.exe') '--gtest_filter=WebDeskH264.ProcessDisableSwitchBypassesProbeAndHardwareSelection'
  if ($LASTEXITCODE -ne 0) { throw 'Explicit software fallback regression failed' }
} finally { $env:WEBDESK_DISABLE_HARDWARE_H264 = $previousDisable }
