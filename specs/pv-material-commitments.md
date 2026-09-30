# Comprometimento de material no PV (soft pegging)

## Goal

Na aprovação do PV, o sistema **compromete** o material necessário (tudo do
consumo **exceto solado**), **bloqueia** esse saldo para outro pedido não
tomar, **abre/atualiza OC** do que faltar, e mostra ao operador o que é do
pedido vs o que está livre — reusando o Ateliê de cabedal complexo como está,
com prioridade de cobertura: complexo primeiro, depois 1º dia da semana de
faturamento.

Padrão indústria (soft pegging): recebimento OC/NF sobe o **físico**; o
vínculo pedido↔material é **comprometimento de demanda**, não carimbo de lote
na NF.

## Background / Problem

- Hoje a reserva soft (`material_reservations`) nasce na **OP** via
  `hybrid_debit_stock_for_order` no promote/confirm — não há conta de
  comprometimento no PV.
- Ateliê soft (`atelier_prep`) e OC `cabedal_prep` rodam no **outbox async**
  **depois** do `hybrid_debit` — se somarmos `pv_commitment` sem netting, o
  `reserved_stock` 2×/3× (cuidado do grill: nem de menos nem de mais).
- Entrada de OC (`execute_purchase_order_command` receive) e NF/ajuste
  (`execute_stock_command` / `adjustStockSafe`) creditam só estoque **livre**.
- Rateio de recebimento→PV só existe para **tiras** (`purchase_receipt_allocations`).
- UI de reservas (`/reservas-estoque`) mostra OP, não “PV X precisa N m desta napa”.
- Cancel libera reserva da **OP**; não chama `atelier_release_soft_for_job`.
- `compute_materials_per_pv` **agrega sem** coluna `component` — filtrar solado
  depois dessa RPC é impossível.

## Settled decisions (grill 30/09/2026)

| # | Decisão |
|---|---|
| Núcleo | Sistema **universal**; cabedal complexo é o caso mais crítico **dentro** dele |
| Gatilho | Demanda na **aprovação** do PV; cancel/alteração **recompõe** |
| Modelo | Soft pegging indústria (sem carimbo de lote na NF no v1) |
| Bloqueio | **Duro** no saldo comprometido (`disponível = físico − comprometido`) |
| Ateliê | **Reusar** (`atelier_complex_references`, prep, OC `cabedal_prep`); não reescrever |
| Escopo material v1 | Tudo do consumo **exceto solado** |
| Cancel/alteração | Solta comprometimento excedente; tenta reduzir/cancelar OC **não recebida**; físico já na fábrica fica **disponível** |
| Âncora | Demanda do **PV** é fonte; OP espelha/adota — **uma conta** (anti-2× com Ateliê) |
| Prioridade escassez | (1) cabedal complexo / Ateliê (2) **1º dia** da `billing_week` (`resolve_billing_week_for_order`) |
| Compra | Falta → **OC automática** (estender canal outbox per_pv; manter cabedal_prep/dublagem) |
| UX | Lista por **PV** (picking) + lista por **material** (estoque) |
| Aumento de necessidade | Recompõe e **pode rebalancear** soft de PV de prioridade menor |
| Pronto (v1) | Comprometer → OC → entrada sobe físico → disponível/comprometido batem → listas → cancel atualiza; Ateliê intacto e na frente |

### Fora do v1 (de propósito)

- Carimbo físico de metros na NF (padrão tiras).
- Solado/grade no motor unificado.
- Reescrita do Ateliê (cadastro, fila, débito rua, cartão, Kanban).

### Decisões de integração (fechadas na auditoria do plano)

Estas não mudam o grill — amarram o plano ao código vivo:

