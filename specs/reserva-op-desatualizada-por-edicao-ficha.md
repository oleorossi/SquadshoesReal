# Débito/reserva de OP não reflete edição da ficha por cor (snapshot congelado)

## Goal
Garantir que, ao editar a ficha técnica — em especial as **listas por cor**
(componentes, forração, palmilha e solado por cor) —, o **débito/reserva de
estoque das OPs** volte a bater com o consumo real da ficha. Hoje um componente
adicionado a uma lista por cor **depois** que a OP congelou seu snapshot **não é
reservado/debitado**, embora apareça corretamente no modal "Consumo de
Materiais". Serve PCP/estoque (evita furo de reserva silencioso) e compras
(MRP/OC dimensionadas a menos).

## Background / Problem

Auditoria do **PV-00146** (cliente LNG 10, ref **DS22** = `903928`, cores
CAPUCCINO + OFF WHITE):

- A ficha da DS22 tem `component_colors_enabled = true`. PADRÃO
  (`direct_components`) = **ABS TURQUEZA AZUL 12MM** + **ABS MARROM 12MM** (8/par
  cada). A lista **por cor de OFF WHITE** = **REDONDO PEROLA 12MM** + **ABS
  MARROM 12MM** (8/par cada). Demais cores (CAPUCCINO, CARAMELO…) sem lista
  própria → usam o PADRÃO.
- O **motor de consumo vivo está correto**. `calculate_order_consumption_by_grade`
  hoje retorna, para a grade de 780 pares:
  - **CAPUCCINO** → `direct_components`: ABS TURQUEZA (6240) + ABS MARROM (6240) ✅
  - **OFF WHITE** → `component_color`: REDONDO PEROLA (6240) + ABS MARROM (6240) ✅
  Logo, o modal "Consumo de Materiais" (motor TS `orderConsumption.ts`, que
  espelha o SQL) **exibe** todos os componentes.
- Mas as **reservas gravadas** (frozen no momento da criação da OP) divergem:
  - OP-2026-01155 (CAPUCCINO): reservou ABS TURQUEZA + ABS MARROM ✅
  - **OP-2026-01157 (OFF WHITE): reservou só REDONDO PEROLA. ABS MARROM (6240 un)
    NUNCA teve linha de reserva (em nenhum status).** ✗

**Causa raiz — snapshot congelado + gap de invalidação:**

