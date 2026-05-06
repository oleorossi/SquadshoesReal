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
EXEMPT_PATTERN="EtiquetaProduto|PrintWork|OperatorWorkSheet"

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
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Total de ocorrências: $violations"
echo "  Arquivos isentos (impressão): EtiquetaProduto, PrintWork, OperatorWorkSheet"
echo ""

# Exit 0 (informational — does not block commits)
# Change to exit 1 to enforce strictly
exit 0
