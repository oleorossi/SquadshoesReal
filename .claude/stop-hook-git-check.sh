#!/bin/bash
# stop-hook-git-check.sh
# Runs at the end of every Claude Code turn.
# 1. Ensures all changes are committed and pushed to the feature branch.
# 2. Merges the feature branch into the deploy branch (main/master) so that
#    Lovable always sees the latest Claude Code work.

input=$(cat)

# Recursion guard
stop_hook_active=$(echo "$input" | jq -r '.stop_hook_active')
if [[ "$stop_hook_active" = "true" ]]; then
  exit 0
fi

# Not in a git repo
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# No remote
if [[ -z "$(git remote)" ]]; then
  exit 0
fi

# ── 1. Uncommitted / untracked check ─────────────────────────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "There are uncommitted changes in the repository. Please commit and push these changes to the remote branch." >&2
  exit 2
fi

untracked_files=$(git ls-files --others --exclude-standard)
if [[ -n "$untracked_files" ]]; then
  echo "There are untracked files in the repository. Please commit and push these changes to the remote branch." >&2
  exit 2
fi

# ── 2. Unpushed commits on feature branch ────────────────────────────────────
current_branch=$(git branch --show-current)
if [[ -n "$current_branch" ]]; then
  if git rev-parse "origin/$current_branch" >/dev/null 2>&1; then
    unpushed=$(git rev-list "origin/$current_branch..HEAD" --count 2>/dev/null) || unpushed=0
    if [[ "$unpushed" -gt 0 ]]; then
      echo "There are $unpushed unpushed commit(s) on branch '$current_branch'. Please push these changes to the remote repository." >&2
      exit 2
    fi
  else
    unpushed=$(git rev-list "origin/HEAD..HEAD" --count 2>/dev/null) || unpushed=0
    if [[ "$unpushed" -gt 0 ]]; then
      echo "Branch '$current_branch' has $unpushed unpushed commit(s) and no remote branch. Please push these changes to the remote repository." >&2
      exit 2
    fi
  fi
fi

# ── 3. Auto-merge feature branch → deploy branch ─────────────────────────────
DEPLOY_BRANCH=""
for candidate in main master; do
  if git rev-parse "origin/$candidate" >/dev/null 2>&1; then
    DEPLOY_BRANCH="$candidate"
    break
  fi
done

if [[ -z "$DEPLOY_BRANCH" || "$current_branch" == "$DEPLOY_BRANCH" || -z "$current_branch" ]]; then
  exit 0
fi

# How many of our commits are not yet in the deploy branch?
git fetch origin "$DEPLOY_BRANCH" --quiet 2>/dev/null
ahead=$(git rev-list "origin/${DEPLOY_BRANCH}..HEAD" --count 2>/dev/null) || ahead=0

if [[ "$ahead" -eq 0 ]]; then
  exit 0  # Nothing to merge
fi

echo "[auto-merge] '$current_branch' is $ahead commit(s) ahead of '$DEPLOY_BRANCH'. Merging..." >&2

# Switch to deploy branch and attempt merge
if ! git checkout "$DEPLOY_BRANCH" --quiet 2>/dev/null; then
  echo "[auto-merge] ⚠️  Could not switch to '$DEPLOY_BRANCH'. Merge skipped." >&2
  exit 0
fi

# Pull latest deploy branch (Lovable may have pushed while we worked)
git pull origin "$DEPLOY_BRANCH" --quiet 2>/dev/null

# Try fast-forward first (clean case — no Lovable changes during our session)
if git merge --ff-only "origin/$current_branch" --quiet 2>/dev/null; then
  merge_ok=true
else
  # Deploy branch diverged — do a real merge, preferring Claude's work on conflicts
  # since we are pushing completed session work into production.
  # Note: -X theirs refers to the branch being merged IN (Claude's work).
  if git merge "origin/$current_branch" --no-edit -X theirs --quiet 2>/dev/null; then
    merge_ok=true
  else
    git merge --abort 2>/dev/null
    merge_ok=false
  fi
fi

if $merge_ok; then
  if git push origin "$DEPLOY_BRANCH" --quiet 2>/dev/null; then
    echo "[auto-merge] ✅ Merged '$current_branch' → '$DEPLOY_BRANCH' and pushed. Deployment will update." >&2
  else
    echo "[auto-merge] ✅ Merged locally but push failed (retry: git push origin $DEPLOY_BRANCH)." >&2
  fi
else
  echo "[auto-merge] ⚠️  Merge conflict between '$current_branch' and '$DEPLOY_BRANCH'." >&2
  echo "[auto-merge]    Run manually: git checkout $DEPLOY_BRANCH && git merge $current_branch && git push origin $DEPLOY_BRANCH" >&2
fi

# Return to feature branch
git checkout "$current_branch" --quiet 2>/dev/null

exit 0
