# Engine de Capacidade & Produtividade por Modelo

> Spec fechada em 2026-07-19 a partir do rascunho diagnóstico do dono + verificação
> automatizada em 3 frentes (banco real `ssvxfoybzmjlypnipqzn`, repo, motores
> existentes). Divergências em relação ao rascunho original estão marcadas **[Δ]**.
> **APROVADA pelo dono em 2026-07-19**, com 2 aditivos do dono incorporados (R16–R18):
> fallback "última referência preenchida" e banco de custos salvos por referência.
> Mockup de alta fidelidade da tela (light+dark, tokens reais):
> https://claude.ai/code/artifact/3e3f2c82-9508-459a-9120-e234e8121dac

## Goal

Responder, dentro do ERP, para qualquer ficha técnica: **qual o gargalo**, **quantos
pares/dia a equipe atual produz**, **qual o índice de produtividade entre modelos** e
**qual o custo/par (MO + fixo)** pelos métodos **custo-minuto** e **gargalo** — numa
tela comparativa nova em `/producao/produtividade`.

## Background / Problem

1. Capacidade hoje vive em 3 motores que **não** usam os tempos do BOM:
   `compute_wave_timeline` (SQL) e `leadTime.ts`/`sectorCapacity.ts` (espelho TS) leem
   `technical_sheets.*_capacity_per_day` + `default_lead_times`; o production engine
   (`sector_settings.daily_capacity_pairs`, default global 600) é a terceira fonte.
   Nenhum deriva pares/dia dos minutos reais de operação.
2. `bom_operations.standard_time_minutes` (min/par; 439 operações ativas em 10 stages)
   já é a melhor fonte de tempo por par — alimenta o custeio real
   (`order_costs.labor_cost` via `calculate_order_cost_item`) e tem proveniência
   (`time_source ∈ capacidade|default|cronoanalise|manual|pendente`) — mas ninguém a
   usa para capacidade/gargalo.
3. Headcount por setor não existe como insumo de cálculo: `sector_settings.team_size`
   é só informativo; `employees.department` é texto livre com 7/18 ativos sem setor.
4. Perguntas do dono sem resposta no sistema: gargalo por modelo, pares/dia com a
   equipe atual, ranking de produtividade entre modelos, custo/par pelos dois métodos.
5. **Aditivo do dono (aprovação):** (a) tempos de setores "padrão" (ex.: corte de
   fibra de palmilha, corte de forração) não mudam entre modelos — a engine deve
   **sempre puxar os últimos valores que o dono preencheu na referência anterior**
   quando a ficha nova não tem o tempo próprio; (b) deve existir um **banco de custos
   por referência**: salvar o resultado calculado (pares/dia, gargalo, custos) e
   poder consultá-lo depois.

## Verificação contra o banco real (2026-07-19)

Fatos que fundamentam as decisões abaixo (auditoria read-only):

- `bom_operations`: 439 operações, **todas ativas**. Stages: Acabamento 47, Silk 47,
  Solagem 47, Colagem 46, Montagem 46, **Aviamento 45**, Corte Forração 42, Costura 42,
  Corte Palmilha 40, Expedição 37. **`Corte Cabedal` = 0 operações** (G3 confirmado).
- **[Δ] Premissa do G1 refutada:** as colunas `technical_sheets.*_capacity_per_day`
  **não** estão todas em 0 — 7 de 10 têm 3–9 fichas preenchidas (assembly/finishing/
  gluing/sewing/silk=9, expedition=8, cutting=3); só `costura_`, `mesa_daily_` e
  `soling_` estão 100% zeradas. Elas são **vivas e load-bearing** (alimentam ondas e
  production engine) — não são "colunas mortas" a deprecar nesta feature.
- **[Δ] G2 resolvido:** `sector_labor_rates` não tem key `aviamento`, mas tem **`mesa`**
  (R$ 8,41/h, salário R$ 1.850) — nome legado de Aviamento. `generate_bom_operations()`
  **já** mapeia aviamento→'mesa' ao semear `cost_per_hour`. A ponte existe; não é gap.