| # | Integração |
|---|---|
| I1 | **Sequência anti-2×:** `commit_sale_order_material_demand` roda na TX do confirm **antes** do `hybrid_debit`. Ateliê continua no outbox; ao criar soft, **adota** a linha PV (não soma qty). |
| I2 | **Adotar ≠ somar:** `atelier_soft_reserve_for_job` e `hybrid_debit` **nunca** incrementam `reserved_stock` se já existe aberto `(sale_order_id, product_id)` — só anexam `order_id` / `metadata.job_id` / `kind`. |
| I3 | **Filtro solado:** writer lê consumo **explodido** (`component <> 'Solado'`) — **proibido** filtrar só via `compute_materials_per_pv` (perde `component`). Fluxo `debit_sole_stock_by_grade` permanece intacto e **fora** do writer. |
| I4 | **Tiras artesanais:** continuam no ledger de tiras (`sale_order_strap_demand` / receipt allocations). Writer de `pv_commitment` **exclui** SKUs já cobertos por demanda de tira do mesmo PV (anti-2× com strap). Embalagem/BOM comum **entra**. |
| I5 | **Dublagem:** canal OC `process_dublagem_purchase_shortages` permanece à frente no outbox; SKU acabado de dublagem **não** gera linha per_pv duplicada (já excluído hoje); commitment cobre a face/consumo canônico, não a OC de serviço. |
| I6 | **Cancel:** além de `release_order_reservations(OP)`, chama release de `pv_commitment` do PV + `atelier_release_soft_for_job` para jobs abertos do PV. Hard debit Ateliê já na rua **não** some sozinho — fica disponível só o soft; estorno hard continua regra Ateliê. |
| I7 | **billing_week NULL:** prioridade (1) Ateliê/complexo (2) Monday de `resolve_billing_week_for_order` ASC (3) `delivery_deadline` ASC (4) `approved_at` / created ASC. NULL de billing **nunca** ganha de quem tem semana. |
| I8 | **cover na entrada** não cria allocation table; só garante que demandas abertas continuam refletidas em `reserved_stock` quando o físico sobe (disponível cresce pela sobra). Call sites: PO `receive`, `execute_stock_command` adjust inbound, caminhos NF que creditam estoque. |

## Scope

### In scope

1. Comprometimento na aprovação (TX confirm) + recompute em alteração/cancel.
2. Uma conta `reserved_stock` com adopt OP/Ateliê (I1–I2).
3. Prioridade de cobertura (I7) + rebalance em aumento.
4. OC automática per_pv lendo commitments; cabedal_prep/dublagem intactos.
5. Hook de cobertura na entrada (I8).
6. UI por PV + por material.
7. Contratos anti-2×, exclusão solado/tiras, cancel, prioridade.

### Out of scope

- Hard peg / `purchase_receipt_allocations` genérico para napa.
- Unificar solado no mesmo motor.
- Mudar fluxo Ateliê de produto.
- Religar `try_reserve_materials` como dono do confirm.

## Integration map (código vivo → plano)

### A. Confirm / materialização

| Passo vivo hoje | Onde | Mudança |
|---|---|---|
| `execute_sale_order_command` `confirm` | mig `20270101010400` (+ patches) | Após plan revision, **antes** de promover itens: `commit_sale_order_material_demand` |
| `promote_sale_order_item` → `hybrid_debit_stock_for_order` | mig `20261116120200` / `20270101022600` | Soft: **adopt/skip** se `pv_commitment` ou `atelier_prep`/ledger cobrir `(sale_order_id, product_id)` |
| Outbox `sale_order.confirmed` | `process-sale-order-outbox` | Ordem mantida: financial → cabedal_prep → dublagem → per_pv |
| `materialize_cabedal_prep_demands` → `atelier_soft_reserve_for_job` | mig `20270101029100` | Soft Ateliê **adota** linha PV (I2); não cria segunda qty |
| `process_cabedal_prep_purchase_shortages` | outbox | Intacto (canal especializado) |
| `process_dublagem_purchase_shortages` | outbox | Intacto |
| `process_sale_order_purchase_shortages` | mig `20270101010900` | Shortage = demanda commitment − físico líquido; digest cancel lê commitments |

### B. Alteração com PV `Aprovado` / `Em Produção`

| Evento | Comando vivo | Plano |
|---|---|---|
| Novo item | update → promote item | `recompute` do PV após promote do item |
| Qty/cor/variante (OP existente) | pode exigir teardown/resync (`PZ109`) | Após resync/teardown bem-sucedido → `recompute`; **não** fingir rematerialize silencioso |
| Remoção de item | teardown OP | `recompute` + release excess + adjust OC |
| Cancel PV | `cancel_sale_order_atomic_internal` | I6 + digest per_pv (já cancela OC não recebida quando desired vazio) |

### C. Entrada de estoque

| Porta | Arquivo / RPC | Plano |
|---|---|---|
| OC receive | `execute_purchase_order_command` | Após ↑ `quantity` → `cover_open_material_commitments(product_id)` |
| NF via OC | `src/lib/nfPoReceipt.ts` | Coberto pelo receive (não duplicar) |
| Ajuste / NF avulsa que credita | `adjustStockSafe` → `execute_stock_command` | Mesmo cover quando movimento é entrada |
| Tiras | `register_strap_purchase_receipt` | **Não** misturar; ledger de tiras permanece |

