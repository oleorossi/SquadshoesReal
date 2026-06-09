# Auditoria Geral do Sistema — 2026-06-09

**Escopo:** MRP, Pedidos de Venda, estoque/reservas/débitos e varredura geral
(produção, financeiro, fiscal, RH, transversal).

**Metodologia:** 4 frentes de auditoria de código (frontend + migrations SQL) com
verificação cruzada no **banco de produção** (`ssvxfoybzmjlypnipqzn`) via
`pg_proc`/`pg_views` e queries de integridade de dados. Achados marcados como
**[LIVE]** foram confirmados no banco vivo; **[REPO]** valem só para replay das
migrations (o vivo já foi corrigido via MCP); **[CÓDIGO]** confirmados por leitura
do código atual.

---

## 1. Críticos

### C1. [CÓDIGO] Recebimento de OC nunca conclui e credita estoque em dobro no retry
- **Onde:** `src/pages/PurchaseOrders.tsx:597,670` × `src/hooks/usePurchaseOrders.ts:83`
- O fluxo faz claim atômico (`status='receiving'`), credita estoque item a item e
  chama `updateOrder.mutateAsync({status:'received'})`. Mas o guard do hook
  (`.not('status','in','("received","receiving","cancelled")')`) **bloqueia o update
  quando o status é `receiving`** — exatamente o estado em que o claim deixou a OC.
  Resultado: 0 rows → throw → catch faz rollback do status → **estoque já creditado**.
  Cada retry credita de novo (2×, 3×…). A OC nunca chega a `received` por esse caminho.
- **Evidência no banco:** nenhuma OC jamais atingiu `received` (só pending/cancelled/suggested).
- **Fix:** na transição final, update direto `.eq('status','receiving')` (sem o hook),
  ou excluir `receiving` do guard quando o novo status é `received`.

### C2. [LIVE] Custo de material inflado N× quando o item tem snapshot de consumo
- **Onde:** `calculate_order_cost_item` (live; base `20260512200000` + patches A4/MOD)
- O snapshot (`technical_sheet_snapshots.consumption_snapshot`) é congelado com a
  grade **escalada** (`grade × fichas` — `useSaleOrders.ts:1339,1595,2190`), ou seja, já
  cobre a quantidade total. Mas a função aplica `v_qty_multiplier = qty / grade_sum`
  com a grade **base** → multiplica por `fichas` de novo.
- **Prova em produção:** item `1344e093-…` (fichas=35, qty=420):
  `order_costs.material_cost = R$ 67.185` contra receita de R$ 8.358 — inflação exata
  de 35×. Itens irmãos sem snapshot: ~R$ 1.736. Margem do PV/Dashboard/Relatório
  Gerencial sai absurdamente negativa.
- **Fix:** quando o consumo vier de snapshot, multiplicador = `qty / snapshot.quantity`
  (na prática 1). Depois do fix, recalcular custos dos PVs com snapshot.

### C3. [LIVE] `get_wave_material_needs` não converte dm²→unidade física (shortage ~100×)
- **Onde:** versão live = `20260702160000` (CTE `sheet_needed`:
  `SUM(sm.quantity_per_unit * soi.quantity)` cru)
- Para material de área (napa/forro), `quantity_per_unit` é **dm²/par**, mas
  `stock_qty` está em metros → `shortage = dm² − m` ~100× inflado. O cálculo
  artesanal (`needed_qty / yield_per_meter`) herda a inflação.
- **Impacto direto:** `createWaveWithMaterialOrders` (`src/services/waveTimelineService.ts`)
  **gera OCs automáticas** a partir desse shortage → ordens de compra ~100× maiores.
  O mesmo bug já foi corrigido no modal (2026-05-30) e no `fn_projected_demand`
  (`20260720120000`), mas este caminho ficou de fora.
- **Fix:** dividir por `get_material_conversion_info(product_id).dm2_per_unit`
  (fator 1 para não-linear/tiras — mesmo padrão da 20260720120000).

### C4. [LIVE] BOM (`sheet_materials`) de área cru no caminho SQL de consumo/reserva/custo
- **Onde:** `calculate_order_consumption` e `_by_grade` (live/`20260702190000`,
  linhas BOM), `try_reserve_materials` (loop BOM, declarado fora do escopo no A3
  `20260703200000`)