- `sector_labor_rates`: 12 keys; `hourly_rate = monthly_salary ÷ 220`
  (`SALARY_HOUR_DIVISOR`). Tem `corte_cabedal` (R$ 10,91/h) **órfã** (zero operações) e
  `costura_palmilha` que não corresponde a stage nenhum do BOM (custeio-only).
- `sector_minutes_default`: 74 linhas, 8 categorias — inclusive **`shoe_category = ''`**
  (string vazia, 10 setores) e **Plataforma com só 7 setores**. `shoe_category` é texto
  livre **sem FK**; join com a ficha é por string (`COALESCE(shoe_category,'')` — mesmo
  comportamento do generator). Valores típicos: Aviamento 2,0 · Montagem 2,25 ·
  Solagem 1,8 · Cortes 1,5 · Costura 0,75 min/par.
- `cost_policies` (1 ativa): `overhead_monthly_total = 24.000`,
  `monthly_production_target = 20.000` (⇒ fixo implícito R$ 1,20/par).
- `technical_sheets`: 47 fichas, todas `status='Ativo'` (pt-BR capitalizado — filtrar
  por `'active'` retorna 0). `code` é sujo (vazios em DS20/EC111, duplicado 903928 em
  DS22/S-039) — **selecionar por `id`, exibir `name`**. SP101 existe
  (`25a8dc2f-131e-43a1-9f3c-9339ab147292`).
- Jornada canônica: `work_schedules.is_default` ≈ **540 min (9h)** — mesma da folha
  (`salaryPayroll.ts`) e do `generate_bom_operations()`. ⚠ `sectorPricing.ts` usa
  `DEFAULT_HOURS_PER_DAY = 8h` (divergência conhecida, follow-up fora deste escopo).
- RLS já habilitado nas 4 tabelas existentes. Funções `get_sheet_bottleneck_capacity`,
  `v_sector_bottlenecks` e `sectorBottleneck.ts` já classificam gargalo por
  `qty ÷ capacity_per_day` (conceito distinto: carga de pedidos, não throughput).

## Scope

### In scope
- **Migration A** — `capacity_parameters` (singleton) + coluna
  `sector_settings.headcount` (numeric). **[Δ]** Sem `sector_stage_map` e sem
  `sector_headcount` (ver Data model).
- **Migration B** — RPC `get_model_productivity(uuid[])` + diagnóstico
  `capacity_consistency_report()` + REVOKEs.
- **Migration C** — banco de custos: tabela `model_productivity_snapshots` + RPC
  `save_model_productivity_snapshot(uuid)` (recalcula server-side e congela) + RLS.
- `src/types/capacity.ts` (contrato do jsonb), `src/services/capacityService.ts`,
  `src/pages/ProdutividadeModelos.tsx`.
- Rota `/producao/produtividade` (lazy em `App.tsx`), entrada em `secondaryRoutes`
  (grupo Produção) e `ROUTE_MODULE_MAP` → `'producao'`.
- Registro do report novo na página `/diagnostics`.
- Testes de service (vitest) + queries manuais de validação SQL.

### Out of scope (explicitamente agora não)
- Deprecar/convergir `technical_sheets.*_capacity_per_day` e `default_lead_times`
  (seguem alimentando ondas/production engine; decisão separada — ver Gates).
- Alinhar `DEFAULT_HOURS_PER_DAY = 8h` de `sectorPricing.ts` com a jornada de 9h
  (follow-up registrado; não tocar na aba MOD do Markup).
- Renomear a key `mesa` → `aviamento` em `sector_labor_rates`.
- Mexer em `calculate_order_cost_item` / `order_costs` / `compute_wave_timeline` /
  `sector_settings.daily_capacity_pairs`.
- Cronoanálise em si (tela `/cronoanalise` já existe; G5 é gate de dado, não de código).
- UI de edição de `bom_operations` (OperationsTab já cobre).

## Requirements

1. **Migration A** (`20260719120000_capacity-engine-params-headcount.sql`) cria
   `capacity_parameters` **singleton**: `journey_minutes numeric NOT NULL DEFAULT 540
   CHECK (60–720)`, `efficiency_pct numeric NOT NULL DEFAULT 85 CHECK (>0 AND ≤100)`,
   `working_days_per_month numeric NOT NULL DEFAULT 22 CHECK (1–31)`; seed de 1 linha
   com `journey_minutes` derivado de `work_schedules.is_default` quando disponível
   (fallback 540). RLS habilitado, policies só `authenticated` (SELECT/UPDATE).
