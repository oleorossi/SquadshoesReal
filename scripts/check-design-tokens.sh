#!/bin/bash
# check-design-tokens.sh
# Detects hardcoded Tailwind color classes in components that should use
# design tokens instead. Run with: npm run check:tokens
#
# EXIT CODE:
#   0 — no violations (or only known/exempt files)
#   1 — new violations found (blocks CI or pre-commit)
#
# EXEMPT FILES (intentional hardcoded colors — print layouts, labels):
# Cores são hardcoded porque impressão A4 precisa de tons garantidos, não
# tokens que mudam com tema/dark mode. components/production/worksheet/* são
# blocos reusados entre os *WorkSheet.tsx — mesma regra de print aplica.
EXEMPT_PATTERN="EtiquetaProduto|PrintWork|OperatorWorkSheet|PalmilhaWorkSheet|SilkMontageWorkSheet|SolagemWorkSheet|ExpedicaoWorkSheet|ManagementReport|EspelhoPontoPage|production/worksheet/|RelDiarioA4|RelOpA4|RelOeeA4|RelQualidadeA4|RelRefugoA4|RelSemanalA4|reports/A4Layout|LabelManualTab|LabelCalibrationTab|label-system/|ExternalBoxLabel|PickingListPage|CartaoOP|nfe/DanfeView|components/VersionChecker|ui/toast"
# Isenções extras (auditoria 2026-07-11):
#   nfe/DanfeView          — DANFE é documento fiscal em papel (mesma regra de print)
#   components/VersionChecker — banner de update em âmbar fixo de alto contraste,
#                            funciona nos dois temas (escolha deliberada)
#   ui/toast               — text-red-50/300 é texto sobre fundo destructive colorido

# Patterns that indicate old visual system usage
# Using word-boundary anchors (\b) with -E to avoid matching substrings,
# and LC_ALL=C to prevent multi-byte UTF-8 characters from causing false positives.
FORBIDDEN_PATTERNS=(
  "\\bbg-white[^/-]|\\bbg-white$"   # bg-white → bg-card or bg-background (not bg-white/opacity)
  "\\bbg-gray-[0-9]"                 # bg-gray-* → bg-muted or bg-muted/50
  "\\bbg-slate-[0-9]"                # bg-slate-* → bg-muted or bg-card
  "\\bborder-gray-[0-9]"             # border-gray-* → border-border
  "\\bborder-slate-[0-9]"            # border-slate-* → border-border
  "\\btext-gray-[0-9]"               # text-gray-* → text-muted-foreground or text-foreground
  "\\btext-slate-[0-9]"              # text-slate-* → text-muted-foreground or text-foreground
)

# Status colors em tom claro/escuro fixo (50/100/200/800/900) SEM variante dark: na
# mesma linha — quebram dark mode. Padrão canônico: bg-*-500/10 text-*-600
# (auditoria 2026-07-11; tons 300-700 e linhas com dark: são aceitos).
STATUS_COLORS="red|green|blue|amber|yellow|orange|purple|violet|emerald|teal|cyan|sky|indigo|rose|pink|lime|fuchsia"
STATUS_PATTERN="\\b(bg|text|border)-(${STATUS_COLORS})-(50|100|200|800|900)\\b"

# Neutros fora do token system (zinc/neutral/stone) — usar bg-muted/text-muted-foreground/border-border
NEUTRAL_PATTERN="\\b(bg|text|border)-(zinc|neutral|stone)-[0-9]"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src"

violations=0
found_files=()

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  while IFS= read -r line; do
    file=$(echo "$line" | cut -d: -f1)
    [[ -z "$file" ]] && continue
    # Skip exempt files
    if echo "$file" | grep -qE "$EXEMPT_PATTERN"; then
      continue
    fi
    violations=$((violations + 1))
    found_files+=("$line")
  done < <(LC_ALL=C grep -rn -E --include="*.tsx" "$pattern" "$SRC/components" "$SRC/pages" 2>/dev/null)
done

# Status colors light-only (sem dark: na mesma linha)
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  [[ -z "$file" ]] && continue
  if echo "$file" | grep -qE "$EXEMPT_PATTERN"; then
    continue
  fi
  violations=$((violations + 1))
  found_files+=("$line")
done < <(LC_ALL=C grep -rn -E --include="*.tsx" "$STATUS_PATTERN" "$SRC/components" "$SRC/pages" 2>/dev/null | grep -v "dark:")

# Neutros zinc/neutral/stone
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  [[ -z "$file" ]] && continue
  if echo "$file" | grep -qE "$EXEMPT_PATTERN"; then
    continue
  fi
  violations=$((violations + 1))
  found_files+=("$line")
done < <(LC_ALL=C grep -rn -E --include="*.tsx" "$NEUTRAL_PATTERN" "$SRC/components" "$SRC/pages" 2>/dev/null)

# Deduplicate output
if [[ ${#found_files[@]} -eq 0 ]]; then
  echo "✅ Nenhuma violação de design tokens encontrada."
  exit 0
fi

echo ""
echo "⚠️  Cores hardcoded encontradas (use design tokens em vez disso):"
echo ""

printf '%s\n' "${found_files[@]}" | sort -u | sed "s|$ROOT/||" | while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  printf "  %-60s  linha %s\n" "$file" "$linenum"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Guia de substituição:"
echo "  bg-white          →  bg-card  ou  bg-background"
echo "  bg-gray-*/slate-* →  bg-muted  ou  bg-muted/50"
echo "  border-gray-*     →  border-border"
echo "  border-slate-*    →  border-border"
echo "  text-gray-*       →  text-muted-foreground"
echo "  text-slate-*      →  text-muted-foreground  ou  text-foreground"
echo "  bg-<cor>-50/100   →  bg-<cor>-500/10          (status color, ok nos 2 temas)"
echo "  text-<cor>-700    →  text-<cor>-600           (sobre bg-<cor>-500/10)"
echo "  text-<cor>-800/900→  text-<cor>-700 dark:text-<cor>-400"
echo "  border-<cor>-200/300 → border-<cor>-500/20 ou /30"
echo "  zinc/neutral/stone→  bg-muted / text-muted-foreground / border-border"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Total de ocorrências: $violations"
echo "  Arquivos isentos (impressão): EtiquetaProduto, PrintWork, *WorkSheet, ManagementReport, worksheet/*, Rel*A4, reports/A4Layout"
echo ""

# Exit 0 (informational — does not block commits)
# Change to exit 1 to enforce strictly
exit 0
