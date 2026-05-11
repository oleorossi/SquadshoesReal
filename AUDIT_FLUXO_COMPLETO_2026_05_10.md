# Auditoria Completa do Fluxo PV → Reserva → Produção → Entrega

**Data**: 2026-05-10
**Escopo**: PV (Pedido de Venda) → Reserva de estoque → OS Artesanal + OC automática → Prazo mínimo de faturamento → Paralelismo de setores → Fichas de operador → Relatórios
**Método**: 6 agents auditando em paralelo, código a código (`src/` + `supabase/migrations/`).

**Achados totais**: **19 críticos** 🔴 + **20 altos** 🟠 + **19 médios** 🟡 + ~30 obs/baixos 🟢

---

## 1. RESERVA DE ESTOQUE

### 🔴 Críticos

| # | Bug | Arquivo | Severidade |
|---|---|---|---|
| C1 | `try_reserve_materials` **NUNCA roda na aprovação inicial** (só em edit) — regras R3/R4/R5 que geram OC automática quando falta material nunca disparam | `src/pages/SaleOrders.tsx:848-959`, `src/hooks/useSaleOrders.ts:1128-1346`, `src/hooks/useTryReserve.ts` (órfão) | App principal aprova PV sem MRP |
| C2 | `resync_op_atomic` faz `DELETE FROM material_reservations` direto, **vazando `reserved_stock`** (trigger só cobre INSERT) | `supabase/migrations/20260522120000_tighten-wave-rpcs-and-resync-approved-user.sql:87` + 7 outros callers | Drift permanente em produtos |
| C3 | **Backfill round 23 zerou `reserved_stock` de TODOS produtos** — filtro `status='active'` mas `material_reservations` usa `'reserved'`/`'partially_consumed'`/`'consumed'` | `supabase/migrations/20260610120000_audit-round-23-data-drift-cleanup.sql:8` | Em produção neste momento |
| C4 | **Duplo decremento em solado com grade** — INSERT em `material_reservations` (trigger +reserved_stock) + `debit_sole_stock_by_grade` decrementa `quantity` sem decrementar reserved_stock | `supabase/migrations/20260527130000_idempotent-hybrid-debit-stock.sql:168-176` | ATP duplamente penalizado |

### 🟠 Altos

| # | Bug | Arquivo |
|---|---|---|
| A1 | Tiras (`debit_strap_stock`) decrementam `quantity` direto, **nunca passam por `material_reservations`** | `supabase/migrations/20260524140000_strap-debit-preventive-hardening.sql:194-204` |
| A2 | Embalagem idem (reservas de caixa não existem) | `supabase/migrations/20260504130000_atomic-packaging-debit-rpc.sql:59-75` |
| A3 | Solados conjugados (33/34) — UI `OrderMatrixForm` detecta regex local, mas check ATP usa `reserved_stock` agregado sem distinguir par conjugado | `src/components/sale-orders/OrderMatrixForm.tsx:45,76-80` |
| A4 | `try_reserve_materials` não é all-or-nothing — primeiros materials reservam, 5º falha, fica parcial sem rollback | `try_reserve_materials` |
| A5 | **Race condition**: 2 chamadas paralelas podem deletar batch uma da outra → reservas duplicadas (sem `pg_advisory_xact_lock` por `p_order_id`) | `try_reserve_materials` linha 85 |

### 🟡 Médios

| # | Bug | Arquivo |
|---|---|---|
| M1 | "Sem material" não tem UI clara — toast só conta agregada; PV vira Aprovado, OP em Reservado, usuário precisa abrir MRP separado | `src/hooks/useSaleOrders.ts:1128-1346` |
| M2 | Toast warning `no_materials` nunca chega (hook `useTryReserve` órfão) | `src/hooks/useTryReserve.ts:80` |
| M3 | `release_order_reservations` não invalida query `['products']` em 5+ callers | `src/hooks/useSaleOrders.ts:796, 1036, 1292, 1594, 1974` |

### 🟢 Obs
- `try_reserve_materials` usa `LIKE` sem `unaccent()` para cor (linha 117)
- Não trata fachete nem `*_consumption_per_size` (drift vs motor de débito)

---

## 2. PRAZO MÍNIMO DE FATURAMENTO

### 🔴 Críticos

