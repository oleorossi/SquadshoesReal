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

### Grupo 4 — Sessão atual (Gestão de Solados / consumo by-grade)
- `20260518120000_fix-graded-consumption-fachete-and-fallback.sql` — **CRÍTICA**: (1) adiciona componente "Fachete" em `calculate_order_consumption_by_grade` (faltava — solados fachetados em PV com grade não consumiam o forro extra); (2) marca `source='fallback_average'` e adiciona `consumption_warning` quando algum tamanho cai na média escalar da ficha (UI alerta o usuário); (3) cria helper `list_missing_sole_consumption_sizes(uuid)` para validação no editor.
- `20260518130000_extend-unit-audit-soles.sql` — Estende `audit_unit_divergences()` com checks de `fachete_lining_consumption_dm2 < 1`, valores `< 1` dentro do JSONB `*_consumption_per_size` (cobre cabedal/forro/palmilha por tamanho), e solados com `unit ≠ par`.
- `20260520110000_null-orphan-shoe-category-fks.sql` — Pré-requisito: zera 21 `shoe_category_id` que apontavam pra `silk_shoe_category` deletadas (corruption pré-existente). Sem isso, qualquer UPDATE em `technical_sheets` aborta com 23503.
- `20260520120000_aviamento-label-and-pronto-na-cor.sql` — **CRÍTICA**: (1) backfill de `technical_sheets.production_sectors` JSONB substituindo `Mesa`→`Aviamento`, `Corte`→`Corte Palmilha`, `Forração`/`Costura`→`Corte Forração`; (2) trigger BEFORE INSERT/UPDATE em `technical_sheets` que remove `Corte Palmilha` e `Corte Forração` automaticamente quando `insole_ready_made=true`.
- `20260520130000_fix-pronto-na-cor-backfill-fk-safe.sql` — Corrige falha do backfill da migration acima quando rows têm `shoe_category_id` órfão. Faz UPDATE direto em `production_sectors` (não toca `insole_ready_made`) e usa DO/EXCEPTION para pular rows com FK quebrado pré-existente. **APLICAR LOGO APÓS** a 20260520120000.
- `20260521120000_add-costura-sector.sql` — **PR 2**: novo setor "Costura" entre Corte Forração e Aviamento. Adiciona coluna `costura_capacity_per_day` em `technical_sheets` e `costura_start_date` em `production_waves`. Reaproveita enum value `costura` (era legacy de Corte Forração). Atualiza `stage_order()`, `sector_display_to_enum()`, `compute_wave_timeline()`, `update_wave_timeline()` e `v_wave_detail`. Trigger `tg_strip_cut_sectors_when_ready_made` agora também remove "Costura" quando `insole_ready_made=true`. Backfill JSONB insere "Costura" nas fichas que devem ter (FK-safe).
- `20260522120000_parallelism-prep-sectors.sql` — **PR 3**: refactor de `compute_wave_timeline` para suportar paralelismo entre Corte Palmilha ‖ Corte Forração ‖ Aviamento (apenas estes 3 são paralelos). Costura/Silk/Colagem/Montagem/Solagem/Acabamento continuam sequenciais. Lead time da onda passa a ser `MAX(prep) + soma(sequenciais)` ao invés de `soma(todos)`, refletindo a realidade da fábrica. `material_ready_date` agora usa o início mais antigo dos 3 prep para garantir matéria-prima disponível antes do primeiro setor arrancar.

**PR 4 — Per-sector grouping (apenas frontend, sem migration)**:
A ficha de operador agora agrupa por **solado + cor** em 6 setores (Silk, Montagem, Corte Forração, Costura, Aviamento, Acabamento), substituindo o agrupamento legado por Ref + Cor que só fazia sentido em alguns. O componente `SilkMontageWorkSheet.tsx` foi generalizado pra aceitar todos esses 6 setores, com tema de cor próprio por setor e checkboxes "Frente / Traseira" extras em Aviamento e Acabamento (pra equipe marcar). Silk continua mostrando a imagem da arte do silk no topo. Acabamento foi removido da rota legada por loja/cliente — agora agrupa por solado igual ao Aviamento. Apenas Expedição mantém agrupamento por loja (LOJA-A-LOJA, conforme requisito do usuário). Colagem continua por Ref + Cor.