### D. Leitores de disponível (bloqueio duro)

Todos devem continuar em `quantity − reserved_stock` (já é o padrão). Após Phase 1, `reserved_stock` inclui `pv_commitment`. Conferir regressão em:

- `compute_materials_per_pv` / per_pv UI
- `StockReservations` / `product_stock_with_reservations`
- Consumo PV (`consumptionAvailability` / `netStock`)
- `check_stock_availability` / badges
- Picking / liberação

### E. UI

| Necessidade | Superfície | Extensão |
|---|---|---|
| Por material | [`StockReservations.tsx`](src/pages/StockReservations.tsx) + [`ProductReservationDetailsDialog.tsx`](src/components/inventory/ProductReservationDetailsDialog.tsx) | Mostrar PV mesmo com `order_id` NULL; kinds `pv_commitment` / `atelier_prep` |
| Por PV | [`SummaryConsumptionPanel.tsx`](src/components/sale-orders/SummaryConsumptionPanel.tsx) + picking | Comprometido / faltando / debitado Ateliê vs fábrica via `list_material_commitments_by_pv` |
| Ateliê | [`Atelie.tsx`](src/pages/Atelie.tsx) / prep section | Sem redesign; só garantir que soft adopt não quebra fila |

## Requirements

### Gatilho e conta única

1. Em `execute_sale_order_command` confirm: `commit_sale_order_material_demand` **antes** do hybrid (I1).
2. Fonte de demanda: consumo explodido com `component <> 'Solado'`; excluir SKUs de tira já no strap demand (I3–I4).
3. Comprometimento conta em `products.reserved_stock` (status abertos).
4. `hybrid_debit` e `atelier_soft_reserve_for_job` **adotam/pulam** (I2); estender `tg_block_op_reserve_if_atelier_debited` (ou irmão) para `pv_commitment`.
5. UI: um número comprometido por SKU+PV; Ateliê é origem/setor, não segunda soma.

### Prioridade e rebalance

6. Ordenação I7.
7. Aumento: `recompute_sale_order_material_commitments` + rebalance soft de PV de prioridade menor; **nunca** roubar Ateliê já hard-debitado / soft `consumed` / hard OP.

### Compra e entrada

8. Outbox: cabedal_prep → dublagem → per_pv; per_pv netta commitments.
9. Cover nos call sites C (I8) — sem allocation table.
10. Cancel/alteração: I6 + digest OC não recebida.

### UX

11. Por PV: comprometido / faltando / debitado (Ateliê vs fábrica).
12. Por material: físico / comprometido por PV / disponível.

## Constraints

- Bun; typecheck `bunx tsc -p tsconfig.app.json --noEmit`.
- Design tokens nas UIs novas (`bun run check:tokens`).
- Migration: carimbo > max(arquivo local, `schema_migrations`); duas fontes.
- Não reintroduzir perda de corte; não `lucide-react`.
- Reusar Ateliê RPCs de produto; só patch de **adopt** em `atelier_soft_reserve_for_job` (comportamento interno, não redesign).
- Compromisso na **TX do confirm**, não só no outbox.

## Data model (alvo)

Preferência: **estender** `material_reservations`.

```
material_reservations
  + sale_order_id uuid NULL REFERENCES sale_orders(id)
  index (sale_order_id, product_id) WHERE status IN ('reserved','partially_consumed')
  metadata.kind ∈ { pv_commitment, atelier_prep, sole_grade, … }
  order_id NULL no PV; preenchido no adopt da OP
  metadata.job_id no adopt Ateliê

RPCs
  commit_sale_order_material_demand(p_sale_order_id)
  recompute_sale_order_material_commitments(p_sale_order_id)
  release_excess_sale_order_commitments(p_sale_order_id)
  cover_open_material_commitments(p_product_id, p_qty?, p_movement_id?)
  commitment_cover_priority(p_sale_order_id)  -- score I7
  list_material_commitments_by_pv(p_sale_order_id)
  list_material_commitments_by_product(p_product_id)
  rebalance_material_commitments_for_product(p_product_id)  -- aumento
```

Alternativa só se a coluna gerar drift: `sale_order_material_commitments` + trigger espelhando em `reserved_stock`. Decisão na Phase 1.

## Implementation phases (checklist integrado)

### Phase 1 — Conta única + commit + anti-2×

