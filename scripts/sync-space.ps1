param(
  [string[]]$Remotes = @('space', 'space-show'),
  [string]$SourceBranch = 'main',
  [string]$TempBranch = '__space-sync-tmp',
  [switch]$AutoStash = $true,
  [switch]$IncludeUntracked = $true
)

$ErrorActionPreference = 'Stop'

$excludePatterns = @(
  'public/readme-images/*.png',
  'src/audio/tracks/*.mp3'
)

$hfReadmeFrontmatterPath = Join-Path $PSScriptRoot 'hf-readme-frontmatter.txt'

function Remove-ReadmeFrontmatter {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  if (-not $Content.StartsWith("---`n") -and -not $Content.StartsWith("---`r`n")) {
    return $Content
  }

  $normalized = $Content -replace "`r`n", "`n"
  $lines = $normalized -split "`n"
  if ($lines.Count -lt 3 -or $lines[0] -ne '---') {
    return $Content
  }

  for ($i = 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -eq '---') {
      $remaining = if ($i + 1 -lt $lines.Count) {
        ($lines[($i + 1)..($lines.Count - 1)] -join "`n").TrimStart("`n")
      } else {
        ''
      }

      if ([string]::IsNullOrEmpty($remaining)) {
        return ''
      }

      return $remaining
    }
  }

  return $Content
}

function Update-SpaceReadme {
  $readmePath = Join-Path (Get-Location) 'README.md'
  if (-not (Test-Path $readmePath) -or -not (Test-Path $hfReadmeFrontmatterPath)) {
    return
  }

  $frontmatter = [System.IO.File]::ReadAllText($hfReadmeFrontmatterPath).Trim()
  $readmeBody = [System.IO.File]::ReadAllText($readmePath)
  $strippedBody = (Remove-ReadmeFrontmatter -Content $readmeBody).TrimStart()
  $updatedReadme = "$frontmatter`r`n`r`n$strippedBody"
  [System.IO.File]::WriteAllText($readmePath, $updatedReadme)
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args,
    [string]$ErrorMessage = 'Git command failed.'
  )

  & git @Args
  if ($LASTEXITCODE -ne 0) {
    throw $ErrorMessage
  }
}

function Get-TrimmedGitOutput {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args,
    [string]$ErrorMessage = 'Git command failed.'
  )

  $output = (& git @Args)
  if ($LASTEXITCODE -ne 0) {
    throw $ErrorMessage
  }
  return ($output | Out-String).Trim()
}

function Test-GitRemoteExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Remote
  )

  & git remote get-url $Remote *> $null
  return $LASTEXITCODE -eq 0
}

$resolvedRemotes = @($Remotes | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($resolvedRemotes.Count -eq 0) {
  throw 'Error: no remotes specified.'
}

$missingRemotes = @($resolvedRemotes | Where-Object { -not (Test-GitRemoteExists $_) })
if ($missingRemotes.Count -gt 0) {
  throw "Error: remote not found: $($missingRemotes -join ', ')"
}

$current = Get-TrimmedGitOutput -Args @('branch', '--show-current') -ErrorMessage 'Failed to read current branch.'
if ($current -ne $SourceBranch) {
  throw "Error: please checkout $SourceBranch first"
}

$status = Get-TrimmedGitOutput -Args @('status', '--porcelain') -ErrorMessage 'Failed to check working tree status.'
$workingTreeDirty = -not [string]::IsNullOrWhiteSpace($status)
$stashCreated = $false
$createdTempBranch = $false
$pushFailures = New-Object System.Collections.Generic.List[string]

try {
  if ($workingTreeDirty) {
    if (-not $AutoStash) {
      throw 'Error: working tree not clean, please commit or stash first'
    }

    Write-Host 'Working tree is not clean. Auto-stashing changes...'
    $stashArgs = @('stash', 'push', '-m', '__space_sync_auto__')
    if ($IncludeUntracked) {
      $stashArgs += '--include-untracked'
    }
    Invoke-Git -Args $stashArgs -ErrorMessage 'Failed to stash working tree.'
    $stashCreated = $true
  }

  Invoke-Git -Args @('checkout', '--orphan', $TempBranch) -ErrorMessage 'Failed to create orphan temp branch.'
  $createdTempBranch = $true

  Update-SpaceReadme

  Invoke-Git -Args @('add', '-A') -ErrorMessage 'Failed to stage files on temp branch.'

  foreach ($pattern in $excludePatterns) {
    & git rm -rf --cached --ignore-unmatch -- $pattern 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Warning: failed to exclude pattern: $pattern"
    }
  }

  $head = Get-TrimmedGitOutput -Args @('log', $SourceBranch, '-1', "--format=%h %s") -ErrorMessage "Failed to get latest commit from $SourceBranch."
  Invoke-Git -Args @('commit', '-m', "Sync from ${SourceBranch}: $head") -ErrorMessage 'Failed to create sync snapshot commit.'

  foreach ($remote in $resolvedRemotes) {
    Write-Host "Pushing to $remote..."
    & git push $remote "${TempBranch}:main" --force
    if ($LASTEXITCODE -eq 0) {
      Write-Host "  ✓ $remote pushed"
    } else {
      Write-Host "  ✗ $remote push failed"
      $pushFailures.Add($remote) | Out-Null
    }
  }

  if ($pushFailures.Count -gt 0) {
    throw "Push failed for remotes: $($pushFailures -join ', ')"
  }
}
finally {
  if ($createdTempBranch) {
    & git checkout -f $SourceBranch | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Warning: failed to switch back to $SourceBranch"
    }

    & git branch -D $TempBranch | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Warning: failed to delete temp branch $TempBranch"
    }
  }

  if ($stashCreated) {
    Write-Host 'Restoring stashed changes...'
    & git stash pop --index 'stash@{0}' | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'Warning: failed to auto-restore stash. Recover it manually with: git stash list'
    }
  }
}

Write-Host 'Done!'
