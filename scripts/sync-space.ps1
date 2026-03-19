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
