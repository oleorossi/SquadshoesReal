#!/usr/bin/env bash
# =============================================================================
# Setup CI/CD — auto-deploy do Squad Shoes pra GitHub, Vercel e Supabase
# =============================================================================
# Verifica e guia a configuração do pipeline:
#   • GitHub: hook do Claude já push automático no fim do turno
#   • CI: valida todo push em main.
#   • Supabase: GitHub Action aplica migrations somente depois do CI verde.
#   • Vercel/Edge: aguardam todas as migrations do mesmo SHA antes do deploy.
#
# Uso:
#   bash scripts/setup-cicd.sh           — relatório de status
#   bash scripts/setup-cicd.sh --check   — só checagens, sem prompts
# =============================================================================

set -uo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

SUPABASE_PROJECT_ID="ssvxfoybzmjlypnipqzn"
PRODUCTION_URL="https://squadshoes-real.vercel.app"

REPO_URL=$(git config --get remote.origin.url 2>/dev/null | sed 's/\.git$//')
REPO_OWNER_NAME=$(echo "$REPO_URL" | sed 's|^.*github.com[:/]||')

echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Squad Shoes — Status do pipeline CI/CD${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo ""
echo -e "Repositório: ${BLUE}${REPO_URL}${NC}"
echo -e "Vercel:      ${BLUE}${PRODUCTION_URL}${NC}"
echo -e "Supabase:    ${BLUE}https://supabase.com/dashboard/project/${SUPABASE_PROJECT_ID}${NC}"
echo ""

# ─── 1. GitHub: stop hook ────────────────────────────────────────────────────
echo -e "${BOLD}1) GitHub — auto-push${NC}"
HOOK_PATH="${HOME}/.claude/stop-hook-git-check.sh"
if [[ -x "$HOOK_PATH" ]]; then
  echo -e "   ${GREEN}✓${NC} Stop hook encontrado e executável: $HOOK_PATH"
  echo -e "   Comportamento: ao fim de cada turno do Claude, força commit + push"
  echo -e "                  da branch atual e fast-forward de main."
else
  echo -e "   ${RED}✗${NC} Stop hook não encontrado em $HOOK_PATH"
  echo -e "   Configure em ~/.claude/settings.json"
fi
echo ""

# ─── 2. Vercel ───────────────────────────────────────────────────────────────
echo -e "${BOLD}2) Vercel — auto-deploy${NC}"
VERCEL_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$PRODUCTION_URL" 2>/dev/null || echo "000")
if [[ "$VERCEL_RESPONSE" =~ ^(200|301|302)$ ]]; then
  echo -e "   ${GREEN}✓${NC} Site live respondendo HTTP $VERCEL_RESPONSE"
  echo -e "   Produção é publicada pelo workflow após CI e banco do mesmo SHA."
else
  echo -e "   ${YELLOW}⚠${NC} Site retornou HTTP $VERCEL_RESPONSE"
  echo -e "   Verifique no dashboard: https://vercel.com/dashboard"
fi
echo ""

# ─── 3. GitHub Actions: workflow do Supabase ─────────────────────────────────
echo -e "${BOLD}3) Supabase — auto-migration via GitHub Actions${NC}"
WORKFLOW_PATH=".github/workflows/supabase-migrate.yml"
if [[ -f "$WORKFLOW_PATH" ]]; then
  echo -e "   ${GREEN}✓${NC} Workflow encontrado: $WORKFLOW_PATH"
else
  echo -e "   ${RED}✗${NC} Workflow ausente — esperado em $WORKFLOW_PATH"
fi
echo ""

# ─── 4. Secrets do Supabase ──────────────────────────────────────────────────
echo -e "${BOLD}4) Secrets do GitHub${NC}"
echo -e "   O workflow precisa de 3 secrets configurados em Actions Secrets."
echo -e "   ${YELLOW}Não consigo verificar daqui sem o gh CLI instalado e autenticado.${NC}"
echo ""
echo -e "   ${BOLD}Como configurar:${NC}"
echo ""
echo -e "   ${BLUE}a) SUPABASE_PROJECT_ID${NC}"
echo -e "      Valor: ${BOLD}${SUPABASE_PROJECT_ID}${NC}"
echo ""
echo -e "   ${BLUE}b) SUPABASE_ACCESS_TOKEN${NC}"
echo -e "      1. Acesse: ${BLUE}https://supabase.com/dashboard/account/tokens${NC}"
echo -e "      2. Clique em ${BOLD}Generate new token${NC}"
echo -e "      3. Nome sugerido: ${BOLD}\"github-actions-squadshoes\"${NC}"
echo -e "      4. Copie o token (começa com ${BOLD}sbp_${NC})"
echo ""
echo -e "   ${BLUE}c) SUPABASE_DB_PASSWORD${NC}"
echo -e "      1. Acesse: ${BLUE}https://supabase.com/dashboard/project/${SUPABASE_PROJECT_ID}/settings/database${NC}"
echo -e "      2. Procure ${BOLD}Database Password${NC} → ${BOLD}Reset database password${NC}"
echo -e "      3. ${YELLOW}Gere uma nova${NC} (não tente recuperar a antiga — não é exibida)"
echo -e "      4. Copie a senha gerada"
echo ""
echo -e "   ${BLUE}Cadastrar os 3 secrets:${NC}"
echo -e "      ${BLUE}https://github.com/${REPO_OWNER_NAME}/settings/secrets/actions${NC}"
echo -e "      Clique em ${BOLD}New repository secret${NC} e cadastre cada um."
echo ""

# ─── 5. Primeira execução (dry-run) ──────────────────────────────────────────
echo -e "${BOLD}5) Primeira execução do workflow${NC}"
echo -e "   Após cadastrar os 3 secrets, dispare manualmente em modo dry-run:"
echo -e "      ${BLUE}https://github.com/${REPO_OWNER_NAME}/actions/workflows/supabase-migrate.yml${NC}"
echo -e "   Clique em ${BOLD}Run workflow${NC} → mantém ${BOLD}dry_run: true${NC} → ${BOLD}Run workflow${NC}"
echo ""
echo -e "   Se o workflow listar migrations já aplicadas via SQL Editor/MCP"
echo -e "   (caso comum no histórico), execute primeiro:"
echo -e "      ${BOLD}bash scripts/repair-applied-migrations.sh${NC}"
echo ""

# ─── 6. Fluxo completo ───────────────────────────────────────────────────────
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Fluxo de auto-deploy esperado${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Sua mudança${NC}"
echo -e "       ↓"
echo -e "  ${BOLD}git commit + push${NC}  ────►  ${GREEN}feature branch${NC}"
echo -e "       ↓ (stop hook auto-merge)"
echo -e "  ${GREEN}main${NC}  ────────────►  ${GREEN}CI integral${NC}"
echo -e "       ↓ (somente se verde; mesmo SHA)"
echo -e "  ${GREEN}Supabase migrations${NC}  ──►  ${GREEN}DB live${NC}"
echo -e "       ↓ (frontend e Edge aguardam o banco)"
echo -e "  ${GREEN}Vercel + Edge Functions${NC}  ──►  ${GREEN}produção live${NC}"
echo ""
echo -e "${YELLOW}Importante:${NC} migrations aplicadas via Supabase MCP (durante este"
echo -e "chat) NÃO ficam registradas em supabase_migrations.schema_migrations."
echo -e "Quando o workflow rodar pela primeira vez, ele vai tentar re-aplicá-las."
echo -e "Migrations idempotentes (CREATE IF NOT EXISTS, etc.) re-rodam OK; mas"
echo -e "as não-idempotentes precisam de ${BOLD}supabase migration repair${NC} antes."
echo -e "Use ${BOLD}scripts/repair-applied-migrations.sh${NC} pra registrar como aplicadas."
echo ""
