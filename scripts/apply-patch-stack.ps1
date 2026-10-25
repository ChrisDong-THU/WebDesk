function ApplyPatchStack([string]$Directory, [string[]]$Patches) {
  # Later layers may change the context of earlier layers. Compare the complete
  # expected index with the working tree instead of reverse-testing each layer.
  $temporaryIndex = Join-Path $Directory ('.webdesk-patch-index-' + [Guid]::NewGuid().ToString('N'))
  $previousIndex = $env:GIT_INDEX_FILE
  $matched = -1
  try {
    $env:GIT_INDEX_FILE = $temporaryIndex
    for ($count = $Patches.Count; $count -ge 0; $count--) {
      & git -C $Directory read-tree HEAD
      if ($LASTEXITCODE -ne 0) { throw 'Cannot read patch baseline' }
      for ($index = 0; $index -lt $count; $index++) {
        & git -C $Directory apply --cached --ignore-space-change $Patches[$index]
        if ($LASTEXITCODE -ne 0) { throw 'Cannot construct expected patch stack' }
      }
      & git -C $Directory diff --ignore-space-at-eol --quiet
      if ($LASTEXITCODE -eq 0) { $matched = $count; break }
      if ($LASTEXITCODE -ne 1) { throw 'Cannot verify WebRTC patch stack' }
    }
  } finally {
    $env:GIT_INDEX_FILE = $previousIndex
    if (Test-Path -LiteralPath $temporaryIndex) { Remove-Item -LiteralPath $temporaryIndex }
  }
  if ($matched -lt 0) { throw 'Dependency differs from every known patch layer; preserve local work and resolve manually.' }
  for ($index = $matched; $index -lt $Patches.Count; $index++) {
    & git -C $Directory apply --check $Patches[$index]
    if ($LASTEXITCODE -ne 0) { throw 'Patch conflicts with local files' }
    & git -C $Directory apply $Patches[$index]
    if ($LASTEXITCODE -ne 0) { throw 'Patch application failed' }
  }
}