1. A criação da OP ("Gerar OPs") chama
   `hybrid_debit_stock_for_order(..., p_force_soft := true)`
   ([useSaleOrders.ts:1103](src/hooks/useSaleOrders.ts#L1103)). Essa função **não
   lê a ficha viva**: lê o consumo **congelado** em
   `technical_sheet_snapshots.consumption_snapshot`. Se já existe snapshot para o
   par (PV, item do PV), ela **reutiliza** e nunca re-explode a ficha; só congela
   (`freeze_technical_sheet`) quando não há snapshot.
2. Linha do tempo do PV-00146 / OFF WHITE (evidência):
   - `technical_sheet_component_colors`: REDONDO PEROLA criado **2026-07-04 18:49**;
     **ABS MARROM criado 2026-07-11 19:22:17**.
   - OP-2026-01157 criada **2026-07-11 19:23:18** → reserva de REDONDO PEROLA
     com `metadata = {kind: component, source: component_color, color: OFF WHITE}`
     (prova de que veio do `hybrid_debit`). ABS MARROM **ausente**.
   - Conclusão: o snapshot usado no débito foi congelado **antes** de ABS MARROM
     entrar na lista de OFF WHITE. Como o snapshot não foi invalidado ao editar a
     ficha, o `hybrid_debit` reservou o conjunto antigo.
3. **Por que não foi invalidado:** a máquina de invalidação **já existe**, mas só
   cobre `technical_sheets` e `sheet_materials`:
   - `trg_mark_so_costs_dirty_from_sheet` (AFTER UPDATE em `technical_sheets`)
     seta `sale_orders.costs_dirty_at`, **`technical_sheet_snapshots.outdated_at`**
     e **`sale_orders.reservations_outdated_at`** para os PVs que usam aquela ref.
   - `trg_bump_sheet_version` + `trg_mark_so_costs_dirty_from_bom` (em
     `sheet_materials`) fazem o equivalente para o BOM.
   - **As quatro tabelas de mapeamento por cor —
     `technical_sheet_component_colors`, `technical_sheet_lining_colors`,
     `technical_sheet_palmilha_colors`, `technical_sheet_sole_colors` — NÃO têm
     nenhum trigger.** Editar uma lista por cor não bumpa versão, não marca custo
     sujo, não seta `outdated_at` no snapshot e não seta
     `reservations_outdated_at`. Nada avisa o sistema.
4. **Não há caminho de "cura" para OP em produção:** `refresh_order_reservations`
   (a) **aborta se existe qualquer snapshot** (`skipped: snapshot_exists`) e
   (b) só roda para OP em `Pendente/Reservado/Rascunho` — as OPs afetadas estão
   `Em Produção`. `hybrid_debit` também nunca reavalia `outdated_at` (só o
   `idempotent_skip` por já existir reserva). Ou seja: mesmo se o flag fosse
   setado, hoje não há ação que recomponha a reserva.

Efeito líquido: consumo/modal/custeio **vivos** mostram certo; a **reserva/débito
congelada** fica a menos. Some silenciosamente — sem alerta, sem OC de reposição
do item faltante.

> Relacionado: [[project_cost_snapshot_freeze_gotcha]] (mesmo snapshot alimenta
> custeio), [[project_component_colors_per_predominant]] e
> `specs/auditoria-componentes-por-cor.md` (validaram o motor de consumo E2E — o
> motor está certo; o gap é a invalidação do snapshot, não o cálculo),
> [[project_reservations_outdated_badge_and_dead_cron]] (o badge
> `reservations_outdated_at` já existe e é limpo por visita).

## Scope

### In scope
- Wiring de invalidação para as **4 tabelas de mapeamento por cor** (componente,
  forração, palmilha, solado por cor), espelhando `tg_mark_so_costs_dirty_from_sheet`.
- Um caminho de **refresh de reservas que recompõe a partir da ficha viva** e que
  funcione também para OP `Em Produção` **sem quantidade consumida** (aqui
  `quantity_consumed = 0`).
- **Superfície ao usuário**: o PV/OP mostrar que as reservas estão desatualizadas
  (reaproveitar `reservations_outdated_at`) e oferecer ação explícita "Atualizar
  reservas".
- **Reparo pontual** do PV-00146 (reservar ABS MARROM 6240 un na OP-2026-01157) e
  um **detector/relatório** de OPs não-finalizadas cuja reserva diverge do consumo
  vivo (blast radius), para limpar o backlog.
- **Guarda de regressão** (teste de paridade).

### Out of scope (explicitamente agora)
- Reprojetar `hybrid_debit_stock_for_order`/snapshot para "sempre ao vivo" (o
  congelamento é proposital para custeio/auditoria — mantê-lo).
- Refresh automático que **estorne consumo já efetivado** (OP com
  `quantity_consumed > 0` / setor já apontado). Nesses casos: apenas **sinalizar**,
  não mexer.
- Mudar a regra de resolução de cor/componente do motor de consumo (está correta).
- Migrar o fluxo de "Gerar OPs" para `try_reserve_materials` (caminho diferente,
  fora do escopo).

## Requirements
Numeradas, testáveis, cada uma é um "must".

1. **Invalidação nas tabelas por cor.** Criar trigger AFTER INSERT/UPDATE/DELETE
   em `technical_sheet_component_colors`, `technical_sheet_lining_colors`,
   `technical_sheet_palmilha_colors` e `technical_sheet_sole_colors` que, a partir
   do `sheet_id` (= `COALESCE(NEW.sheet_id, OLD.sheet_id)`), replique o efeito de
   `tg_mark_so_costs_dirty_from_sheet`:
   - `UPDATE sale_orders SET costs_dirty_at = now()` para PVs que usam a ref
     (via `sale_order_items.reference_id`) e status ∉ (Cancelado, Cancelada, Rascunho);
   - `UPDATE technical_sheet_snapshots SET outdated_at = now() WHERE sheet_id = <ref> AND outdated_at IS NULL`;
   - `UPDATE sale_orders SET reservations_outdated_at = now()` para PVs da ref em
     status ∈ (Pendente, Aprovado, Em Produção).
2. **Bump de versão da ficha (paridade com `sheet_materials`).** Editar qualquer
   das 4 tabelas por cor deve incrementar `technical_sheets.version` (como
   `fn_bump_sheet_version` faz para BOM), para que qualquer verificação por versão
   detecte a mudança.
3. **Refresh recompõe da ficha viva.** Deve existir uma função/rotina que, para
   uma OP alvo **não finalizada e com `quantity_consumed = 0` nas linhas de
   material**, (a) re-explode o consumo com `calculate_order_consumption_by_grade`
   (ficha viva, honrando variante/cor/packaging_mode), (b) **re-congela** o
   snapshot correspondente e (c) **reconcilia as reservas**: cria as linhas
   faltantes, remove as que sobraram, ajusta as que mudaram — **idempotente** por
   `(order_id, product_id, source)` e **sem** tocar `quantity_consumed`.
4. **Cobre OP `Em Produção` sem consumo.** O refresh (Req 3) deve rodar para OP em
   `Em Produção` desde que nenhuma quantidade tenha sido consumida; se houver
   consumo (`quantity_consumed > 0` em qualquer linha), **não altera** e retorna
   `skipped: has_consumption` (o item entra no relatório do Req 6 para tratamento
   manual). `refresh_order_reservations` atual **não** serve (aborta em
   `snapshot_exists` e em `op_in_production`) — ajustar ou criar caminho novo.
5. **Superfície + ação no usuário.** O PV com `reservations_outdated_at` setado
   deve exibir o estado "reservas desatualizadas" (reaproveitar o badge existente)
   e oferecer ação **"Atualizar reservas"** que dispara o Req 3 para as OPs
   elegíveis do PV, com toast de resultado (quantas OPs/linhas atualizadas,
   quantas puladas por consumo). Ao concluir sem pendências, limpar
   `reservations_outdated_at`.
6. **Detector de divergência (backlog).** Função de diagnóstico
   (ex.: `reservation_vs_consumption_drift_report()`, exposta em /diagnostics) que
   liste OPs não-finalizadas onde as reservas ativas divergem do consumo vivo
   (produto no consumo sem reserva equivalente, ou reserva sem consumo, ou
   quantidade diferente), com PV, OP, produto, esperado, reservado e delta.
7. **Reparo do PV-00146.** Após o fix, a OP-2026-01157 (OFF WHITE) deve ter reserva
   de **ABS MARROM 12MM = 6240 un** (`source = component_color`), e o
   `reservations_outdated_at` do PV limpo. Nenhuma reserva correta pré-existente
   pode ser duplicada (ex.: REDONDO PEROLA continua 6240, não 12480).
8. **Sem furo de reposição.** Se, ao recompor, o item faltante não tiver estoque
   suficiente, o comportamento deve seguir a política vigente do débito soft
   (reserva parcial/pendência) — **não** deve silenciosamente ignorar o item como
   hoje. (No mínimo, aparecer no relatório do Req 6.)
9. **Guarda de regressão.** Teste que: cria/edita uma linha por cor depois de um
   snapshot existir, verifica que o snapshot fica `outdated_at IS NOT NULL` e que,
   após o refresh, as reservas da OP batem 1:1 com
   `calculate_order_consumption_by_grade`. Integrar ao contrato de paridade
   existente (SQL: `run_consumption_parity_tests()` /
   `component_colors_consistency_report()`; TS: suíte de `orderConsumption`).

## Data model / Domain

Tabelas/colunas envolvidas (sem novas tabelas necessárias):

- `technical_sheet_component_colors (id, sheet_id, cabedal_color, product_id, quantity_per_unit, created_at)`
  — 1 cor → N linhas; `sheet_id` = `technical_sheets.id` = `reference_id`.
- Irmãs por cor: `technical_sheet_lining_colors`, `technical_sheet_palmilha_colors`,
  `technical_sheet_sole_colors` (mesmo padrão de invalidação ausente).
- `technical_sheets (id, version, direct_components jsonb, component_colors_enabled, …)`.
- `technical_sheet_snapshots (id, sheet_id, sale_order_id, sale_order_item_id,
  consumption_snapshot jsonb, sheet_version, frozen_at, outdated_at, …)`
  — UPSERT por `(sale_order_id, sale_order_item_id)`.
- `sale_orders (id, status, costs_dirty_at, reservations_outdated_at)`.
- `material_reservations (order_id, product_id, quantity_reserved, quantity_consumed,
  status, reservation_type, source, metadata)` — reserva por OP; `metadata.kind`
  = `component`/`sole_pending_grade`; `metadata.source` = `component_color`,
  `direct_components`, etc.
- `orders (id, sale_order_id, sale_order_item_id, reference_id, color, grade, status)`.

Funções-chave: `hybrid_debit_stock_for_order` (lê snapshot; grava reservas soft),
`freeze_technical_sheet` (UPSERT do snapshot; usa `calculate_order_consumption_by_grade`),
`refresh_order_reservations` (hoje inútil p/ este caso), `resync_op_atomic`,
`process_outdated_reservations`, `release_order_reservations`.

**Migração implícita:** nova migration em `supabase/migrations/` com os triggers
(Req 1–2), a função de refresh/reconciliação (Req 3–4), a função de relatório
(Req 6) e o backfill de reparo (Req 7). Idempotente. Não reintroduzir UPDATE
manual de `reserved_stock` (o trigger `tg_material_reservations_sync_reserved`
já sincroniza — ver aviso em CLAUDE.md / Auditoria Round 6).

## User flows

### Happy path (recorrência prevenida)
1. Usuário edita a ficha da DS22 e adiciona ABS MARROM à lista por cor de OFF WHITE.
2. Trigger (Req 1) seta `snapshots.outdated_at` e `sale_orders.reservations_outdated_at`
   dos PVs que usam DS22 e estão pré/produção; bumpa `technical_sheets.version`.
3. Ao abrir o PV, aparece o aviso "reservas desatualizadas" + botão "Atualizar
   reservas" (Req 5).
4. Usuário clica. Refresh (Req 3/4) recompõe: OP OFF WHITE ganha reserva de ABS
   MARROM 6240 un; nada duplicado; toast "1 OP atualizada, 1 linha adicionada".
5. `reservations_outdated_at` limpo. Modal de consumo e reservas passam a bater.

### Alternate / edge flows
- **OP já com consumo apontado** (`quantity_consumed > 0`): refresh **pula**
  (`skipped: has_consumption`); PV segue sinalizado; item listado no relatório
  (Req 6) para tratamento manual (novo apontamento / ajuste).
- **Estoque insuficiente do item novo**: reserva parcial/pendência conforme
  política soft vigente; item aparece no relatório; (opcional) OC de reposição
  conforme regra atual — **não** sumir silenciosamente.
- **Edição que REMOVE um componente da lista** (ou troca produto): refresh remove
  a reserva órfã e cria a nova; `reserved_stock` reconcilia via trigger de sync.
- **Cor sem lista própria** (usa PADRÃO): editar `direct_components` já dispara a
  invalidação (é coluna de `technical_sheets`); garantir que o refresh também
  cubra esse caminho.

## Edge cases & failure modes
- **Snapshot inexistente** (como no PV-00146 hoje, foi apagado depois): o refresh
  deve funcionar mesmo assim — re-explode da ficha viva e re-congela; não depender
  do snapshot antigo existir. O flag que dirige o refresh é
  `reservations_outdated_at` (no PV), não a existência do snapshot.
- **Idempotência**: rodar "Atualizar reservas" 2x seguidas não pode duplicar
  reservas nem inflar `reserved_stock`. Chave de reconciliação `(order_id,
  product_id, source)`.
- **Concorrência**: usar o mesmo `pg_advisory_xact_lock('hybrid_debit:'||order_id)`
  do débito para não correr com um débito/consumo concorrente.
- **Solado por numeração**: linhas `primary_sole`/`sole_pending_grade` seguem o
  fluxo por grade (`debit_sole_stock_by_grade`) — a reconciliação não deve
  transformá-las em reserva escalar.
- **Múltiplos itens do mesmo PV compartilhando produto** (ex.: ABS MARROM em
  CAPUCCINO/PADRÃO e OFF WHITE/por-cor): a reconciliação é **por OP**; cada OP
  reserva sua parte. Não deduplicar entre OPs (foi o efeito que mascarou o bug —
  a demanda por OP é independente).
- **Packaging mode / variante de material**: o refresh deve honrar
  `sale_orders.packaging_mode` e `sale_order_items.material_variant_id` (mesmos
  parâmetros que `freeze_technical_sheet` usa).

## Constraints & assumptions
- **Stack/convenções:** Postgres/Supabase; migration idempotente em
  `supabase/migrations/`; funções `SECURITY DEFINER`, `SET search_path = public`,
  `is_approved_user()` como as vizinhas. Front em React Query + `sonner`; typecheck
  `bunx tsc -p tsconfig.app.json --noEmit`.
- **Não** reintroduzir UPDATE manual de `reserved_stock` (trigger de sync já cuida).
- **Assumção (default escolhido):** invalidação é **automática** (trigger seta os
  flags), mas a **recomposição das reservas é acionada explicitamente** pelo
  usuário (botão "Atualizar reservas") — exceto OPs pré-produção
  (Pendente/Reservado/Rascunho), onde pode ser automática via o
  `refresh_order_reservations` ajustado. Escolha conservadora por causa de OP em
  produção. (Ver Open questions.)
- **Assumção:** o motor de consumo vivo (`calculate_order_consumption_by_grade` e
  o espelho TS) é a fonte da verdade e já está correto (validado em
  `specs/auditoria-componentes-por-cor.md`).
- Verdade = banco, não arquivos de migration ([[project_db_truth_vs_migration_files.md]]).

## Open questions
- **Automático vs. manual para OP `Em Produção`:** recompor reservas
  automaticamente ao editar a ficha (mais "mágico", risco em produção) ou só
  sinalizar + botão manual (recomendado)? Default deste spec: **manual** para
  produção, **automático** para pré-produção.
- **OC de reposição** quando o item novo falta em estoque: criar OC automática
  (como o ramo `sheet_materials` do `try_reserve`) ou só sinalizar? Default:
  seguir a política soft atual do `hybrid_debit` e **listar no relatório**.
- Onde expor "Atualizar reservas": no cabeçalho do PV, no modal "Consumo de
  Materiais", ou em ambos? (provável: ambos, reusando o badge existente.)

## Definition of Done
Checklist verificável item a item:

- [ ] **Req 1** — Editar uma linha em cada uma das 4 tabelas por cor seta
  `technical_sheet_snapshots.outdated_at` e `sale_orders.reservations_outdated_at`
  dos PVs afetados. *Verificar:* `UPDATE technical_sheet_component_colors …; SELECT
  outdated_at FROM technical_sheet_snapshots WHERE sheet_id = <ref>;` e o
  `reservations_outdated_at` do PV.
- [ ] **Req 2** — A mesma edição incrementa `technical_sheets.version`. *Verificar:*
  ler `version` antes/depois.
- [ ] **Req 3/4** — Rodar o refresh na OP-2026-01157 recompõe as reservas a partir
  da ficha viva sem tocar linhas consumidas; OP com `quantity_consumed>0` retorna
  `skipped: has_consumption`. *Verificar:* chamar a função e comparar
  `material_reservations` da OP com `calculate_order_consumption_by_grade`.
- [ ] **Req 5** — No PV com flag setado, a UI mostra "reservas desatualizadas" e o
  botão "Atualizar reservas"; clicar atualiza e limpa o flag. *Verificar:* abrir o
  PV-00146 na tela, ver o aviso, clicar, ver toast e o aviso sumir.
- [ ] **Req 6** — `reservation_vs_consumption_drift_report()` lista a OP-2026-01157
  com ABS MARROM (esperado 6240, reservado 0, delta 6240) **antes** do reparo e
  **vazio para essa OP** depois. *Verificar:* rodar a função em /diagnostics.
- [ ] **Req 7** — Após o fix, `SELECT quantity_reserved FROM material_reservations
  WHERE order_id = 'e5edb78a-…' AND product_id = '85dbb27a-…'` retorna **6240**,
  `source = component_color`; REDONDO PEROLA continua **6240** (não duplicou);
  `reserved_stock` de ABS MARROM reflete a soma correta.
- [ ] **Req 8** — Simular item novo sem estoque: reserva parcial/pendência criada
  (ou item no relatório), **nunca** ignorado sem rastro.
- [ ] **Req 9** — Teste de regressão passa: pós-edição de lista por cor, snapshot
  fica outdated e o refresh gera reservas que batem 1:1 com o consumo vivo;
  integrado a `run_consumption_parity_tests()` / suíte TS.
- [ ] **Build/typecheck** — `bunx tsc -p tsconfig.app.json --noEmit` limpo;
  migration aplica idempotente; `npm run check:tokens` limpo se houver edição visual.