2. Migration A também adiciona `sector_settings.headcount numeric CHECK (headcount IS
   NULL OR headcount >= 0)`, com backfill a partir de `team_size`. **[Δ]** Headcount
   mora em `sector_settings` (dono único da configuração por setor), não em tabela nova.
3. **[Δ]** Nenhuma tabela `sector_stage_map` é criada: a ponte stage↔`sector_key` reusa
   `sector_display_to_enum()` + o caso especial aviamento→`'mesa'`, **idêntico** ao de
   `generate_bom_operations()` (uma regra só no sistema).
4. **Migration B** (`20260719120100_rpc-model-productivity.sql`) cria
   `get_model_productivity(p_sheet_ids uuid[]) RETURNS jsonb`, `SECURITY INVOKER`,
   retornando por ficha: `sheet_id`, `name`, `shoe_category`, `sectors[]`
   (`sector_key`, `label`, `minutes_per_pair`, `minutes_source: 'bom'|'default'`,
   `time_sources[]` agregadas do BOM, `headcount`, `pairs_per_day`, `cost_per_hour`,
   `is_bottleneck`), `bottleneck_sector`, `pairs_per_day`, `productivity_index`,
   `costs` (dois métodos, ver R7–R8), `incomplete`, `warnings[]`.
5. **Minutos por setor** = Σ `standard_time_minutes` das `bom_operations` **ativas** da
   ficha, por stage. Fallback: quando a ficha não tem nenhuma operação ativa no stage,
   usar `sector_minutes_default` com `COALESCE(ts.shoe_category,'')`, marcando
   `minutes_source='default'`. Ficha sem BOM **e** sem categoria nos defaults ⇒
   `incomplete=true` (sem inventar zeros).
6. **Capacidade**: `pairs_per_day(setor) = headcount × journey_minutes ×
   (efficiency_pct/100) ÷ minutes_per_pair`. `pairs_per_day(modelo) =
   FLOOR(MIN(...))` entre setores com `minutes > 0`; `bottleneck_sector = argmin`.
   `headcount` 0/NULL com `minutes > 0` ⇒ `pairs_per_day = 0` **sem divisão por zero**
   + warning "setor sem equipe" (e vira o gargalo).
7. **Método custo-minuto**: `mo_per_pair = Σ (min/60 × cost_per_hour da própria
   operação)`; linhas vindas do fallback usam `sector_labor_rates.hourly_rate` do
   setor. `overhead_per_pair = overhead_monthly_total ÷ monthly_production_target` da
   `cost_policies` ativa (hoje R$ 1,20). **Invariante:** para ficha 100% BOM,
   `mo_per_pair ≡ order_costs.labor_cost ÷ qty` (mesma fórmula do
   `calculate_order_cost_item` — este método NÃO cria um segundo número de MOD).
8. **Método gargalo**: `custo_dia = Σ (headcount × hourly_rate × journey_minutes/60) +
   overhead_monthly_total ÷ working_days_per_month`; `custo_par_gargalo = custo_dia ÷
   pairs_per_day(modelo)`; `NULL` quando `pairs_per_day = 0`. A UI apresenta a
   diferença entre os métodos como **custo de ociosidade** (não como erro).
9. **Índice de produtividade** = `pairs_per_day ÷ MAX(pairs_per_day do conjunto
   comparado) × 100` (melhor modelo = 100; fichas `incomplete` ficam fora do ranking).
10. **`capacity_consistency_report()`** (mesma migration B; precedente
    `consumption_consistency_report`/`debit_consistency_report`) lista gaps de
    cadastro: fichas com stage sem BOM e sem default; operações `pendente`; setores
    com `headcount` 0/NULL; divergência >20% entre pares/dia derivado de minutos e a
    `*_capacity_per_day` da ficha (usando o mapa **trocado** de
    `sector_settings.ficha_capacity_column` — Corte Palmilha→`sewing_*`, Corte
    Forração→`cutting_*`); taxa `corte_cabedal` órfã; categoria `''` e Plataforma com
    7 setores. Registrada na página `/diagnostics`.
