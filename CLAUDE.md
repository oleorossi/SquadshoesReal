# Squad Shoes — Claude Code Guide

## Deployment Architecture

- **Deploy branch**: `main` — Lovable monitors and deploys automatically on push.
- **Claude Code branch**: `claude/verify-pricing-formulas-H0qWZ` (or any `claude/*` branch).
- **Lovable branch**: also `main` — Lovable commits directly to `main` via its web interface.

## Automatic Sync (bidirectional)

Both hooks use **rebase** instead of merge to keep a clean linear history and avoid silent data loss.

| Hook | Script | When | What it does |
|------|--------|------|--------------|
| `SessionStart` | `~/.claude/session-start-sync.sh` | Start of session | Fetches `main`, **rebases** current branch on top (Claude's commits go on top of Lovable's latest). Falls back to merge `-X theirs` if rebase has conflicts. |
| `Stop` | `~/.claude/stop-hook-git-check.sh` | End of turn | Rebases feature branch on latest `main`, force-pushes feature branch, then fast-forwards `main` to match. Falls back to merge if needed. |

## Conflict Resolution Strategy

| Direction | Strategy | Rationale |
|-----------|----------|-----------|
| Lovable → Claude (session start) | `git rebase origin/main` | Lovable's commits land first, Claude's commits replay on top — linear history, no silent overwrite. |
| Claude → main (session end) | rebase + `--ff-only` on main | Claude's rebased branch fast-forwards main cleanly. No conflict possible after successful rebase. |
| Fallback (real conflict) | merge `-X ours` while on feature branch | "ours" = feature branch = Claude's work. Correct direction. |

**WARNING:** Never use `git checkout main && git merge claude-branch -X ours` — at that point "ours" = main = Lovable's code, so Claude's work is silently discarded.

## Developer Rules

1. **Always commit before stopping** — the stop hook will block if uncommitted changes exist.
2. **Never force-push main** — Lovable depends on a clean main history.
3. **Migrations go in `supabase/migrations/`** — apply them via the Supabase dashboard SQL editor (network access from this environment blocks direct psql).
4. **TypeScript must stay clean** — run `npx tsc --noEmit` before committing.
5. **After any Lovable edit** — run `npm run check:tokens` to detect hardcoded colors that should be design tokens.

## Design Token System — DO NOT use hardcoded colors

This project uses **CSS custom property tokens** defined in `src/index.css`. Using
hardcoded Tailwind color classes (e.g. `bg-white`, `text-gray-400`) breaks the
unified visual system and makes dark mode impossible.

### Mapping: old → correct

| ❌ Hardcoded (Lovable default) | ✅ Design token |
|-------------------------------|-----------------|
| `bg-white` | `bg-card` (surfaces) or `bg-background` (page) |
| `bg-gray-50`, `bg-slate-50` | `bg-muted/30` or `bg-muted/50` |
| `bg-gray-100`, `bg-slate-100` | `bg-muted` |
| `border-gray-100`, `border-slate-200` | `border-border` or `border-border/60` |
| `text-gray-400`, `text-slate-400` | `text-muted-foreground` |
| `text-gray-600`, `text-slate-600` | `text-muted-foreground` |
| `text-gray-900`, `#0D0D0D` | `text-foreground` |
| `hover:bg-gray-50` | `hover:bg-muted/40` |
| `bg-green-500/10 text-green-600` | ✅ Keep — semantic status color |
| `bg-amber-500/10 text-amber-600` | ✅ Keep — semantic status color |
| `bg-red-500/10 text-red-600` | ✅ Keep — semantic status color |

### Exempt files (print layouts — must use print colors)
- `EtiquetaProduto.tsx`
- `PrintWorkSheetsPage.tsx`
- `OperatorWorkSheet.tsx`

### Check for violations
```bash
npm run check:tokens
```

### Root causes of past dual-visual-system bug
1. **CSS scope contamination** — class definitions (`.glass-sidebar`, `@keyframes`) were
   nested inside `:root {}`. Everything after them lost CSS variable scope. Fixed in
   commit `d090211`. **Rule**: `:root {}` must contain ONLY `--variable: value` declarations.
2. **Lovable generates hardcoded colors** — Lovable's AI doesn't know about custom tokens,
   so it defaults to standard Tailwind classes. Always run `check:tokens` after Lovable edits.
3. **Git hooks had wrong merge direction** — `git checkout main && git merge branch -X ours`
   was keeping main's version (Lovable), not Claude's. Fixed: hooks now use rebase-based
   strategy so Claude's work is never silently discarded.

## Pending DB Migrations (apply in Supabase Dashboard)

SQL Editor: https://supabase.com/dashboard/project/qrdvwoijghmgugejponz/sql/new

Apply **in order** (oldest first). Migrations with GUIDs in the name are applied automatically by Lovable — only the ones listed below need manual application.

### Grupo 1 — Correções anteriores (verificar se já aplicadas)
- `20260419120147_fix-sole-double-debit-and-grade-restore.sql` — corrige duplo débito de solado em OPs com grade
- `20260419130000_fix-production-wave-engine.sql` — motor de ondas de produção
- `20260419140000_perf-restore-product-stocks.sql` — performance de restauração de estoque
- `20260420100000_erp-improvements.sql` — melhorias gerais do ERP
- `20260420110000_supplier-price-history.sql` — histórico de preços de fornecedores

### Grupo 2 — Pendentes confirmadas (listadas na versão anterior do CLAUDE.md)
- `20260421090000_fix-strap-color-fallback.sql` — remove fallback silencioso de cor errada nas tiras
- `20260421100000_add-minimum-overtime-to-work-schedules.sql` — mínimo de horas extras em escalas
- `20260421120000_artisanal-recipes.sql` — receitas artesanais
- `20260424120000_consumption-per-size-single-source.sql` — consumo por numeração como fonte única (versão anterior, substituída pelo grupo 3)
- `20260424140000_fix-production-sector-flow.sql` — corrige fluxo de setores de produção
- `20260424180000_fix-packaging-debit-stock-movements.sql` — registra stock_movements no débito de embalagem
- `20260425155923_fa87b65c-113c-42ed-bb26-a8eb7d4be2b6.sql` — adiciona `adjust_stock()` RPC com controle de concorrência (obrigatório para StockAdjustmentPage)

### Grupo 3 — Novas desta sessão (obrigatórias)
- `20260426120000_consumption-per-size-as-primary-source.sql` — **CRÍTICA**: atualiza `calculate_order_consumption()` e `calculate_order_consumption_by_grade()` para usar `technical_sheets.*_consumption_per_size` como fonte primária (dados da ficha técnica prevalecem sobre sole_technical_specs)
- `20260426130000_sole-size-conjugations.sql` — **NOVA**: cria tabela `sole_size_conjugations`, função `get_sole_size_key()` e atualiza `debit_sole_stock_by_grade()` com suporte a numerações conjugadas (23/24 etc.)
- `20260426140000_fix-conjugation-debit-legacy-fallback.sql` — **CRÍTICA**: corrige bug no débito conjugado — usa key conjugado apenas se ele existir no stock_grade, senão usa keys individuais (compatibilidade com dados existentes)
