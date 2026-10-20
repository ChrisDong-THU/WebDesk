param([switch]$UseInstalledHelper, [switch]$LockScreen)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this integration script in an elevated Windows PowerShell. No service changes have been made.'
  }
} finally { $identity.Dispose() }
$root = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path $root 'test-results\flutter-integration'
$originalService = 'C:\Program Files\WebDesk Native\WebDeskNative.exe'
$serviceKey = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\WebDeskNative'
$match = [regex]::Match($serviceKey.ImagePath, '--service\s+([A-Za-z0-9+/=]+)')
if (-not $match.Success) { throw 'Unknown existing service configuration; refusing to replace it.' }
$originalClient = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($match.Groups[1].Value))
if ($originalClient.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'A previous test binding remains; restore it before starting another test.'
}
$mutex = New-Object Threading.Mutex($false, 'Local\WebDeskFlutterIntegration')
if (-not $mutex.WaitOne(0)) { throw 'Another Flutter integration test is running.' }
$backupDir = Join-Path $testRoot 'service-backup'
New-Item -ItemType Directory -Force $backupDir | Out-Null
$backup = Join-Path $backupDir 'WebDeskNative.exe'
Copy-Item -LiteralPath $originalService -Destination $backup -Force
$helper = Join-Path $testRoot 'WebDeskNative.exe'
if ($UseInstalledHelper) { $helper = $backup }
$hostExe = Join-Path $testRoot 'host\WebDesk.exe'
try {
  @{ restored = $false; client = $originalClient; started = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $testRoot 'service-restored.json')
  & $helper --install $hostExe
  if ($LASTEXITCODE -ne 0) { throw 'Test service registration failed' }
  $hostArguments = @('http://127.0.0.1:44300','http://127.0.0.1:44301')
  if ($LockScreen) { $hostArguments += 'lock-test' }
  $process = Start-Process -FilePath $hostExe -ArgumentList $hostArguments -WorkingDirectory (Split-Path $hostExe) -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $testRoot 'host-stderr.txt') -RedirectStandardOutput (Join-Path $testRoot 'host-stdout.txt')
  # Keep the handle open so Windows PowerShell 5 retains the completed exit code.
  $null = $process.Handle
  if (-not $process.WaitForExit(250000)) { $process.Kill(); throw 'Flutter host timed out' }
  if ($process.ExitCode -ne 0) { throw ('Flutter host exited with ' + $process.ExitCode) }
} finally {
  if ($process) {
    # A failed Dart shutdown must not leave a test relay holding the service EXE.
    Get-CimInstance Win32_Process -Filter "Name='WebDeskNative.exe'" | Where-Object {
      $_.ParentProcessId -eq $process.Id -and $_.ExecutablePath -eq $originalService -and $_.CommandLine -match '--bridge$'
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  }
  & $backup --install $originalClient
  @{ restored = ($LASTEXITCODE -eq 0); client = $originalClient } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $testRoot 'service-restored.json')
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
