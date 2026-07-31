#!/bin/bash
# check-design-tokens.sh
# Detects hardcoded Tailwind color classes in components that should use
# design tokens instead. Run with: npm run check:tokens
#
# EXIT CODE:
#   0 — nenhuma violação NOVA em relação ao baseline
#   1 — violação nova (arquivo novo, ou arquivo conhecido que piorou)
#
# ⚠ Até 29/07/2026 este script terminava em `exit 0` fixo — o comentário do
# cabeçalho prometia bloquear e o código nunca bloqueava (achado F15 da
# auditoria de IA). Agora ele cobra de verdade, contra
# `scripts/design-tokens-baseline.txt`, que congela a dívida atual por ARQUIVO.
# Regravar com: bash scripts/check-design-tokens.sh --update-baseline
# Cada correção deve DIMINUIR o baseline. Quando zerar, apague o arquivo.
#
# EXEMPT FILES (intentional hardcoded colors — print layouts, labels):
# Cores são hardcoded porque impressão A4 precisa de tons garantidos, não
# tokens que mudam com tema/dark mode. components/production/worksheet/* são
# blocos reusados entre os *WorkSheet.tsx — mesma regra de print aplica.
EXEMPT_PATTERN="EtiquetaProduto|PrintWork|OperatorWorkSheet|PalmilhaWorkSheet|SilkMontageWorkSheet|SolagemWorkSheet|ExpedicaoWorkSheet|ReducedWorkSheet|ManagementReport|EspelhoPontoPage|production/worksheet/|RelDiarioA4|RelOpA4|RelOeeA4|RelQualidadeA4|RelRefugoA4|RelSemanalA4|reports/A4Layout|LabelManualTab|LabelCalibrationTab|label-system/|ExternalBoxLabel|PickingListPage|CartaoOP|CartaoLote|nfe/DanfeView|components/VersionChecker|ui/toast"
# Isenções extras (auditoria 2026-07-11):
#   nfe/DanfeView          — DANFE é documento fiscal em papel (mesma regra de print)
#   components/VersionChecker — banner de update em âmbar fixo de alto contraste,
#                            funciona nos dois temas (escolha deliberada)
#   ui/toast               — text-red-50/300 é texto sobre fundo destructive colorido
#   ReducedWorkSheet       — ficha de operador reduzida; o próprio arquivo declara
#                            "Print component: inline styles + cores hardcoded (#000)"
#                            (faltava na lista; 28 falsos positivos, 29/07/2026)
#   CartaoLote             — cartão de lote de setor (99×~51mm, 12 por A4 paisagem);
#                            o docblock do arquivo cita docs/PRINT_SPEC.md §0.2 e
#                            declara "inline styles com cores hardcoded (#000)".
#                            Mesma regra do CartaoOP, que já estava isento (31/07/2026)

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
# 700 entrou em 29/07/2026 (F15): era o tom mais usado nas violações reais e
# passava batido — text-<cor>-700 sem par dark: some no tema escuro.
STATUS_PATTERN="\\b(bg|text|border)-(${STATUS_COLORS})-(50|100|200|700|800|900)\\b"

# Neutros fora do token system (zinc/neutral/stone) — usar bg-muted/text-muted-foreground/border-border
NEUTRAL_PATTERN="\\b(bg|text|border)-(zinc|neutral|stone)-[0-9]"

# Cor literal dentro de style={{ }} — some do radar do Tailwind e não acompanha
# o tema. Ex.: style={{ background: '#0A0A0A' }} (F15).
INLINE_COLOR_PATTERN="style=\\{\\{[^}]*(#[0-9a-fA-F]{3,8}|rgba?\\()"

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

# Cor literal em style={{ }}
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  [[ -z "$file" ]] && continue
  if echo "$file" | grep -qE "$EXEMPT_PATTERN"; then
    continue
  fi
  violations=$((violations + 1))
  found_files+=("$line")
done < <(LC_ALL=C grep -rn -E --include="*.tsx" "$INLINE_COLOR_PATTERN" "$SRC/components" "$SRC/pages" 2>/dev/null)

# ── baseline por arquivo ────────────────────────────────────────────────
# Linha shifta o tempo todo; o nome do arquivo não. O baseline guarda quantas
# ocorrências cada arquivo tem hoje — arquivo novo ou que piorou falha o build.
BASELINE="$ROOT/scripts/design-tokens-baseline.txt"

current_counts=$(printf '%s\n' "${found_files[@]}" | sort -u | sed "s|$ROOT/||" \
  | cut -d: -f1 | sort | uniq -c | awk '{print $1"\t"$2}' | sort -k2)

if [[ "$1" == "--update-baseline" ]]; then
  {
    echo "# Dívida de design tokens congelada por arquivo (contagem<TAB>arquivo)."
    echo "# Gerado por: bash scripts/check-design-tokens.sh --update-baseline"
    echo "# O build falha se um arquivo novo aparecer ou um conhecido piorar."
    echo "# Cada correção deve DIMINUIR estes números. Quando zerar, apague o arquivo."
    echo "$current_counts"
  } > "$BASELINE"
  total_files=$(echo "$current_counts" | grep -c . || true)
  echo ""
  echo "📌 Baseline de tokens regravado: $violations ocorrência(s) em $total_files arquivo(s)."
  echo "   → scripts/design-tokens-baseline.txt"
  echo ""
  exit 0
fi

new_violations=()
improved=0
while IFS=$'\t' read -r count file; do
  [[ -z "$file" ]] && continue
  # Comparação EXATA por campo, via awk — não use `grep -E "\t..."` aqui:
  #   • `\t` em ERE não é portável. O grep do macOS (BSD) casa tab; o do Ubuntu
  #     (GNU) lê como `t` literal e NUNCA casa ⇒ todo arquivo do baseline vira
  #     "ARQUIVO NOVO" e o build cai só no CI (aconteceu em 30/07/2026: 66 de 66).
  #   • o caminho ia interpolado dentro da regex, então o `.` de `.tsx` era
  #     curinga e podia casar arquivo errado.
  base=$(awk -F'\t' -v f="$file" '$2 == f { print $1; exit }' "$BASELINE" 2>/dev/null)
  if [[ -z "$base" ]]; then
    new_violations+=("  ❌ ARQUIVO NOVO com $count ocorrência(s): $file")
  elif (( count > base )); then
    new_violations+=("  ❌ PIOROU de $base para $count: $file")
  elif (( count < base )); then
    improved=$((improved + 1))
  fi
done <<< "$current_counts"

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

if [[ ${#new_violations[@]} -gt 0 ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  printf '%s\n' "${new_violations[@]}"
  echo ""
  echo "  Corrija, ou — se for intencional — rode:"
  echo "    bash scripts/check-design-tokens.sh --update-baseline"
  echo ""
  exit 1
fi

if (( improved > 0 )); then
  echo "  💡 $improved arquivo(s) melhoraram desde o baseline. Rode --update-baseline pra travar o ganho."
  echo ""
fi

echo "  ✅ Nenhuma violação NOVA (o restante é dívida conhecida no baseline)."
echo ""
exit 0
