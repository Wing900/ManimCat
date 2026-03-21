#!/usr/bin/env bash
# Sync main to Hugging Face Spaces as a history-free snapshot.
# Usage:
#   bash scripts/sync-space.sh
#   bash scripts/sync-space.sh space
#   bash scripts/sync-space.sh space space-show

set -euo pipefail

SOURCE_BRANCH="${SOURCE_BRANCH:-main}"
TEMP_BRANCH="${TEMP_BRANCH:-__space-sync-tmp}"
AUTO_STASH="${AUTO_STASH:-1}"
INCLUDE_UNTRACKED="${INCLUDE_UNTRACKED:-1}"

if [ "$#" -gt 0 ]; then
  REMOTES=("$@")
else
  REMOTES=("space" "space-show")
fi

# Binary files blocked by HF Spaces git server.
EXCLUDE_PATTERNS=(
  "public/readme-images/*.png"
  "src/audio/tracks/*.mp3"
)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HF_README_FRONTMATTER_PATH="$SCRIPT_DIR/hf-readme-frontmatter.txt"

update_space_readme() {
  local readme_path="README.md"
  [[ -f "$readme_path" && -f "$HF_README_FRONTMATTER_PATH" ]] || return 0

  local temp_body
  temp_body="$(mktemp)"

  awk '
    BEGIN { in_frontmatter = 0; frontmatter_done = 0 }
    NR == 1 && $0 == "---" { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" && !frontmatter_done { frontmatter_done = 1; next }
    in_frontmatter && !frontmatter_done { next }
    { print }
  ' "$readme_path" > "$temp_body"

  {
    cat "$HF_README_FRONTMATTER_PATH"
    printf "\n\n"
    cat "$temp_body"
  } > "$readme_path"

  rm -f "$temp_body"
}

current="$(git branch --show-current)"
if [ "$current" != "$SOURCE_BRANCH" ]; then
  echo "Error: please checkout $SOURCE_BRANCH first"
  exit 1
fi

for remote in "${REMOTES[@]}"; do
  if ! git remote get-url "$remote" >/dev/null 2>&1; then
    echo "Error: remote not found: $remote"
    exit 1
  fi
done

stash_created=0
temp_branch_created=0

cleanup() {
  set +e

  if [ "$temp_branch_created" -eq 1 ]; then
    git checkout -f "$SOURCE_BRANCH" >/dev/null 2>&1 || echo "Warning: failed to switch back to $SOURCE_BRANCH"
    git branch -D "$TEMP_BRANCH" >/dev/null 2>&1 || echo "Warning: failed to delete temp branch $TEMP_BRANCH"
  fi

  if [ "$stash_created" -eq 1 ]; then
    echo "Restoring stashed changes..."
    git stash pop --index "stash@{0}" >/dev/null 2>&1 || echo "Warning: failed to auto-restore stash. Recover it manually with: git stash list"
  fi
}

trap cleanup EXIT

if [ -n "$(git status --porcelain)" ]; then
  if [ "$AUTO_STASH" != "1" ]; then
    echo "Error: working tree not clean, please commit or stash first"
    exit 1
  fi

  echo "Working tree is not clean. Auto-stashing changes..."
  if [ "$INCLUDE_UNTRACKED" = "1" ]; then
    git stash push --include-untracked -m "__space_sync_auto__" >/dev/null
  else
    git stash push -m "__space_sync_auto__" >/dev/null
  fi
  stash_created=1
fi

git checkout --orphan "$TEMP_BRANCH" >/dev/null
temp_branch_created=1
update_space_readme
git add -A

for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  git rm -rf --cached --ignore-unmatch -- $pattern 2>/dev/null || true
done

git commit -m "Sync from $SOURCE_BRANCH: $(git log "$SOURCE_BRANCH" -1 --format='%h %s')" >/dev/null

push_failed=0
for remote in "${REMOTES[@]}"; do
  echo "Pushing to $remote..."
  if git push "$remote" "$TEMP_BRANCH:main" --force; then
    echo "  ✓ $remote pushed"
  else
    echo "  ✗ $remote push failed"
    push_failed=1
  fi
done

if [ "$push_failed" -ne 0 ]; then
  echo "Error: one or more remotes failed"
  exit 1
fi

echo "Done!"