**PR 5 — Expedição loja-a-loja (apenas frontend, sem migration)**:
Ficha nova dedicada à Expedição em `ExpedicaoWorkSheet.tsx`. Uma ficha por cliente/CNPJ (não por OP) com: header (cliente + CNPJ + cidade + total pares), seção "Embalagem" agrupada por solado mostrando pares + pares/caixa + caixas + ✓ pra conferência, e tabela "Itens · Conferência" listando cada OP em uma linha com OP/ref/cor/solado/grade/total + ✓. Sem agrupamento dos itens (conforme requisito). `pairs_per_box_individual` puxado do `product_groups` do solado de cada OP; default 12 pares/caixa quando faltar. Removido o uso de `groupOrdersByStore` em `PrintWorkSheetsPage.tsx`.

- `20260523120000_drop-unused-technical-sheets-columns.sql` — **PR 7**: DROP de 47 colunas mortas em `technical_sheets`. Auditoria via `sql-scripts/audit-technical-sheets-fill-rate.sql` mostrou 75 colunas com 0% fill rate em 22 fichas. Cruzando com código (src/ + funções SQL atuais), separamos: colunas usadas pela fórmula (capacidades por setor, fachete, consumption_per_size, insole_ready_made, etc.) → MANTER (estão vazias só porque ninguém configurou); puros stubs do form (`useTechnicalSheets.ts`) sem display nem lógica → DROP. Removidos: stubs de marketing/etiqueta (acceptance_criteria, care_instructions, certifications, country_origin, keywords, label_info, legal_composition, storage_instructions), versionamento manual (approvals, change_log, data_ultima_revisao, responsavel_revisao, responsible_person, qtd_prevista), specs técnicos manuais (heel_base/material/type, insole_thickness, lining_weight, upper_finish, stitch_spec, material_solado_tipo, sole_code, last_*), cola (cola_cure_time, cola_type), embalagem manual (packaging_box_dimensions, packaging_notes, packaging_tissue, palletization), capacidades legacy (daily_capacity_pairs, palmilha_daily_capacity, handling_time_minutes), QC (quality_tests, sampling_plan, tolerances, machine_settings, measurements), e específicos (acabamento_tiras, obs_harmonizacao, assembly_instructions, commercial_description). View `purchase_projection_timeline` recriada usando `mesa_daily_capacity` (substituto correto pra `lead_time_mesa_dias`, era handling_time_minutes legacy). Frontend atualizado: `useTechnicalSheets.ts` (interface + initial state), `TechnicalSheets.tsx` (4 inputs removidos), `VersionsTab.tsx` (ApprovalsEditor + ChangeLogEditor + responsible_person input removidos), `OperationsTab.tsx` (write de daily_capacity_pairs removido).

**PR 8 — Polimento A4 da impressão (apenas frontend, sem migration)**:
Refinamento dos print styles em `PrintWorkSheetsPage.tsx`: adiciona `break-inside: avoid` nos cards de cor/grupo (via classe `keep-together`), `print-color-adjust: exact` pra cores fiéis na impressão (sem desbotamento), `display: table-header-group/footer-group` pra cabeçalhos/rodapés repetirem em tabelas multipágina, e `font-size: 10pt` base. Cards `keep-together` adicionados em SilkMontageWorkSheet (cada cor), PalmilhaWorkSheet (cada solado), SolagemWorkSheet (cada banda de cor), ExpedicaoWorkSheet (resumo de embalagem).