11. **Segurança**: `REVOKE EXECUTE ... FROM anon, PUBLIC` + `GRANT ... TO
    authenticated` nas 2 funções; RLS em `capacity_parameters`; `anon` não lê
    `capacity_parameters` nem executa os RPCs (lição do `sole_technical_specs_backup`).
12. **Service** (`src/services/capacityService.ts`): **[Δ]** import de
    `@/integrations/supabase/client` (o `@/lib/supabase` do rascunho **não existe**);
    funções async planas com `supabase.rpc('get_model_productivity' as any, {...})` e
    `if (error) throw error` (padrão `costingService` — **[Δ]** sem classe
    `CapacityServiceError`; validação client-side lança `Error` com mensagem clara
    **antes** de chamar o banco: `sheetIds` vazio, headcount negativo/NaN, eficiência
    fora de (0,100], jornada fora de [60,720]). Inclui `updateSectorHeadcount`
    (grava `sector_settings.headcount`) e `updateCapacityParameters`.
13. **Página** `src/pages/ProdutividadeModelos.tsx` conforme seção UI; React Query
    (`useQuery`/`useMutation` + invalidation + `sonner`), ícones `@phosphor-icons/react`,
    somente design tokens (`npm run check:tokens` limpo), funcional em 360 px.
14. **Rota e permissão**: lazy import + child route `{ path:
    "producao/produtividade" }` em `App.tsx`; entrada em `secondaryRoutes` com
    `group: "Produção"` (**[Δ]** NÃO vai pra sidebar — o grupo Produção é travado em
    7 itens por decisão do dono, R7.1 de `specs/remodelagem-producao.md`); mapear
    `'/producao/produtividade': 'producao'` em `ROUTE_MODULE_MAP` (sem isso o gate
    granular fica fail-closed e o RBAC legado fail-open — inconsistente).
15. **Testes**: `src/services/__tests__/capacityService.test.ts` (vitest) cobrindo as
    validações de input do R12 (sem tocar no banco — mock do client) e o parse do
    contrato; typecheck `bunx tsc -p tsconfig.app.json --noEmit` limpo.
16. **Fallback "última referência" (aditivo)**: a cadeia de minutos do R5 ganha um
    degrau intermediário — `BOM da própria ficha` > **último valor preenchido pelo
    dono em qualquer outra referência** (linha ativa mais recente por stage com
    `time_source IN ('manual','cronoanalise')` e `minutes > 0`, por `updated_at`) >
    `sector_minutes_default` da categoria. Marcado `minutes_source='ultima_referencia'`
    com o nome da ficha de origem no payload (`source_sheet_name`) e chip próprio na
    UI. Valores derivados pelo generator (`capacidade`/`default`) NÃO contam como
    "preenchidos pelo dono".
17. **Banco de custos por referência (aditivo)**: tabela
    `model_productivity_snapshots` (FK `technical_sheet_id`, nome congelado,
    `pairs_per_day`, `bottleneck_sector`, custos dos dois métodos, `params` jsonb
    com jornada/eficiência/dias úteis/headcount vigentes, `sectors` jsonb com o
    breakdown, `created_by`/`created_at`). Gravação **exclusivamente** via RPC
    `save_model_productivity_snapshot(p_sheet_id)` que chama `get_model_productivity`
    server-side (cliente não envia números — não confiar em payload do browser);
    ficha `incomplete` não pode ser salva (erro claro). RLS authenticated; REVOKE
    anon/PUBLIC no RPC.
18. **Histórico na UI (aditivo)**: botão "Salvar custos" por modelo + dialog
    "Histórico" por referência listando snapshots (data, pares/dia, gargalo, custo
    custo-minuto e gargalo, parâmetros usados), ordenado do mais recente; consulta
    via service (`listProductivitySnapshots(sheetId)`).
