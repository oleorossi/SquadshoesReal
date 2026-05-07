#!/usr/bin/env bash
# =============================================================================
# Helper: marca migrations como APLICADAS no Supabase remoto sem re-rodar.
# =============================================================================
# Uso depois que algumas migrations já foram aplicadas manualmente no SQL Editor
# (ou aplicadas em outro lugar) e o GitHub Action começou a tentar rodá-las de
# novo. O script marca elas como "applied" na tabela supabase_migrations.schema_migrations
# sem executar o SQL — essencial pra não causar duplicações ou erros.
#
# Pré-requisitos:
#   - supabase CLI instalado: brew install supabase/tap/supabase
#   - SUPABASE_ACCESS_TOKEN exportado (token de https://supabase.com/dashboard/account/tokens)
#   - SUPABASE_DB_PASSWORD exportado (senha do banco)
#
# Uso:
#   export SUPABASE_ACCESS_TOKEN=sbp_xxx
#   export SUPABASE_DB_PASSWORD=xxx
#   ./scripts/repair-applied-migrations.sh
# =============================================================================
set -euo pipefail

PROJECT_ID="${SUPABASE_PROJECT_ID:-ssvxfoybzmjlypnipqzn}"

# Lista de migrations que JÁ foram aplicadas manualmente.
# Edite esta lista conforme o histórico real do banco.
# Formato: timestamp da migration (YYYYMMDDHHMMSS, sem o resto do nome).
ALREADY_APPLIED=(
  # ✅ Aplicadas via MCP em 2026-05-08 (auditoria + Frentes 1-2-4):
  20260524120000  # audit-fix-conversion-and-parallelism
  20260524130000  # refine-list-materials-missing-width
  20260524140000  # strap-debit-preventive-hardening
  20260524150000  # audit-round-2-fixes
  20260525120000  # add-costura-to-default-lead-times
  20260525130000  # timesheet-import-files-archive
  20260525140000  # sheet-materials-variant-id
  # Adicione aqui timestamps de outras migrations já rodadas manualmente
  # via SQL Editor ou MCP que precisam ser marcadas como applied:
)

if [ ${#ALREADY_APPLIED[@]} -eq 0 ]; then
  echo "⚠️  Nenhum timestamp listado em ALREADY_APPLIED. Edite o script primeiro."
  echo ""
  echo "Pra ver quais migrations o supabase considera aplicadas no remoto:"
  echo "  supabase migration list --linked"
  exit 0
fi

echo "🔗 Linkando projeto $PROJECT_ID..."
supabase link --project-ref "$PROJECT_ID"

echo ""
echo "📋 Marcando ${#ALREADY_APPLIED[@]} migrations como aplicadas..."
for ts in "${ALREADY_APPLIED[@]}"; do
  echo "  ↪ $ts"
  supabase migration repair --status applied "$ts" || {
    echo "  ⚠️  Falha em $ts (talvez já marcada). Continuando..."
  }
done

echo ""
echo "✅ Concluído. Status final:"
supabase migration list --linked
