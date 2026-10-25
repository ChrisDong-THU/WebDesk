param(
  [Parameter(Mandatory = $true)][ValidatePattern('^i-[a-z0-9]+$')][string]$InstanceId,
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [string]$WorkbenchPath,
  [switch]$Activate
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version' }
if (-not $WorkbenchPath) {
  $command = Get-Command workbench.exe -ErrorAction SilentlyContinue
  $WorkbenchPath = if ($command) { $command.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\workbench\workbench.exe' }
}
if (-not (Test-Path -LiteralPath $WorkbenchPath -PathType Leaf)) { throw 'Workbench CLI not found; pass -WorkbenchPath' }
$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
$activation = Join-Path $root 'deploy\activate-release.sh'
$digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$scriptDigest = (Get-FileHash -LiteralPath $activation -Algorithm SHA256).Hash.ToLowerInvariant()
$remoteArchive = "/tmp/webdesk-$version-$($digest.Substring(0,12)).tar.gz"
$remoteScript = "/tmp/webdesk-activate-$version-$($scriptDigest.Substring(0,12)).sh"

function Invoke-Workbench([string[]]$Arguments) {
  # Windows PowerShell 5 turns native stderr (including upload progress) into
  # ErrorRecords. Capture it without terminating before inspecting ExitCode.
  $preference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = & $WorkbenchPath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $preference }
  $safe = ($lines | ForEach-Object { $_.ToString() }) -join "`n"
  $safe = $safe -replace '(?i)(securityToken=)[^&\s"\\]+', '$1[REDACTED]'
  if ($exitCode -ne 0) { throw "Workbench failed ($exitCode): $safe" }
  return $safe
}

function Invoke-WorkbenchRemote([string]$CommandText) {
  $raw = Invoke-Workbench @('exec', '--instance-id', $InstanceId, '--command', $CommandText, '--timeout', '120', '--output', 'json')
  $result = $raw | ConvertFrom-Json
  if ($result.exit_code -ne 0) { throw "Remote command failed ($($result.exit_code)): $($result.output) $($result.stderr)" }
  return $result.output
}

function Publish-ReleaseFile([string]$LocalPath, [string]$RemotePath, [string]$ExpectedDigest) {
  # Existing identical files can be reused; never overwrite a different upload.
  $existing = Invoke-WorkbenchRemote "if test -e '$RemotePath'; then sha256sum '$RemotePath'; else echo MISSING; fi"
  if ($existing.Trim() -ne 'MISSING') {
    if ($existing.Trim().Split()[0] -ne $ExpectedDigest) { throw "Remote upload collision: $RemotePath" }
    return
  }
  Write-Host "Uploading $([IO.Path]::GetFileName($LocalPath))"
  $null = Invoke-Workbench @('upload', $LocalPath, $RemotePath, '--instance-id', $InstanceId)
  $verified = Invoke-WorkbenchRemote "sha256sum '$RemotePath'"
  if ($verified.Trim().Split()[0] -ne $ExpectedDigest) { throw "Upload digest mismatch: $RemotePath" }
}

Publish-ReleaseFile $archive $remoteArchive $digest
Publish-ReleaseFile $activation $remoteScript $scriptDigest
$null = Invoke-WorkbenchRemote "bash -n '$remoteScript'"
if ($Activate) {
  Write-Host "Activating WebDesk $version on $InstanceId; existing sessions will reconnect."
  Invoke-WorkbenchRemote "bash '$remoteScript' '$version' '$remoteArchive' '$digest'" | Write-Host
} else {
  Write-Host 'Staged and verified. Pass -Activate after reviewing the release to switch the service.'
}
@{ version = $version; instance = $InstanceId; archive = $archive; sha256 = $digest; remoteArchive = $remoteArchive; remoteScript = $remoteScript; activated = [bool]$Activate } | ConvertTo-Json