19. **Edição de capacidade na tela (aditivo 2, 2026-07-19)**: cada célula da matriz
    (modelo × setor) tem edição — o dono digita **pares/dia observados** e o RPC
    `set_model_sector_capacity` (mig `20260719140000`) converte para
    `min/par = headcount × jornada ÷ pares_dia` (minutos-PESSOA pagos; SEM aplicar
    eficiência — capacidade observada já embute a ineficiência real; a eficiência
    global segue valendo só na EXIBIÇÃO de pares/dia), gravando como
    `time_source='manual'` no BOM da ficha. Consequências encadeadas: custeio dos
    PVs recalcula via trigger costs_dirty; engine lê como camada 1; referências
    novas herdam via `ultima_referencia`. **Dificuldade por modelo** = capacidades
    diferentes no MESMO setor (300 vs 240 p/d na Costura ⇒ 3,6 vs 4,5 min/par ⇒
    MO R$ 0,65 vs R$ 0,82/par com 2 pessoas) — o "coeficiente" emerge da razão,
    sem cadastro paralelo de coeficientes (que driftaria do BOM). Guard-rails:
    exige headcount do setor (conversão impossível sem equipe); recusa setor que
    não pertence a `production_sectors` da ficha (linha órfã no BOM não autoriza —
    testado com DS22×Costura); recusa sobrescrever setor com >1 operação
    manual/cronoanálise (breakdown detalhado se edita na aba Operações).

## Data model / Domain

```
technical_sheets (47, status='Ativo') ──┐
bom_operations (439 ativas; min/par + R$/h + time_source) ──┤  fonte primária de tempo
sector_minutes_default (74; fallback por shoe_category) ────┤  fallback (join por string, COALESCE(...,''))
sector_labor_rates (12 keys; salário÷220) ──────────────────┤  custo-hora por setor (key 'mesa' = Aviamento)
sector_settings (+ headcount numeric NOVO) ─────────────────┤  pessoas por setor (dono único)
capacity_parameters (singleton NOVO: jornada/eficiência/dias úteis) ─┤
cost_policies (ativa: overhead 24k / meta 20k) ─────────────┘
        │
        ▼
RPC get_model_productivity(uuid[]) → jsonb          capacity_consistency_report() → /diagnostics
        │                                            save_model_productivity_snapshot(uuid)
        ▼                                                    │
capacityService.ts → ProdutividadeModelos.tsx        model_productivity_snapshots (histórico)
                     (/producao/produtividade)
```

**Cadeia de minutos por setor (R5 + R16):**
```
1. BOM da própria ficha (operações ativas, Σ min/par)          → 'bom'
2. Último valor preenchido pelo dono em OUTRA referência        → 'ultima_referencia'
   (time_source manual|cronoanalise, mais recente por stage)
3. sector_minutes_default da categoria (COALESCE(cat,''))       → 'default'
4. Nada ⇒ setor fora do cálculo + incomplete/warning
```

**[Δ] vs rascunho:** de 3 tabelas novas para **1 tabela + 1 coluna** —
`sector_stage_map` é redundante com `sector_display_to_enum()` (+ regra
aviamento→'mesa' já existente no generator) e `sector_headcount` driftaria de
`sector_settings.team_size`; headcount vai para `sector_settings` (numeric, aceita
0,5 — G4). Migrations com timestamp completo de 14 dígitos (**[Δ]** o padrão
`20260719_01_...` do rascunho não segue o repo).

**Conceito importante (anti-drift):** esta engine responde **throughput em regime
permanente** (pares/dia sustentados pela equipe). As ondas/production engine
respondem **lead time/agenda** (quando cada OP passa por cada setor). São perguntas
diferentes sobre os mesmos setores — a topologia paralela (prep ‖) afeta lead time,
não throughput; por isso o gargalo daqui (min de capacidade) pode legitimamente
diferir da severidade de `v_sector_bottlenecks` (carga de pedidos vs capacidade).
Documentar esse contraste num comment do RPC e no header da página.

## User flows

### Happy path
1. Usuário abre `/producao/produtividade` (via Cmd+K ou hub Atalhos, grupo Produção).
2. Seleciona 2+ fichas (busca acento-insensível por `name`; default: só `'Ativo'`).
3. A tela mostra: cards de ranking (pares/dia grande, índice, chip do gargalo),
   matriz por setor (min/par + proveniência + pares/dia; célula do gargalo destacada)
   e a tabela de custos com os dois métodos + Δ ociosidade.
4. Ajusta **Equipe** (dialog: headcount por setor, passo 0,5, grava
   `sector_settings.headcount`) e **Parâmetros** (jornada/eficiência/dias úteis) —
   mutação invalida a query e o cálculo refaz na hora.