**PR 6 — Relatório gerencial (apenas frontend, sem migration)**:
Componente novo `ManagementReport.tsx` — uma ficha A4 gerencial por PV (sale order) com info COMPLETA pra acompanhamento gestor. Diferente das fichas de operador (minimalistas pra execução), aqui o foco é "olho de gestor" sobre o pedido. Seções: header (PV + cliente + CNPJ + cidade + deadline + status), KPIs (OPs/pares/receita/margem), tabela de OPs com matriz de status por setor (✓/●/○ pra cada estágio do fluxo), tabela de custos (material/MO/overhead/total/receita/margem por OP + total agregado). `PrintWorkSheetsPage.tsx` ganha opção 'Relatório Gerencial' no dropdown; novos queries `order_costs` e `order_stages` carregam só nesse modo. Custos puxados de `order_costs` (resultado de `calculate_order_cost`); status por setor de `order_stages`. Quando custos não foram calculados, mostra alerta âmbar pedindo pra rodar "Calcular Custos" no PV. Footer com 3 assinaturas: PCP / Comercial / Financeiro.

- `20260524120000_audit-fix-conversion-and-parallelism.sql` — **Auditoria fix**: dos 35 achados de auditoria nas 4 áreas (estoque/unidades/ondas/compras), 33 foram falsos positivos. 2 bugs reais: (1) Frontend `sectorCapacity.ts` calculava cascata sequencial mas `compute_wave_timeline` (PR 3) é paralelo — datas divergiam entre UI e relatório do server. **Corrigido** em `sectorCapacity.ts` + `leadTime.ts` (refletindo paralelismo Corte P‖Corte F‖Mesa + Costura sequencial). (2) `get_material_conversion_info` retornava `dm2_per_unit=1` em silêncio quando produto linear (m/cm) não tem `dimensions_width` em `component_sheets` → UI mostrava valor "metros" que era dm² (~100× errado). **Corrigido**: função agora retorna campo extra `conversion_warning` (text nullable) descrevendo o problema, e nova função `list_materials_missing_width()` lista materiais afetados. Compatível com callers existentes (todos usam `SELECT * INTO v_conv` RECORD).
- `20260524130000_refine-list-materials-missing-width.sql` — Refina `list_materials_missing_width()` filtrando falsos positivos. V1 listava todos os produtos lineares sem largura (50 entradas, ~47 eram tiras/elásticos que usam fluxo `debit_strap_stock` em cm/par e NÃO passam por `get_material_conversion_info`). V2 filtra: exclui produtos cujo nome OU grupo casa com /tira|elastic|strass|tranç/, e mantém só os que SÃO referenciados em alguma `sheet_materials` ou em `upper/lining/insole_material` de uma ficha técnica. Adiciona coluna `used_in_sheets` mostrando quantas fichas usam o material — facilita priorizar correção.
- `20260524140000_strap-debit-preventive-hardening.sql` — Hardening DEFENSIVO em `debit_strap_stock` (auditoria mostrou que está OK em produção, fix preventivo): (#A) advisory lock por order_id + check de stock_movements duplicado pra evitar débito 2× em retries; (#C) `CEIL` no cálculo de fichas (era `round`, podia arredondar pra menos em qty fracionária); (#D) `unaccent()` no match de cor (Café=Cafe, Carmim=Carmín). Requer extensão pg_unaccent (já vem no Supabase). Compatível com fluxo atual.
- `20260524150000_audit-round-2-fixes.sql` — **Auditoria Round 2 — 3 bugs reais**: (#1 CRÍTICO) `calculate_order_cost` tinha unit mismatch — sole_standard_items emitidas em `g` eram multiplicadas por unit_price em `R$/kg`, gerando custo até 1000× errado. Corrigido com nova função `convert_to_product_unit(qty, src, tgt)` aplicada antes da multiplicação. Breakdown agora expõe `required_in_product_unit + consumption_unit + product_unit` pra auditoria. (#3 MENOR) `get_wave_material_needs` podia duplicar produtos que estavam em `sheet_materials` E também via `resolve_sole_color` se a categoria não casasse com `%solado%` — corrigido com anti-join (`NOT IN sole_product_ids`); stock_qty também deduz reserved_stock agora. (#4 MENOR) `purchase_projection_timeline` view não deduzia `reserved_stock` em `estoque_atual` — relatórios eram otimistas. Recriada com `GREATEST(0, m.quantity - reserved_stock)` e adiciona `estoque_bruto` + `estoque_reservado` pra auditoria. Frontend: `useCreatePurchaseOrder` ganhou idempotência client-side por hash do payload (Map TTL 30s) — bloqueia double-click criar 2 POs.