- [ ] Migration: `sale_order_id` + índice + RPCs commit/recompute/release
- [ ] Wire commit **antes** hybrid no confirm (`execute_sale_order_command`)
- [ ] hybrid adopt/skip + gate estendido a `pv_commitment`
- [ ] Patch adopt em `atelier_soft_reserve_for_job` (outbox, sem redesign)
- [ ] Cancel: release PV commitments + `atelier_release_soft_for_job` (I6)
- [ ] Update/resync paths: `recompute` após material plan sucesso
- [ ] Contratos: first confirm sem 2×; Ateliê adopt; solado fora do writer; tiras fora; cancel solta soft

**Done Phase 1:** PV aprovado tem comprometimento; `reserved_stock` não triplica; Ateliê/OP adotam.

### Phase 2 — OC + entrada + prioridade + rebalance

- [ ] `process_sale_order_purchase_shortages` lê commitments; digest cancel idem
- [ ] cabedal_prep / dublagem intactos e à frente
- [ ] `cover_open_material_commitments` em PO receive + stock adjust inbound
- [ ] Prioridade I7 + `rebalance_material_commitments_for_product`
- [ ] Contratos: OC sobe na falta; compra a mais → disponível sobra; rebalance não toca hard Ateliê; billing NULL por último

**Done Phase 2:** falta compra; entrada aumenta disponível sem carimbo; escassez respeita complexo → semana.

### Phase 3 — UX operador

- [ ] `list_material_commitments_by_pv` no Consumo / picking
- [ ] `list_material_commitments_by_product` em `/reservas-estoque` + dialog (PV sem OP)
- [ ] Mesmos números que `reserved_stock` / disponível
- [ ] `bun run check:tokens` nas telas tocadas

**Done Phase 3:** operador separa por PV; estoque vê por material.

### Phase 4 — Verificação produção

- [ ] Merge → CI verde → deploy Vercel production
- [ ] Browser em https://squadshoes-real.vercel.app: aprovar/alterar fluxo visível; listas; Ateliê fila intacta
- [ ] Login bloqueando: reportar, **não** afirmar tela certa
- [ ] Hard refresh / PWA se parecer build antigo

**Done Phase 4:** critério de “foi para o site” do dono.

## Flow (integrado ao vivo)

```
PV → confirm (mesma TX)
  1. persist material plan
  2. commit_sale_order_material_demand     [NOVO — antes do hybrid]
        consumo explodido − Solado − tiras strap
        upsert pv_commitment → reserved_stock
  3. promote items → hybrid_debit (adopt/skip) + sole (intact)
  4. enqueue outbox sale_order.confirmed

Outbox (async, ordem atual)
  5. financial
  6. cabedal_prep: materialize demands + atelier_soft (ADOTA pv_commitment)
       + OC source_type=cabedal_prep
  7. dublagem shortages
  8. per_pv shortages (lê commitments)

Entrada OC/NF/adjust inbound
  9. sobe products.quantity
 10. cover_open_material_commitments (prioridade I7)
        sobra = disponível

Cancel / alteração
 11. recompute / release excess
 12. atelier_release_soft_for_job (jobs abertos)
 13. digest OC per_pv não recebida
```

## Double-count matrix (alvo)

| Camada | Momento | Conta em reserved_stock? | Regra |
|---|---|---|---|
| `pv_commitment` | confirm TX passo 2 | sim (fonte) | uma linha por (PV, product) aberta |
| `atelier_prep` | outbox passo 6 | **não soma** | adopt da linha PV / metadata.job_id |
| OP soft hybrid | confirm passo 3 | **não soma** | adopt `order_id` ou skip |
| Solado | confirm | sim (kinds sole_*) | fora do writer PV; fluxo atual |
| Tira strap | strap path | ledger próprio | fora do writer PV |

## Success criteria (v1)

1. PV aprovado compromete consumo (sem solado/tiras strap) sem duplicar Ateliê/OP.
2. Outro PV não toma do comprometido (`disponível`).
3. Falta abre/atualiza OC; compra a mais → sobra disponível.
4. Listas PV + material = mesma conta.
5. Cancel/alteração atualiza demanda, solta soft, ajusta OC aberta; hard Ateliê segue regra Ateliê.
6. Ateliê intacto; complexo na frente na escassez; billing NULL por último.
7. Typecheck app limpo; contratos anti-2× verdes.
8. Verificado no site live (Phase 4).

## Open implementation notes

- Coluna `sale_order_id` vs tabela espelho: decidir na Phase 1 pelo menor risco de double-sync.
- `billing_week` text polimórfico: prioridade **sempre** via `resolve_billing_week_for_order`.
- Solado/tiras: fluxos atuais permanecem; só ficam fora do writer `pv_commitment`.