### Alternate / edge flows
- 1 ficha só ⇒ tudo funciona; índice = 100.
- Ficha `incomplete` ⇒ card neutro com aviso e CTA para a ficha técnica
  (OperationsTab); fora do ranking.
- Setor `minutes_source='default'` ⇒ chip "(padrão)" âmbar (G5).
- Seleção > 8 fichas ⇒ bloquear com aviso (legibilidade/mobile).

## Edge cases & failure modes

- Headcount 0 em todos os setores ⇒ `pairs_per_day = 0`, custo gargalo `NULL`, sem
  divisão por zero (teste SQL manual do DoD).
- `shoe_category` NULL na ficha ⇒ casa com a categoria `''` dos defaults (herda o
  comportamento do generator; documentar no SQL).
- Plataforma (7 setores nos defaults) ⇒ stages ausentes não entram no cálculo e geram
  warning — **não** assumir 0 min.
- Stage cujas operações são todas `pendente`/inativas ⇒ tratar como "sem BOM" ⇒
  fallback default + warning.
- `cost_policies` sem linha ativa ou `monthly_production_target = 0` ⇒
  `overhead_per_pair = NULL` + warning (nunca dividir por zero).
- Setores custeio-only (`corte_cabedal`, `costura_palmilha`) ⇒ fora da capacidade;
  aparecem apenas no consistency report.
- `p_sheet_ids` vazio ⇒ erro claro no RPC; service bloqueia antes.
- Ficha inexistente no array ⇒ ignorada com warning agregado (não aborta o lote).
- Fallback última referência sem nenhum valor manual/cronoanálise no sistema ⇒ cai
  direto no padrão da categoria (degrau 3) sem erro.
- Snapshot de ficha `incomplete` ⇒ RPC de save recusa com mensagem clara.
- Snapshot não é atualizado retroativamente (é congelamento — mesma semântica de
  `order_costs`/`reference_sector_pricing`): corrigir a ficha depois NÃO conserta
  snapshots antigos; a UI mostra a data de cada um.

## Constraints & assumptions

- Stack e convenções do repo: Bun, typecheck **só** `bunx tsc -p tsconfig.app.json
  --noEmit`, tokens de design (check:tokens), phosphor icons, sonner, domínio pt-BR,
  React Query keys em inglês (`['model-productivity', ids]`, `['sector-headcount']`,
  `['capacity-parameters']`).
- Jornada canônica = 540 min (9h), igual folha e generator; divisor de custo-hora =
  220 (não introduzir outro).
- Não tocar: `compute_wave_timeline`, `leadTime.ts`/`sectorCapacity.ts`,
  `sector_settings.daily_capacity_pairs`, `calculate_order_cost_item`,
  `SectorPricingCalculator`/`reference_sector_pricing`, `labor_costs` (legado morto).
- Assumido (defaults registrados, dono pode ajustar na tela): eficiência inicial
  **85%**, dias úteis **22**, seeds de headcount = `team_size` atual (a coluna nova
  nasce consumível; onde `team_size` for NULL, headcount NULL ⇒ warning até
  preencher — **não** semear 12 linhas fixas [Δ], os setores vêm de
  `sector_settings`).

## Decision Gates — respondidos (G1–G5)

- **G1 · Colunas `*_capacity_per_day`:** premissa do rascunho estava errada — não são
  mortas; são a fonte dos motores de ondas/production engine e 7/10 têm dados.
  **Decisão:** esta engine NÃO as lê nem escreve; a reconciliação é exposta (não
  escondida) via `capacity_consistency_report()` (divergência minutos×headcount vs
  capacidade da ficha). Convergência/deprecação = decisão futura separada, fora deste
  escopo.
- **G2 · Aviamento sem taxa:** resolvido — a taxa existe sob a key legada `mesa`
  (R$ 8,41/h) e o mapeamento aviamento→'mesa' já é a regra viva do generator. A
  engine reusa a mesma regra. Rename da key = fora de escopo.
- **G3 · Corte Cabedal sem operações:** confirmado no banco (0 operações; taxa órfã de
  R$ 10,91/h cadastrada). Tratamento: setor fora da capacidade; gap listado no
  consistency report para o dono decidir se completa os BOMs ou remove a taxa.
