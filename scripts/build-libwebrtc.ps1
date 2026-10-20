param([int]$Jobs = 4)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$spec = (Get-Content (Join-Path $root 'native\flutter\dependencies.json') -Raw | ConvertFrom-Json).libwebrtc.sourceBuild
$buildRoot = Join-Path $root '.tools\webrtc-build'
$artifact = Join-Path $buildRoot 'external-audio'
$patch = Join-Path $root 'native\flutter\libwebrtc-external-audio.patch'
$recipe = @{
  wrapper = $spec.wrapperCommit
  engine = $spec.engineCommit
  depotTools = $spec.depotToolsCommit
  patch = (Get-FileHash -LiteralPath $patch -Algorithm SHA256).Hash
  script = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
}
$recordPath = Join-Path $artifact 'build.json'
$dll = Join-Path $artifact 'libwebrtc.dll'
$importLibrary = Join-Path $artifact 'libwebrtc.dll.lib'
if ((Test-Path -LiteralPath $recordPath) -and (Test-Path -LiteralPath $dll) -and (Test-Path -LiteralPath $importLibrary)) {
  $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  $matches = $true
  foreach ($key in $recipe.Keys) { if ($record.recipe.$key -ne $recipe[$key]) { $matches = $false } }
  if ($matches -and (Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash -eq $record.sha256 -and
      (Get-FileHash -LiteralPath $importLibrary -Algorithm SHA256).Hash -eq $record.importSha256) {
    Write-Host "Verified external-audio WebRTC: $dll"
    return
  }
}
function Invoke-WebRtcGit([string[]]$Arguments) {
  & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw "git failed: $Arguments" }
}
function Checkout([string]$Url, [string]$Commit, [string]$Directory) {
  if (-not (Test-Path -LiteralPath (Join-Path $Directory '.git'))) {
    New-Item -ItemType Directory -Force $Directory | Out-Null
    Invoke-WebRtcGit @('init', $Directory)
    Invoke-WebRtcGit @('-C', $Directory, 'remote', 'add', 'origin', $Url)
    Invoke-WebRtcGit @('-C', $Directory, 'fetch', '--depth=1', 'origin', $Commit)
    Invoke-WebRtcGit @('-C', $Directory, 'checkout', '--detach', 'FETCH_HEAD')
  }
  $actual = & git -C $Directory rev-parse HEAD
  if ($LASTEXITCODE -ne 0 -or $actual -ne $Commit) { throw "Unexpected source checkout in $Directory; preserve and resolve manually." }
}
function ApplyPatch([string]$Directory, [string]$PatchPath) {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & git -C $Directory apply --reverse --check $PatchPath 2>$null
    $applied = $LASTEXITCODE -eq 0
  } finally { $ErrorActionPreference = $previousPreference }
  if (-not $applied) {
    Invoke-WebRtcGit @('-C', $Directory, 'apply', '--check', $PatchPath)
    Invoke-WebRtcGit @('-C', $Directory, 'apply', $PatchPath)
  }
}
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -version '[17.0,18.0)' -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Building WebRTC requires Visual Studio 2022 C++ Build Tools and Windows SDK 10.0.26100.0.' }
New-Item -ItemType Directory -Force $buildRoot | Out-Null
$depot = Join-Path $buildRoot 'depot_tools'
$engine = Join-Path $buildRoot 'src'
$wrapper = Join-Path $engine 'libwebrtc'
Checkout 'https://chromium.googlesource.com/chromium/tools/depot_tools.git' $spec.depotToolsCommit $depot
Checkout 'https://github.com/webrtc-sdk/webrtc.git' $spec.engineCommit $engine
Checkout 'https://github.com/webrtc-sdk/libwebrtc.git' $spec.wrapperCommit $wrapper
# The pinned DEPS has one unnamed hook: downloading upstream test media.
# We only build the production DLL and use our own small regression tone.
@"
solutions = [{"name": "src", "url": "https://github.com/webrtc-sdk/webrtc.git@$($spec.engineCommit)", "deps_file": "DEPS", "managed": False, "custom_deps": {}, "custom_hooks": [{"name": ""}], "custom_vars": {"checkout_configuration": "small", "download_remoteexec_cfg": False}}]
target_os = ["win"]
"@ | Set-Content -LiteralPath (Join-Path $buildRoot '.gclient') -Encoding ascii
$env:DEPOT_TOOLS_WIN_TOOLCHAIN = '0'
$env:DEPOT_TOOLS_UPDATE = '0'
$env:VPYTHON_VIRTUALENV_ROOT = Join-Path $buildRoot 'vpython'
$env:CIPD_CACHE_DIR = Join-Path $buildRoot 'cipd-cache'
$env:vs2022_install = $vs
$env:GYP_MSVS_OVERRIDE_PATH = $vs
# GN loads vcvarsall itself. Do not append stale SDK paths inherited from an
# IDE/developer shell to the selected VS 2022 toolchain.
$env:INCLUDE = $null
$env:LIB = $null
$env:LIBPATH = $null
$env:PATH = "$depot;$env:PATH"
Push-Location $buildRoot
try {
  & (Join-Path $depot 'gclient.bat') sync --no-history --shallow --nohooks --jobs=8
  if ($LASTEXITCODE -ne 0) { throw 'WebRTC dependency sync failed' }
  foreach ($name in @('custom_audio_source_m150.patch', 'add_libwebrtc_build_target.patch', 'allow_176k4_192k_shared_mode_formats.patch')) {
    ApplyPatch $engine (Join-Path $wrapper "patches\$name")
  }
  ApplyPatch $wrapper $patch
  & (Join-Path $depot 'gclient.bat') runhooks
  if ($LASTEXITCODE -ne 0) { throw 'WebRTC toolchain setup failed' }
  $python = & (Join-Path $depot 'vpython3.bat') -vpython-spec (Join-Path $engine '.vpython3') -c 'import sys; print(sys.executable)'
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $python)) { throw 'WebRTC Python setup failed' }
  $env:PATH = "$(Split-Path $python);$env:PATH"
  # The shallow build-tools checkout may lack a Change-Id commit and produce
  # timestamp 0. Use the pinned engine commit for valid, reproducible PE dates.
  & $python (Join-Path $engine 'build\util\lastchange.py') --source-dir $engine --filter . -o (Join-Path $engine 'build\util\LASTCHANGE')
  if ($LASTEXITCODE -ne 0) { throw 'WebRTC source timestamp generation failed' }
  $output = Join-Path $engine 'out-webdesk'
  # The wrapper declares its unit-test target unconditionally; include its GN
  # dependencies, but ask Ninja to build only libwebrtc below.
  $gnArgs = 'is_debug=false is_clang=true target_cpu="x64" use_custom_libcxx=false rtc_libvpx_build_vp9=true enable_libaom=true rtc_include_tests=true rtc_build_examples=false rtc_build_tools=false is_component_build=false rtc_enable_protobuf=false rtc_use_h264=true ffmpeg_branding="Chrome" rtc_use_h265=true symbol_level=0 enable_iterator_debugging=false use_siso=false'
  New-Item -ItemType Directory -Force $output | Out-Null
  # Avoid Windows PowerShell 5 stripping the quotes from native --args values.
  $gnArgs | Set-Content -LiteralPath (Join-Path $output 'args.gn') -Encoding ascii
  & (Join-Path $engine 'buildtools\win\gn.exe') gen $output "--root=$engine" "--script-executable=$python"
  if ($LASTEXITCODE -ne 0) { throw 'WebRTC GN generation failed' }
  & (Join-Path $engine 'third_party\ninja\ninja.exe') -C $output "-j$Jobs" libwebrtc
  if ($LASTEXITCODE -ne 0) { throw 'WebRTC compilation failed' }
  New-Item -ItemType Directory -Force $artifact | Out-Null
  Copy-Item -LiteralPath (Join-Path $output 'libwebrtc.dll') -Destination $dll
  Copy-Item -LiteralPath (Join-Path $output 'libwebrtc.dll.lib') -Destination $artifact
  @{
    recipe = $recipe
    sha256 = (Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash
    importSha256 = (Get-FileHash -LiteralPath $importLibrary -Algorithm SHA256).Hash
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordPath -Encoding utf8
  Write-Host "Built external-audio WebRTC: $dll"
} finally { Pop-Location }