- A linha BOM emite `required = quantity_per_unit × qtd` **sem** conversão dm²→m,
  sem perda% e sem campo `unit`. Encadeia três efeitos:
  1. **Custeio:** `unit` null → `convert_to_product_unit` retorna o valor cru →
     dm² × R$/m → custo de napa via BOM ~100× inflado (o patch A4 não dispara
     porque o retorno não é NULL).
  2. **Reserva:** `try_reserve_materials` reserva o valor cru → `reserved_stock`
     inflado → falsa falta em todo o frontend e POs desnecessárias.
  3. **Débito:** `convert_reservation_to_out` debita a reserva inflada sem validação
     (ver M4) → zera o estoque físico do material no faturamento.
- É a "divergência conhecida (servidor)" do CLAUDE.md — confirmada e com efeito
  destrutivo no estoque, não só no relatório.
- **Fix:** nas duas funções de consumo + loop BOM do try_reserve: converter via
  `get_material_conversion_info` (+ perda%), emitir `unit`, e deduzir
  `reserved_stock` no `available`.

### C5. [LIVE] Regressão: Fachete sumiu de `calculate_order_consumption_by_grade`
- A `20260518120000` adicionou Fachete + warning `fallback_average` na by_grade; as
  reescritas posteriores (`20260607150000/160000`, `20260629210000`, `20260702190000`)
  só mantiveram o Fachete na versão single-size. Verificado live: a by_grade **não
  contém** `'Fachete'`.
- **Impacto:** PV sempre usa grade → custeio, snapshot, débito e MRP **não reservam/
  debitam/custeiam o forro extra de solados fachetados**. O modal da UI mostra
  (`src/lib/orderConsumption.ts:681-708`), o banco não debita.
- **Fix:** reintroduzir o acumulador per-size de `fachete_lining_consumption_dm2`
  (com conversão, igual ao Forro) + restaurar o `consumption_warning`.

### C6. [LIVE] `commit_picking_for_sale_order` quebra picking de PV com solado soft
- **Onde:** live = `20260517160000` (sem branch por `metadata->>'kind'`)
- Escrita quando solado era debitado HARD na criação da OP. Desde `20260524330000`
  o débito é SOFT (reserva `kind='sole_grade'` fica `reserved`). O picking debita o
  solado flat sem tocar `stock_grade` → trigger `check_grade_quantity_coherence`
  aborta → **picking inteiro do PV falha**. Mesma classe do C2-fix da `20260703160000`
  (`convert_reservation_to_out`), que não cobriu o picking.
- **Fix:** espelhar a `20260703160000` (sole_grade debita por tamanho via
  `effective_grade`; `sole_pending_grade` cancela; resto linear).

---

## 2. Altos

### A1. [CÓDIGO] Data mínima de faturamento ignora disponibilidade de material
- `src/lib/minBillingDate.ts:134-135` usa `i.total_pairs`, mas o tipo só tem
  `quantity` → sempre 0 → `compute_material_ready_date` **nunca é chamada** →
  falta de matéria-prima nunca empurra a data nem gera alerta de shortfall.
- **Fix:** trocar para `i.quantity`.

### A2. [CÓDIGO] Kanban/Live/Timeline de produção leem coluna inexistente `sector_name`
- `OrdersKanbanBoard.tsx:114-123`, `ProductionLive.tsx:210,246`,
  `ProductionTimeline.tsx:64-65` — `order_stages` só tem `stage_name` →
  `undefined` → Kanban agrupa tudo errado, Live não mostra setor, Timeline marca
  tudo pendente. **Fix:** usar `stage_name` (+ mapeamento de display).

### A3. [CÓDIGO] PurchasePlanningWizard: 3 bugs encadeados
- `src/components/financial/PurchasePlanningWizard.tsx`
  1. `:214,283` — ignora `reserved_stock` (busca e não usa) → déficit subestimado.
  2. `:497,583-598` — `unit_price` (R$/un de estoque) × déficit (un de compra) →
     investimento estimado e `unit_price` da OC errados pelo fator de conversão
     (ex.: rate 100 → R$ 8 em vez de R$ 800), contas a pagar erradas.
  3. `:553-623` — insere OC direto sem idempotência (não usa `useCreatePurchaseOrder`)
     e sem `supplier_id` → double-click duplica OC; prazo de pagamento cai no default.

### A4. [REPO] Landmines de replay de migrations (repo ≠ banco vivo)
- **Overloads duplicados:** `20260627121000` recria `debit_sole_stock_by_grade` 4-arg
  (stale, sem patch C1); `20260627120000` recria `debit_strap_stock` 4-arg **sem o
  fix cm→m** (÷100); `20260530150000` × `20260516140000` deixam duas
  `debit_packaging_for_order`. **No vivo só existe 1 assinatura de cada** (dropadas
  via MCP), mas um `supabase db push` num banco novo/preview recria a ambiguidade
  (erro 42725 em `resyncOPs.ts`, `resync_op_atomic`, `SaleOrders.tsx`).
