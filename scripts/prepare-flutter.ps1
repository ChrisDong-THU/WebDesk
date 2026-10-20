$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content (Join-Path $root 'native\flutter\dependencies.json') -Raw | ConvertFrom-Json
function Invoke-Git([string[]] $Arguments) {
  & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw "git failed: $Arguments" }
}
function Ensure-Checkout($Spec, [string] $Directory) {
  if (-not (Test-Path -LiteralPath (Join-Path $Directory '.git'))) {
    New-Item -ItemType Directory -Force $Directory | Out-Null
    Invoke-Git @('init', $Directory)
    Invoke-Git @('-C', $Directory, 'remote', 'add', 'origin', $Spec.repository)
    Invoke-Git @('-C', $Directory, 'fetch', '--depth=1', 'origin', $Spec.commit)
    Invoke-Git @('-C', $Directory, 'checkout', '--detach', 'FETCH_HEAD')
  }
  $actual = & git -C $Directory rev-parse HEAD
  if ($actual -ne $Spec.commit) { throw "Unexpected checkout in $Directory; keep local work and resolve manually." }
}
$sdk = Join-Path $root '.tools\flutter'
$plugin = Join-Path $root 'third_party\flutter-webrtc'
Ensure-Checkout $manifest.flutter $sdk
Ensure-Checkout $manifest.flutterWebrtc $plugin
$patch = Join-Path $root 'native\flutter\flutter-webrtc.patch'
& git -C $plugin apply --reverse --check $patch 2>$null
if ($LASTEXITCODE -ne 0) {
  Invoke-Git @('-C', $plugin, 'apply', '--check', $patch)
  Invoke-Git @('-C', $plugin, 'apply', $patch)
}
# Pin and verify the binary before upstream CMake sees its download cache.
$archive = Join-Path $plugin 'third_party\downloads\libwebrtc-win-x64-release.zip'
if (-not (Test-Path -LiteralPath $archive)) {
  New-Item -ItemType Directory -Force (Split-Path $archive) | Out-Null
  Invoke-WebRequest -Uri $manifest.libwebrtc.url -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $manifest.libwebrtc.sha256) { throw 'libwebrtc checksum mismatch' }
$env:PUB_CACHE = Join-Path $root '.tools\pub-cache'
$flutter = Join-Path $sdk 'bin\flutter.bat'
$app = Join-Path $root 'desktop\flutter'
Push-Location $app
try {
  & $flutter pub get --enforce-lockfile
  $dependenciesPath = Join-Path $app '.flutter-plugins-dependencies'
  if ($LASTEXITCODE -ne 0 -and -not (Test-Path $dependenciesPath)) { throw 'Flutter dependencies failed' }
  # Directory junctions work without changing Developer Mode or OS settings.
  $links = Join-Path $app 'windows\flutter\ephemeral\.plugin_symlinks'
  New-Item -ItemType Directory -Force $links | Out-Null
  $dependencies = Get-Content $dependenciesPath -Raw | ConvertFrom-Json
  foreach ($item in $dependencies.plugins.windows) {
    $link = Join-Path $links $item.name
    if (-not (Test-Path -LiteralPath $link)) { New-Item -ItemType Junction -Path $link -Target $item.path | Out-Null }
  }
  & $flutter pub get --enforce-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Flutter dependencies failed' }
} finally { Pop-Location }
