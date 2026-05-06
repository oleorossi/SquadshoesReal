#!/bin/bash
# session-start-sync.sh
# Runs at the start of every Claude Code session.
# Pulls the latest commits from the deploy branch (main/master) into the
# current feature branch so that Lovable's recent changes are always present
# before Claude begins work.

# Not in a git repo — nothing to do
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# No remote configured — nothing to push/pull
if [[ -z "$(git remote)" ]]; then
  exit 0
fi

current_branch=$(git branch --show-current)
[[ -z "$current_branch" ]] && exit 0

# Find the active deploy branch (main preferred, then master)
DEPLOY_BRANCH=""
for candidate in main master; do
  if git rev-parse "origin/$candidate" >/dev/null 2>&1; then
    DEPLOY_BRANCH="$candidate"
    break
  fi
done

# Already on the deploy branch — no sync needed
[[ -z "$DEPLOY_BRANCH" || "$current_branch" == "$DEPLOY_BRANCH" ]] && exit 0

# Bail out if the working tree is dirty (uncommitted work from a previous run)
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[session-sync] ⚠️  Dirty working tree — skipping sync from '$DEPLOY_BRANCH'." >&2
  exit 0
fi

# Fetch latest deploy branch silently
git fetch origin "$DEPLOY_BRANCH" --quiet 2>/dev/null || {
  echo "[session-sync] ⚠️  Could not fetch '$DEPLOY_BRANCH' (network issue). Starting with current state." >&2
  exit 0
}

# Count commits in deploy branch not yet in our branch
behind=$(git rev-list "HEAD..origin/${DEPLOY_BRANCH}" --count 2>/dev/null) || behind=0

if [[ "$behind" -eq 0 ]]; then
  echo "[session-sync] ✅ Branch '$current_branch' is up-to-date with '$DEPLOY_BRANCH'." >&2
  exit 0
fi

echo "[session-sync] '$DEPLOY_BRANCH' has $behind new commit(s) (from Lovable). Merging into '$current_branch'..." >&2

# Merge deploy branch into feature branch.
# Use '-X theirs' so that Lovable's production state wins on any conflict —
# we are PULLING their work in, so their version should take priority here.
if git merge "origin/${DEPLOY_BRANCH}" --no-edit -X theirs --quiet 2>/dev/null; then
  pushed_ok=false
  git push origin "$current_branch" --quiet 2>/dev/null && pushed_ok=true

  if $pushed_ok; then
    echo "[session-sync] ✅ Synced $behind commit(s) from '$DEPLOY_BRANCH' → '$current_branch' and pushed." >&2
  else
    echo "[session-sync] ✅ Synced $behind commit(s) from '$DEPLOY_BRANCH' locally (push failed — will retry at session end)." >&2
  fi
else
  git merge --abort 2>/dev/null
  echo "[session-sync] ⚠️  Auto-merge from '$DEPLOY_BRANCH' failed. Starting session with current branch state." >&2
  echo "[session-sync]    To sync manually: git fetch origin $DEPLOY_BRANCH && git merge origin/$DEPLOY_BRANCH" >&2
fi

exit 0