- **Timestamps fora de ordem de autoria:** `20260512200000` contém código posterior a
  `20260627*`; replay em ordem cronológica desfaz fixes e faz o patch A4
  (`20260703170000`) **abortar** (replace em texto que não existe + variáveis sem
  declaração).
- **`restore_product_stocks_for_order`:** versão do repo (`20260527240000`) perdeu a
  idempotência (sem movimento `in`) e o skip de graded; a live está correta.
- **Funções só no banco:** `hybrid_debit_stock_for_order` 6-arg e
  `consume_all_reservations_for_order` não têm arquivo no repo.
- **Fix:** exportar `pg_get_functiondef` do estado live das funções afetadas para
  migrations canônicas novas (timestamp atual) + rodar
  `scripts/repair-applied-migrations.sh` (migrations `20260702*`–`20260720*` aplicadas
  via MCP não estão em `schema_migrations`; o último registro é `20260620220000`).

### A5. [CÓDIGO] `types.ts` desatualizado → typecheck com 132 erros (gate cego)
- `src/integrations/supabase/types.ts` não tem colunas/RPCs que existem no banco
  (`profiles.is_sales_rep`, `payroll_runs.*`, `sale_orders.picking_individually_done_at`,
  RPCs `create_product_with_initial_stock` etc.). O item 4 do CLAUDE.md (typecheck
  limpo) está inoperante — bugs reais somem no ruído.
- **Fix:** regenerar via MCP `generate_typescript_types` e zerar os erros restantes.

---

## 3. Médios

| # | Onde | Bug | Fix |
|---|------|-----|-----|
| M1 | `PurchaseOrders.tsx:440-461` | Editar item da OC envia objeto inteiro (campo `product` não é coluna) → update sempre falha | enviar só `{quantity, unit_price}` |
| M2 | `MrpProjectionsTab.tsx:78-129` | "Em trânsito" soma qtd em unidade de compra sem `conversion_rate`; ignora OCs `sent` | converter e incluir `sent` |
| M3 | `PurchaseOrders.tsx:584-665` + `stockAdjustments.ts:32` | Recebimento de solado com grade não atualiza `stock_grade` (disponibilidade por numeração segue em falta) | aplicar `item.grade` no `stock_grade` |
| M4 | `20260703160000:107-117` | `convert_reservation_to_out` ramo linear debita sem validar disponível; ledger registra saída cheia com `GREATEST(0,…)` no estoque → restore credita mais do que saiu | validar/clampar consistente com o movimento |
| M5 | `SummaryConsumptionPanel.tsx:397-400` e `bomConsumption.ts:335-342` | Fix BOM de 2026-05-30 não chegou nesses 2 consumidores → painel de resumo do PV e Lista de Separação mostram dm² como "m" (~100×) | usar o motor canônico de `orderConsumption.ts` |
| M6 | `PurchaseOrders.tsx:569-668` | Retry de recebimento após falha parcial re-credita itens já lançados (sem flag por item) | flag `received_at` por item ou RPC transacional |
| M7 | `purchaseConversion.ts:85` | `effectiveConversionFactor` faz fallback silencioso `?? 1` quando não há regra (NF bloqueia com `needsConfig`; recebimento de OC não) | bloquear como a NF |
| M8 | `AdvancesPanel.tsx:56` | Busca em Adiantamentos chama método inexistente → TypeError em render (tela quebra) | `normalizeForSearch(emp?.name)` |
| M9 | `MaterialVariantsPanel.tsx:300` | Delete de grupo de material passa objeto onde a mutation espera string → sempre falha | `mutateAsync(v.id)` |
| M10 | `PrintWorkSheetsPage.tsx:2001` → `ManagementReport.tsx:777,816` | Objeto `cost` não copia `quantity` → guard "⚠ revisar custo suspeito" nunca dispara | copiar `quantity` |
| M11 | `SaleOrders.tsx:1484` | Select sem `barcode` → todas as etiquetas saem com `order_number` como código de barras | incluir `barcode` |
| M12 | Transversal (`ProductionLive.tsx:68`, `SaleOrders.tsx:1768`, Silk/Solagem/Montagem etc.) | `new Date('YYYY-MM-DD')` parseia UTC → atraso/deadline off-by-one em BRT | helper único `parseDateOnly` (`s+'T00:00:00'`) |
| M13 | `XmlImportDialog.tsx:343-379` | Entrada de estoque via XML com read-modify-write no client (sem `adjust_stock`) → corrida corrompe quantidade | usar RPC `adjust_stock` |

## 4. Menores / suspeitas (validar antes de corrigir)

