#!/usr/bin/env bash
# =============================================================================
# Runner para os testes de integração SQL da RPC calculate_order_consumption.
# Usa o psql + variáveis PG* já presentes no ambiente Lovable / CI.
# Cada arquivo .sql roda em sua própria transação com ROLLBACK no final.
# =============================================================================
set -euo pipefail

TESTS_DIR="${TESTS_DIR:-tests/sql/integration}"

if [[ -z "${PGHOST:-}" ]]; then
  echo "⚠️  PGHOST não definido — pulando testes SQL de integração."
  echo "    Estes testes requerem acesso direto ao banco Supabase."
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ psql não está instalado." >&2
  exit 1
fi

shopt -s nullglob
files=("$TESTS_DIR"/*.sql)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "Nenhum teste SQL encontrado em $TESTS_DIR"
  exit 0
fi

failed=0
for f in "${files[@]}"; do
  echo "▶ $(basename "$f")"
  if psql -v ON_ERROR_STOP=1 -X -q -f "$f"; then
    echo "  ✅ passou"
  else
    echo "  ❌ falhou"
    failed=$((failed + 1))
  fi
done

if [[ $failed -gt 0 ]]; then
  echo "❌ $failed arquivo(s) falharam." >&2
  exit 1
fi

echo "✅ Todos os testes SQL de integração passaram."