| # | Bug | Arquivo | Severidade |
|---|---|---|---|
| P1 | **3 motores divergentes calculam prazo de formas diferentes**: `compute_wave_timeline` (paralelo PR3), `compute_min_billing_date` (sequencial sem 5 setores), VIEW `purchase_projection_timeline` (sequencial dias-calendário) | `supabase/migrations/20260612120000_hybrid-pickup-windows.sql` (mesmo arquivo, 3 funções dessincronizadas) | PV pode prometer data impossível |
| P2 | `compute_min_billing_date` usa **dias-calendário**, outros usam dias-úteis (diferença ~6 dias em 15) | `supabase/migrations/20260612120000_hybrid-pickup-windows.sql:513` | Mínimo prometido é fisicamente impossível |
| P3 | Buffer/supplier não somados na cascata paralela — `v_lead_supplier` só >0 quando `total_needed > p.quantity` **sem deduzir `reserved_stock`** | `supabase/migrations/20260612120000:253-265` | Outras OPs já reservaram, sistema diz "comprar hoje serve" |

### 🟠 Altos

| # | Bug | Arquivo |
|---|---|---|
| P4 | VIEW `purchase_projection_timeline` dessincronizada com PR2+PR3 (sem Costura/Silk/Colagem/Solagem) | `supabase/migrations/20260523120001_drop-unused-technical-sheets-columns.sql:153-205` |
| P5 | Mesa exibida **DEPOIS** de Montagem no Cronograma Reverso (semântica inconsistente vs PR3) | `src/components/financial/ProductionScheduleTimeline.tsx:141` |

### 🟡 Médios

| # | Bug | Arquivo |
|---|---|---|
| P6 | Costura sem fallback `default_lead_times.costura_capacity_per_day` em `compute_wave_timeline:159-169` |
| P7 | `compute_min_billing_date` lê `orders` (OPs), `compute_wave_timeline` lê `sale_order_items` → PV sem OPs ainda retorna ~9 dias absurdamente curto |
| P8 | Fix round 24 ficou pela metade: `sectorCapacity.ts` corrigido mas VIEW `purchase_projection_timeline` não |

---

## 3. PARALELISMO DE SETORES

### 🔴 Críticos

| # | Bug | Arquivo | Severidade |
|---|---|---|---|
| S1 | `DEFAULT_SECTOR_NAMES` **sem Costura** (3 lugares fallback) | `src/hooks/useOrders.ts:146-149`, `src/hooks/useBomOperations.ts:27-39`, `supabase/migrations/20260522120000:140` | OPs criadas sem Costura |
| S2 | `ProductionPipeline.tsx` STEPS **sem Costura** + usa "Mesa" em vez de "Aviamento" | `src/components/production/ProductionPipeline.tsx:3-13` | Timeline OP renderiza errado |
| S3 | Trigger `tg_normalize_production_sectors` reordena `production_sectors` com Aviamento **antes** de Costura — conflita com `stage_order()` SQL e `STAGE_ORDER` front que tem Costura **antes** de Mesa | `supabase/migrations/20260605120000_fix-production-sectors-legacy-and-missing.sql:29-31, 90-93` | UPDATE em ficha quebra ordem |
| S4 | `finalize_production_sector` é **estritamente sequencial** — não inicia os 3 prep paralelos juntos. Kanban "PARALELO×N" preparado mas nunca dispara automaticamente | `supabase/migrations/20260521120000:284-290` | Paralelismo PR3 fica só matemático |

### 🟠 Altos

| # | Bug | Arquivo |
|---|---|---|
| S5 | `sectorBottleneck.ts` mapeia `Costura: 'cutting_capacity_per_day'` (errado — Costura tem `costura_capacity_per_day` próprio) | `src/lib/sectorBottleneck.ts:83` |
| S6 | `SECTOR_NORMALIZE` legacy mapeia `costura → corte_forracao` | `src/lib/sectorCapacity.ts:183`, `src/pages/CapacityPlanning.tsx:143,162` |
| S7 | `SECTOR_ICONS` em `SectorOverloadDialog` só tem 3 keys; render quebra com `<undefined />` em outros setores | `src/components/production/SectorOverloadDialog.tsx:8-12` |
| S8 | Orders XLS export sem `costura` em `STAGE_ORDER_XLS` | `src/pages/Orders.tsx:769-787` |