- **G4 · Headcount fracionado:** sim — `numeric`, passo 0,5 na UI (pessoa dividida
  entre setores). Mora em `sector_settings.headcount` (dono único; evita drift com
  `team_size`). Seed de `employees` foi avaliado e descartado: 7/18 ativos sem
  `department` e setores fabris inteiros sem ninguém mapeado.
- **G5 · Tempos provisórios:** todo setor com `minutes_source='default'` (ou
  `time_source` ≠ cronoanálise) aparece marcado na UI com chip de proveniência.
  Costura 0,75 min/par segue suspeito até cronoanálise — o gargalo pode mudar; o
  report lista as fichas 100% "padrão".

## Open questions

- Dias úteis/mês: seed 22 (seg–sex). Se a fábrica conta sábado, o dono ajusta na
  própria tela de Parâmetros (campo editável — não bloqueia).
- Eficiência inicial 85% é chute informado; ajustável na tela. Nenhuma dessas duas
  pendências bloqueia implementação.

## Definition of Done

- [ ] Migrations A e B aplicadas (via MCP, ordem A→B) sem erro;
      `SELECT * FROM capacity_parameters` retorna 1 linha (journey 540/85/22);
      `sector_settings.headcount` existe e backfilled de `team_size`.
- [ ] R4/R6: `SELECT get_model_productivity(ARRAY['25a8dc2f-...'::uuid])` (SP101)
      retorna gargalo = setor de menor pares/dia, conferido à mão com os minutos do
      BOM/defaults e o headcount vigente.
- [ ] R6: com headcount 0 em todos os setores ⇒ `pairs_per_day = 0`, sem exceção de
      divisão por zero; custo gargalo `NULL`.
- [ ] R5: ficha sem BOM e sem categoria nos defaults ⇒ `incomplete = true`.
- [ ] R7 (invariante): `mo_per_pair` do SP101 ≡ `order_costs.labor_cost ÷ qty` de uma
      OP recente do mesmo modelo (±R$ 0,01) — query manual.
- [ ] R9: índice entre 2 modelos bate conta manual (±1 par de arredondamento).
- [ ] R11: com a anon key, o RPC retorna permission denied e
      `capacity_parameters`/`sector_settings` não são legíveis.
- [ ] R10: `capacity_consistency_report()` roda em `/diagnostics` e lista os gaps já
      conhecidos (corte_cabedal órfã, Plataforma 7 setores, categoria `''`).
- [ ] R12–R13: `bun run test` (suite do service) verde; `bunx tsc -p
      tsconfig.app.json --noEmit` limpo; `npm run check:tokens` limpo; tela útil em
      360 px (light e dark).
- [ ] R14: rota mapeada em `ROUTE_MODULE_MAP` + `secondaryRoutes`;
      `NavigationAccessConsistency.test.ts` e `check-navigation-access.mjs` verdes;
      sidebar Produção continua com 7 itens.
- [ ] R16: ficha sem BOM num setor com valor manual/cronoanálise em outra referência
      usa esse valor (marcado `ultima_referencia` + ficha de origem), e só cai no
      padrão da categoria quando não há valor preenchido em lugar nenhum — query
      manual comparando as 3 camadas.
- [ ] R17: `save_model_productivity_snapshot(SP101)` insere linha em
      `model_productivity_snapshots` com números idênticos ao
      `get_model_productivity` do momento; tentar salvar ficha `incomplete` retorna
      erro claro; anon não executa o RPC nem lê a tabela.
- [ ] R18: dialog Histórico lista os snapshots salvos (data + pares/dia + custos) e
      reflete um snapshot novo sem reload manual (invalidation).
- [ ] R19: editar capacidade de um setor num modelo grava min/par correto no BOM
      (300 p/d com 2 pessoas ⇒ 3,6 min/par — conferido no banco), o custo-minuto
      do modelo muda na hora, e dois modelos com capacidades diferentes no mesmo
      setor mostram MO/par diferentes; setor órfão e setor sem equipe são
      recusados com mensagem clara.
- [ ] Gates G1–G5 conferidos como registrados nesta spec (nenhum pendente bloqueante).