- `useMrp.ts:26` invalida `["purchase-orders"]` mas a key real é `['purchase_orders']` (lista stale após "Gerar OC").
- `MrpNeedsTable.tsx:138` divide só por `conversion_rate` (recebimento prioriza largura) e mostra qtd fracionária de placa; checkbox "todos" nunca consistente.
- `SolePurchaseTab.tsx:29` — `queryKey` por `orders.length`; gerar OC não invalida `sole_shortages`.
- `CreatePurchaseOrderDialog.tsx:166` — input "Filtrar…" sem estado (não filtra).
- `MaterialConsumptionDialog.tsx:50-56` — necessidade individual `"33"` com estoque bucketado `"33/34"` → célula vermelha falsa (PVs legados).
- `StockAvailabilityBadge.tsx:18-22` — `check_stock_availability` sem `p_order_grade` → badge ignora falta por numeração.
- `v_mrp_needs.suggested_qty` usa `p.quantity` bruto (não `available_now`) — defensável se demanda ⊇ reservas; validar com dados.
- Divergência FE×SQL no fallback de lead time de `compute_wave_timeline` (fichas sem capacidade com lead legado → datas ±1-2 dias).
- `purchase_unit` × `purchase_order_unit` podem divergir em rows legados → fator 1 indevido no recebimento.
- `hybrid_debit`: grade 100% conjugada → `v_size` NULL → cai na média escalar.
- `restore_sole_grade_for_order` não marca reservas como restauradas (idempotência só client-side).
- `adjust_stock`/`ManualStockOutDialog` permitem baixar abaixo do reservado (sem aviso).
- `TechnicalSheets.tsx:2442` usa `form.fachete_material` que não existe no form state.
- `SaleOrderItemForm.tsx:426` lê `variant.group_id` que não existe no banco.
- `WeeklyClose.tsx:410` renderiza `full_name` (embed só traz `name`).
- `useImportClients.ts:174` — branch `.doc` legado morto (condição aninhada impossível).
- Testes desatualizados (assinaturas mudaram) — suíte não funciona como gate.
- `useFinanceIntelligence.ts:290` / `useFinanceAdvanced.ts:209` sem paginação — corta em 1000 rows quando o volume crescer (hoje OK: 260/82 rows).
- `getLinearWidthMm` usa `max(width, length)` — comprimento de rolo cadastrado em `dimensions_length` subestima a conversão.

## 5. Saúde dos dados em produção (verificado — OK)

- `reserved_stock` **sem drift** (0 produtos divergentes da soma de reservas `reserved`).
- Sem reservas órfãs (`list_orphan_reservations` vazio), sem `stock_grade` negativo,
  sem materiais de área sem largura (`list_materials_missing_width` vazio).
- Sem receita duplicada em `financial_entries`; unidades 100% canônicas;
  `conversion_rate` sem violações de invariante.
- `audit_unit_divergences()`: **1 achado** — ficha **CF 03** com
  `upper_consumption = 0,68` (+ 61 chaves per-size da mesma ficha): provável m²
  gravado em campo dm²/par → consumo de cabedal ~100× subestimado nessa referência.
  **Corrigir o dado** (0,68 m² = 68 dm²?Confirmar com fábrica).

## 6. Segurança (advisors Supabase)

- 8 views `SECURITY DEFINER` (ERROR): `v_mrp_needs`, `v_products_below_rop`,
  `v_product_abc`, `v_fixed_assets` etc. — bypassa RLS do consultante.
- Funções `SECURITY DEFINER` executáveis por **anon**, incluindo
  `create_product_with_initial_stock` e `create_artisanal_product_with_stock`
  (anônimo pode criar produto com estoque). Revogar EXECUTE de anon.
- 13 políticas RLS `always true`; proteção de senha vazada desativada no Auth;
  3 buckets públicos com listagem.

## 7. Plano de correção priorizado

1. **C1** (recebimento de OC — destrava o fluxo inteiro de compras) + **M1**.
2. **C2** (custo 35× — corrige margem exibida hoje; recalcular custos após).
3. **C3+C4+C5** numa migration de consumo (mesma área: conversão de área no MRP de
   ondas, BOM no consumo/reserva/custo, Fachete by_grade).
4. **C6** (picking) + **M4** (débito sem validação).
5. **A1, A2** (telas de produção e data de faturamento) + **M8-M11** (fixes de 1 linha).
6. **A5** (regenerar types.ts) e **A4** (higiene de migrations — antes de ativar o
   GitHub Action de `db push`).
7. **A3, M2-M3, M5-M7, M12-M13** e seção 4 conforme validação.