### 🟡 Médios

| # | Bug | Arquivo |
|---|---|---|
| S9 | `CapacityPlanning.tsx` lista 9 setores em vez de 10 (Costura ausente) | `src/pages/CapacityPlanning.tsx:20-113` |
| S10 | `production_waves.costura_start_date` persistido (PR 2) mas frontend nunca lê | `src/components/production/WaveDetailPanel.tsx`, `src/components/production/ProductionWavesPage.tsx` |
| S11 | `ProductionFlowMonitor.tsx` componente órfão com mocks legacy | `src/components/ProductionFlowMonitor.tsx:18-22` |
| S12 | `OrderStagesPipeline.tsx` marca Costura como "Legacy fallback" (errado — é canônico) | `src/components/production/OrderStagesPipeline.tsx:14-28` |

### 🟢 OK
- `compute_wave_timeline` (PR 3) matemática **está correta** (paralelo prep + sequencial restantes)
- `tg_strip_cut_sectors_when_ready_made` cobre Costura corretamente

---

## 4. OS ARTESANAL + OC AUTOMÁTICA

### 🔴 Críticos

| # | Bug | Arquivo | Severidade |
|---|---|---|---|
| O1 | **PV cancelado NÃO cancela OC/OS auto-geradas** vinculadas — comprador recebe materiais que ninguém precisa, terceirizado produz tira órfã | `src/hooks/useSaleOrders.ts:760-860` |
| O2 | **OS criada NÃO debita estoque do material BASE** — 2 PVs aprovados em sequência veem mesmo couro disponível, 2 OSs órfãs criadas | `supabase/migrations/20260601120000_oc-os-open-aggregation-per-supplier.sql:157-237`, `MaterialPurchaseConfirmDialog.tsx:108-122` |
| O3 | OC manual via dialog **ignora `MOQ`/`conversion_rate`** — comprador recebe OC em metros quando fornecedor vende em rolos | `MaterialPurchaseConfirmDialog.tsx:74-82`, `src/lib/materialAvailability.ts:122-124` |

### 🟠 Altos

| # | Bug | Arquivo |
|---|---|---|
| O4 | Idempotência client-side não cobre `useUpsertOpenPurchaseOrder` — 2 tabs em paralelo criam 2 OCs distintas pro mesmo fornecedor | `src/hooks/usePurchaseOrders.ts:175-257` |
| O5 | Cancel **deleta** `mrp_suggestions` (destrói auditoria) em vez de marcar `status='cancelled'` (convenção do PR `20260527180000`) | `src/hooks/useSaleOrders.ts:844` |
| O6 | Lead time da OS artesanal não soma no prazo do PV (3 dias otimista) | `supabase/migrations/20260429100000:128-134` |

### 🟡 Médios

| # | Bug | Arquivo |
|---|---|---|
| O7 | Match de receita via `includes()` — "Tira Overlock 5mm" vs "Tira Overlock 5mm Reforçada" colidem | `MaterialPurchaseConfirmDialog.tsx:92` |
| O8 | Fallback contractor errado — `contractors[0]?.id` (alfabético) sem filtrar `active=true` nem `service_type` | `MaterialPurchaseConfirmDialog.tsx:97` |
| O9 | `useCreatePurchaseOrder` não vincula `sale_order_id` — OCs criadas via `PurchasePlanningWizard` ficam sem rastreabilidade | `src/hooks/usePurchaseOrders.ts:232-302` |

### 🟢 Menores
- `release_order_reservations` não desfaz `for_stock_meters` da OS
- `purchase_orders.promised_date` nunca populada na criação automática
- `useUpdateArtisanalRecipe` não recalcula reservas em PV vivo após alterar yield

---

## 5. FICHAS DE OPERADOR

### 🔴 Críticos

| # | Bug | Arquivo |
|---|---|---|
| F1 | `OperatorWorkSheet` ainda chama "**Mesa**" (Checklist Mesa/Tiras, Controle Mesa) — caminho legacy reaparece | `src/components/production/OperatorWorkSheet.tsx:405,429` |
| F2 | `sectorBottleneck.ts` mapping `Costura → cutting_capacity_per_day` (mesma classe do S5; afeta detector de gargalo) | `src/lib/sectorBottleneck.ts:83` |

