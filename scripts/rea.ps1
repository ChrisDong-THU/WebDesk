#!/usr/bin/env pwsh
# Project-local REA. Uses its own Node runtime and leaves the system Node intact.
$ErrorActionPreference = 'Stop'
$reaRoot = Split-Path -Parent $PSScriptRoot
$reaNode = Join-Path $reaRoot '.tools/rea-runtime/node-v24.11.0-win-x64/node.exe'
$reaCli = Join-Path $reaRoot '.tools/rea/node_modules/rea-agents/scripts/rea.mjs'
if (!(Test-Path -LiteralPath $reaNode) -or !(Test-Path -LiteralPath $reaCli)) {
    throw 'REA runtime missing. See docs/billd-desk-rea-analysis.md for installation.'
}
$reaTemp = Join-Path $reaRoot '.tools/rea-analysis/temp'
New-Item -ItemType Directory -Force -Path $reaTemp | Out-Null
$reaPreviousTemp = $env:TEMP
$reaPreviousTmp = $env:TMP
try {
    # Windows sandbox workers must share a workspace-writable transfer directory.
    $env:TEMP = $reaTemp
    $env:TMP = $reaTemp
    & $reaNode $reaCli @args
    $reaExitCode = $LASTEXITCODE
} finally {
    $env:TEMP = $reaPreviousTemp
    $env:TMP = $reaPreviousTmp
}
exit $reaExitCode
