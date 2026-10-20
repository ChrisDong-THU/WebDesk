param([switch]$Installer, [switch]$SkipPrepare)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $SkipPrepare) { & (Join-Path $PSScriptRoot 'prepare-flutter.ps1') }
# Also verify the patched DLL when preparation was skipped for an incremental
# build; never package the upstream microphone-opening binary.
& (Join-Path $PSScriptRoot 'build-libwebrtc.ps1')
$env:PUB_CACHE = Join-Path $root '.tools\pub-cache'
$flutter = Join-Path $root '.tools\flutter\bin\flutter.bat'
$app = Join-Path $root 'desktop\flutter'
$versionMatch = [regex]::Match((Get-Content (Join-Path $app 'pubspec.yaml') -Raw), '(?m)^version:\s*([0-9.]+)')
if (-not $versionMatch.Success) { throw 'Missing Flutter version' }
$version = $versionMatch.Groups[1].Value
Push-Location $root
try {
  & node scripts/check-release.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Release versions do not match' }
  & node scripts/build-native.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
  # Exercise caption input and the patched Windows dispatcher before packaging.
  & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-flutter-task-runner.ps1
  if ($LASTEXITCODE -ne 0) { throw 'WebRTC task runner regression failed' }
  & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-tray.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Tray menu regression failed' }
} finally { Pop-Location }
Push-Location $app
try {
  & $flutter analyze
  if ($LASTEXITCODE -ne 0) { throw 'Flutter analysis failed' }
  & $flutter test
  if ($LASTEXITCODE -ne 0) { throw 'Flutter tests failed' }
  # Always specify the production entrypoint. Integration drivers cannot leak
  # into a release after a prior test build.
  & $flutter build windows --release --target lib/main.dart
  if ($LASTEXITCODE -ne 0) { throw 'Flutter build failed' }
} finally { Pop-Location }
$releaseRoot = Join-Path $root "flutter-release\$version"
$payload = Join-Path $releaseRoot ('payload-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $payload | Out-Null
Copy-Item -Path (Join-Path $app 'build\windows\x64\runner\Release\*') -Destination $payload -Recurse
$audioBuild = Get-Content (Join-Path $root '.tools\webrtc-build\external-audio\build.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath (Join-Path $payload 'libwebrtc.dll') -Algorithm SHA256).Hash -ne $audioBuild.sha256) {
  throw 'Release payload did not contain the verified external-audio WebRTC library'
}
foreach ($required in @('WebDesk.exe','flutter_windows.dll','libwebrtc.dll','msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll','data\app.so')) {
  if (-not (Test-Path -LiteralPath (Join-Path $payload $required))) { throw "Missing release dependency: $required" }
}
& node (Join-Path $root 'scripts\exe-manifest.cjs') (Join-Path $payload 'WebDesk.exe')
if ($LASTEXITCODE -ne 0) { throw 'Installed client requires the administrator manifest' }
New-Item -ItemType Directory -Force (Join-Path $payload 'native') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'native\windows\bin\WebDeskNative.exe') -Destination (Join-Path $payload 'native')
$notices = Join-Path $payload 'licenses'
New-Item -ItemType Directory -Force $notices | Out-Null
foreach ($source in @('LICENSE.txt','THIRD_PARTY_NOTICES.md')) { Copy-Item -LiteralPath (Join-Path $root $source) -Destination $notices }
Copy-Item -LiteralPath (Join-Path $root 'third_party\flutter-webrtc\LICENSE') -Destination (Join-Path $notices 'flutter-webrtc.txt')
Copy-Item -LiteralPath (Join-Path $root 'third_party\tray_manager\LICENSE') -Destination (Join-Path $notices 'tray-manager.txt')
Copy-Item -LiteralPath (Join-Path $root 'third_party\flutter-webrtc\third_party\libwebrtc\LICENSE') -Destination (Join-Path $notices 'libwebrtc-wrapper.txt')
Copy-Item -LiteralPath (Join-Path $root '.tools\flutter\LICENSE') -Destination (Join-Path $notices 'flutter.txt')
Copy-Item -LiteralPath (Join-Path $root 'third_party\licenses') -Destination (Join-Path $notices 'native') -Recurse
if ($Installer) {
  $compiler = Join-Path $root '.tools\inno\ISCC.exe'
  if (-not (Test-Path -LiteralPath $compiler)) { throw 'Install Inno Setup 6.7.3 in .tools\inno first (see native/flutter/dependencies.json).' }
  & $compiler "/DPayloadDir=$payload" "/DAppVersion=$version" (Join-Path $root 'build\inno\WebDesk.iss')
  if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed' }
  $installerPath = Join-Path $releaseRoot "WebDesk-$version-win-x64.exe"
  $digest = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  "$digest  $([IO.Path]::GetFileName($installerPath))" |
    Set-Content -Encoding ascii -LiteralPath "$installerPath.sha256"
}
$files = @(Get-ChildItem -LiteralPath $payload -Recurse -File)
@{ version=$version; payload=$payload; bytes=($files | Measure-Object Length -Sum).Sum; files=$files.Count; entrypoint='lib/main.dart' } |
  ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $releaseRoot 'build.json')
Write-Host "Production payload: $payload"