### 🟠 Altos

| # | Bug | Arquivo |
|---|---|---|
| F3 | Costura ausente de `SECTOR_META` no `OperatorWorkSheet` — cai em fallback Montagem (header azul errado) | `src/components/production/OperatorWorkSheet.tsx:27-37` |
| F4 | `printSaleOrderOPs.ts` desatualizado — só gera Corte/Solagem/Aviamento/Acabamento (sem Costura/Corte Forração/Silk/Colagem) | `src/lib/printSaleOrderOPs.ts:319-320` |
| F5 | `printSectorWorkSheet.ts` menciona "**Mesa**" pre-PR-2 | `src/lib/printSectorWorkSheet.ts:537,554,942` |

### 🟡 Médios

| # | Bug | Arquivo |
|---|---|---|
| F6 | `ManagementReport` match `costKey = sale_order_id::reference_id::color` pode falhar se `calculate_order_cost` grava por `sale_order_item_id` | `ManagementReport.tsx:627`, `PrintWorkSheetsPage.tsx:627` |
| F7 | KPIs Receita/Margem somam só OPs com `cost` carregado — under-reporting silencioso (alerta âmbar só aparece quando totalCost=0) | `ManagementReport.tsx:101-107` |
| F8 | Status setor sem cobertura inversa Mesa↔Aviamento | `ManagementReport.tsx:214` |

### 🟢 OK
- `ExpedicaoWorkSheet` `pairs_per_box_individual` default 12 OK
- `groupOrdersByStore` já removido OK (PR 5)
- Print styles A4 (`break-inside: avoid`, `print-color-adjust: exact`, `font-size: 10pt`) — todos presentes
- `SilkMontageWorkSheet`, `PalmilhaWorkSheet`, `SolagemWorkSheet`, `ExpedicaoWorkSheet`, `ManagementReport` íntegras

---

## 6. RELATÓRIOS

### 🔴 Críticos

| # | Bug | Arquivo |
|---|---|---|
| R1 | `RCCPPlanning` hardcoded **6 setores legacy** (sem Costura/Aviamento separado/Palmilha/Forração separados) — PCP nunca vê gargalo na Costura | `src/components/production/RCCPPlanning.tsx:15-22` |
| R2 | `GroupedReportSummary` `SECTOR_CONFIG` incompleto — sem Corte Palmilha/Corte Forração separados, sem Silk/Colagem/Expedição; mantém AMBOS `mesa` e `aviamento`; `backPath: '/mesa'` rota morta | `src/pages/GroupedReportSummary.tsx:16-24` |
| R3 | `ProductionScheduleTimeline` ignora Aviamento, mantém Mesa legacy — cronograma financeiro mostra dado defasado pra cliente | `src/components/financial/ProductionScheduleTimeline.tsx:69-86,141,402,594` |

### 🟠 Altos

| # | Bug | Arquivo |
|---|---|---|
| R4 | `ManagementReport` bug do mapa de status — chaves brutas DB ≠ chaves UI normalizadas | `src/components/production/ManagementReport.tsx:202,213-214` |
| R5 | `WaveBuilder` rotula etapa como "Mesa", sem Costura | `src/components/production/WaveBuilder.tsx:66-73` |
| R6 | `OrdersSummary` agrupa por Ref+Cor (legacy), não Solado+Cor (novo padrão PR4) | `src/pages/OrdersSummary.tsx:87-108` |

### 🟡 Médios

| # | Bug | Arquivo |
|---|---|---|
| R7 | `ProductionLive` STAGE_COLORS: prep todos mesma cor (impossível distinguir paralelismo visualmente); sem Solagem | `src/pages/ProductionLive.tsx:36-47` |
| R8 | `groupedReportSummary.ts` sole type binário (Preto/Caramelo) — outras cores caem em "Caramelo" silenciosamente | `src/lib/groupedReportSummary.ts:80-84` |
| R9 | `MesaCapacityDialog` mantém label "Capacidade da Mesa" | `src/components/production/MesaCapacityDialog.tsx:61` |

### 🟢 OK
- `ManagementReport.STAGE_ORDER` (`:56-60`) inclui 10 setores corretos
- `FinanceReportsTab` Aging OK
- `SmartDashboard` data-driven OK
- `UnitAudit`, `SaleOrdersConsumption`, `BaseConsumption`, `MaterialConsumption`, `ProducaoDashboard` OK

