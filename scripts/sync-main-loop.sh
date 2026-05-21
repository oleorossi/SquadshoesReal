#!/bin/bash
# =============================================================================
# Auto-sync main → local working tree
# =============================================================================
# Faz `git fetch + pull --ff-only` periodicamente quando NENHUMA mudança
# local pendente existe. Mudanças no remoto (push de outra sessão, GitHub
# web, outro dispositivo) refletem no dev server em até INTERVAL segundos.
# Vite HMR detecta as mudanças no filesystem e atualiza o browser sozinho.
#
# Uso:
#   bash scripts/sync-main-loop.sh           # loop interativo (Ctrl+C pra parar)
#   bash scripts/sync-main-loop.sh --once    # 1 ciclo só (pra cron/hook)
#
# Variáveis (opcionais):
#   SYNC_INTERVAL  intervalo em segundos entre fetches (default 30)
#   SYNC_VERBOSE   1 = log de cada ciclo (default 0, só loga mudanças)
#
# Comportamento:
#   - Working tree NÃO-clean (uncommitted) → skip + warning
#   - Branch atual != main → skip + warning
#   - Fast-forward limpo → pull silencioso + log "pulled N commits"
#   - Conflito de fast-forward → skip + warning (rebase manual necessário)
# =============================================================================

set -uo pipefail

cd "$(dirname "$0")/.."

INTERVAL="${SYNC_INTERVAL:-30}"
VERBOSE="${SYNC_VERBOSE:-0}"
ONCE="${1:-loop}"

log() {
  local ts; ts=$(date '+%H:%M:%S')
  echo "[$ts sync-main] $*"
}

run_once() {
  # 1. Branch atual deve ser main
  local branch; branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
  if [[ "$branch" != "main" ]]; then
    [[ "$VERBOSE" = "1" ]] && log "skip — branch=$branch (não-main)"
    return
  fi

  # 2. Working tree precisa estar clean
  if ! git diff --quiet --ignore-submodules HEAD 2>/dev/null; then
    [[ "$VERBOSE" = "1" ]] && log "skip — uncommitted changes"
    return
  fi
  if ! git diff --quiet --cached --ignore-submodules 2>/dev/null; then
    [[ "$VERBOSE" = "1" ]] && log "skip — staged changes"
    return
  fi

  # 3. Fetch + compara
  if ! git fetch origin main --quiet 2>/dev/null; then
    [[ "$VERBOSE" = "1" ]] && log "fetch falhou"
    return
  fi

  local local_sha; local_sha=$(git rev-parse HEAD)
  local remote_sha; remote_sha=$(git rev-parse origin/main)

  if [[ "$local_sha" = "$remote_sha" ]]; then
    [[ "$VERBOSE" = "1" ]] && log "up-to-date"
    return
  fi

  # 4. Conta commits ahead/behind
  local behind; behind=$(git rev-list --count "$local_sha..$remote_sha" 2>/dev/null || echo 0)
  local ahead; ahead=$(git rev-list --count "$remote_sha..$local_sha" 2>/dev/null || echo 0)

  if [[ "$ahead" -gt 0 ]]; then
    log "skip — local ahead de origin (rebase/push manual necessário)"
    return
  fi

  # 5. Pull fast-forward
  if git pull --ff-only origin main --quiet 2>/dev/null; then
    log "✓ pulled $behind commit(s) from origin/main"
    # Lista os commits que vieram, pra contexto
    git log --oneline "$local_sha..$remote_sha" 2>/dev/null | head -10 | sed 's/^/         /'
  else
    log "✗ pull falhou (provavelmente conflito) — resolver manual"
  fi
}

if [[ "$ONCE" = "--once" ]]; then
  run_once
  exit 0
fi

log "iniciado — interval=${INTERVAL}s, verbose=${VERBOSE}. Ctrl+C pra parar."
while true; do
  run_once
  sleep "$INTERVAL"
done