---

## RESUMO POR SEVERIDADE

| Severidade | Reserva | Prazo | Paralel | OS/OC | Fichas | Relat | **TOTAL** |
|---|---|---|---|---|---|---|---|
| 🔴 Crítico | 4 | 3 | 4 | 3 | 2 | 3 | **19** |
| 🟠 Alto | 5 | 2 | 4 | 3 | 3 | 3 | **20** |
| 🟡 Médio | 3 | 3 | 4 | 3 | 3 | 3 | **19** |
| 🟢 Obs | 5 | 3 | 2 | 3 | 6 | 6 | **25** |

---

## SISTEMAS QUE FUNCIONAM (não confundir)

- ✅ Engine matemático de `compute_wave_timeline` PR3 paralelismo
- ✅ Trigger `tg_strip_cut_sectors_when_ready_made` cobre Costura
- ✅ Fichas novas (Silk/Mont/Cost/Aviam/Acab via genérica + Palmilha + Solagem + Expedição + ManagementReport) e print styles A4
- ✅ Aging de Contas a Receber/Pagar
- ✅ SmartDashboard, UnitAudit, ProducaoDashboard, Consumption pages
- ✅ Idempotência de `useCreatePurchaseOrder` por hash (parcial)
- ✅ Buscador top global (após fixes desta sessão)

---

## PLANO DE FIX

### Aplicar agora (baixo risco, dropdown labels e listas hardcoded)
1. **S1**: adicionar Costura em `DEFAULT_SECTOR_NAMES` (3 lugares)
2. **S2**: `ProductionPipeline.tsx` adicionar Costura + renomear Mesa→Aviamento
3. **S5/F2**: `sectorBottleneck.ts` corrigir mapping Costura
4. **S6**: `SECTOR_NORMALIZE` remover legacy `costura → corte_forracao`
5. **S7**: `SECTOR_ICONS` completar 7 setores faltantes em `SectorOverloadDialog`
6. **S8**: Orders XLS export adicionar `costura` em `STAGE_ORDER_XLS`
7. **S9**: `CapacityPlanning.tsx` adicionar Costura na lista
8. **S12**: `OrderStagesPipeline.tsx` Costura/Aviamento como canônicos
9. **F1**: `OperatorWorkSheet` Mesa→Aviamento hardcoded
10. **F3**: Costura em `SECTOR_META` do `OperatorWorkSheet`
11. **F4/F5**: `printSaleOrderOPs.ts` + `printSectorWorkSheet.ts` adicionar Costura + renomear Mesa
12. **R3/R5**: `ProductionScheduleTimeline` + `WaveBuilder` adicionar Costura + Mesa→Aviamento
13. **R9**: `MesaCapacityDialog` label

### Precisa plano (refactor SQL / migrations / lógica de negócio)
- **C1 (Reserva)**: chamar `try_reserve_materials` na aprovação inicial
- **C2 (Reserva)**: substituir `DELETE FROM material_reservations` por `UPDATE status='cancelled'` que dispara trigger
- **C3 (Reserva)**: nova migration pra ressincronizar `reserved_stock` (filtro correto)
- **C4 (Reserva)**: arrumar duplo decremento sole+grade
- **A1/A2 (Reserva)**: refatorar `debit_strap_stock` + `debit_packaging_for_order` pra usar `material_reservations`
- **P1-P3 (Prazo)**: consolidar 3 motores em wrappers do `compute_wave_timeline`
- **S3 (Paralel)**: trigger normalize ordem correta
- **S4 (Paralel)**: `finalize_production_sector` suportar início paralelo dos 3 prep
- **O1 (OS/OC)**: `cancelarPV` cancelar OC+OS vinculadas
- **O2 (OS/OC)**: trigger debit base ao criar OS
- **O3 (OS/OC)**: aplicar `conversion_rate` no dialog
- **R1/R2 (Relat)**: RCCPPlanning + GroupedReportSummary refatorar lista de setores via helper único

### Próxima rodada (melhorias UX)
- M1: modal claro "PV aprovado mas faltam X materiais — gerar OC?"
- M2: usar `useTryReserve` em algum lugar visível
- M3: invalidar `['products']` em todos callers de `release_order_reservations`
