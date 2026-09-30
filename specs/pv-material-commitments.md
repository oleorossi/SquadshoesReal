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
- Ateliê já faz soft `atelier_prep` (sem `order_id`) + OC `cabedal_prep` na
  aprovação — mas o resto do BOM não tem o mesmo relógio de “segurar + comprar”.
- Entrada de OC (`execute_purchase_order_command` receive) e NF/ajuste
  (`execute_stock_command` / `adjustStockSafe`) creditam só estoque **livre**.
- Rateio de recebimento→PV só existe para **tiras** (`purchase_receipt_allocations`).
- UI de reservas (`/reservas-estoque`) mostra OP, não “PV X precisa N m desta napa”.
- Risco se somar PV + Ateliê + OP soft sem netting: `reserved_stock` 2×/3×
  (exatamente o cuidado do grill: nem de menos nem de mais).

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
- Reescrita do Ateliê.

## Scope

### In scope

1. **Comprometimento na aprovação** — RPC que calcula consumo do PV (exclui
   solado), upsert de comprometimentos, netting com `atelier_prep` do mesmo
   `(sale_order_id, product_id)`.
2. **Uma conta de `reserved_stock`** — OP soft (`hybrid_debit`) **adota/pula**
   o que o PV já comprometeu; Ateliê continua com o gate atual
   (`tg_block_op_reserve_if_atelier_debited`) estendido ao PV commitment.
3. **Prioridade de cobertura** — helper com Ateliê/complexo primeiro, depois
   Monday da `billing_week`.
4. **OC automática** — estender `process_sale_order_purchase_shortages` (e
   efeitos em cancel) para ler comprometimentos; manter
   `process_cabedal_prep_purchase_shortages` / dublagem como canais
   especializados na frente no outbox.
5. **Entrada cobre demanda** — após receive OC e adjust/NF que sobe
   `quantity`, chamar cobertura dos comprometimentos abertos por prioridade;
   sobra permanece disponível.
6. **Recompute** em alteração/cancelamento do PV aprovado + ajuste de OC
   editável não recebida.
7. **UI** — visão por PV (consumo/picking) + visão por material (evoluir
   `/reservas-estoque`).
8. **Testes de contrato** — anti-2×, exclusão de solado, prioridade, cancel
   solta bloqueio, receive não inventa carimbo de lote.

### Out of scope

- Hard peg / `purchase_receipt_allocations` genérico para napa.
- Unificar solado no mesmo motor.
- Mudar fluxo Ateliê (cadastro, fila, débito rua, cartão).
- Religar `try_reserve_materials` como dono do confirm.

## Requirements

### Gatilho e conta única

1. Em `execute_sale_order_command` / confirm (mesma TX da materialização, **antes**
   do outbox de compra): `commit_sale_order_material_demand(sale_order_id)`.
2. Fonte de demanda: mesmo motor que `compute_materials_per_pv` / consumo canônico;
   **filtrar solado**.
3. Comprometimento conta em `products.reserved_stock` (status abertos).
4. `hybrid_debit_stock_for_order` no promote **não** cria soft duplicado para
   `(sale_order_id, product_id)` já coberto por PV commitment ou `atelier_prep`
   / ledger Ateliê.
5. UI e relatórios: um número de comprometido por SKU+PV (Ateliê aparece como
   origem/setor, não como segunda linha somável).

### Prioridade e rebalance

6. Escassez: ordenar PVs por (a) tem demanda Ateliê/complexa ativa no SKU
   (b) `resolve_billing_week_for_order` ASC (1º dia da semana).
7. Aumento de necessidade: `recompute_sale_order_material_commitments`; se
   preciso, reduzir soft de PV de prioridade **menor** (nunca hard-debitado /
   Ateliê já debitado na rua).

### Compra e entrada

8. Outbox pós-confirm: cabedal_prep → dublagem → per_pv (ordem atual); per_pv
   passa a nettar contra comprometimentos + físico.
9. Receive OC + adjust stock: `cover_open_material_commitments(product_id)` —
   só garante que `reserved_stock` / linhas abertas refletem a demanda; **não**
   cria allocation table de NF.
10. Cancel/alteração: `release_excess_*` + `adjust_unreceived_pos_for_sale_order_commitments`
    (estender digest/efeitos já existentes de per_pv).

### UX

11. Por PV: em Consumo / tela de separação — itens comprometidos, faltando,
    já debitados (Ateliê vs fábrica).
12. Por material: em `/reservas-estoque` (ou evolução) — físico, comprometido
    por PV, disponível; sem exigir OP.

## Constraints

- Bun; typecheck `bunx tsc -p tsconfig.app.json --noEmit`.
- Design tokens nas UIs novas (`bun run check:tokens`).
- Migration: carimbo > max(arquivo local, `schema_migrations`); duas fontes.
- Não reintroduzir perda de corte; não `lucide-react`.
- Reusar Ateliê RPCs intactas: `atelier_soft_reserve_for_job`,
  `atelier_confirm_job_debit`, `materialize_cabedal_prep_demands`,
  `process_cabedal_prep_purchase_shortages`.
- Compromisso deve nascer na **TX do confirm**, não só no outbox (evita race
  de OC antes das linhas existirem).

## Data model (alvo)

Preferência: **estender** `material_reservations` (uma conta que já mexe em
`reserved_stock`) em vez de tabela paralela que precise de segundo sync.

```
material_reservations
  + sale_order_id uuid NULL REFERENCES sale_orders(id)
  metadata.kind = 'pv_commitment' | 'atelier_prep' | … (já usado)
  order_id NULL enquanto só PV; preenchido ao adotar na OP (opcional)

-- helpers / RPCs
commit_sale_order_material_demand(p_sale_order_id)
recompute_sale_order_material_commitments(p_sale_order_id)
release_excess_sale_order_commitments(p_sale_order_id)
cover_open_material_commitments(p_product_id, p_qty?, p_movement_id?)
commitment_cover_priority(p_sale_order_id)  -- score/ordenção
list_material_commitments_by_pv(p_sale_order_id)
list_material_commitments_by_product(p_product_id)
```

Se estender a tabela gerar drift demais com straps/sole metadata, alternativa
aceitável: `sale_order_material_commitments` + trigger que espelha total aberto
em `reserved_stock` (mesmo invariante). Decisão na Phase 1 ao abrir a migration.

## Implementation phases

### Phase 1 — Conta única + commit na aprovação

- Migration: `sale_order_id` (ou tabela dedicada) + RPCs commit/recompute/release.
- Wire em confirm / cancel / rematerialize do command boundary.
- Anti-2×: hybrid soft adota/pula; gate Ateliê estendido.
- Contratos: anti-double-count, exclusão solado, cancel solta.

### Phase 2 — OC automática + cobertura na entrada

- Estender `process_sale_order_purchase_shortages` + efeitos de cancel.
- Hook receive OC + adjust stock → `cover_open_material_commitments`.
- Prioridade complexo → billing Monday.
- Rebalance em aumento de demanda.

### Phase 3 — UX operador

- Lista por PV (Consumo / picking).
- Lista por material (`StockReservations` + dialog com PV).
- Sinais de faltando / comprometido / disponível alinhados à conta única.

### Phase 4 — Verificação produção

- Deploy `main` → CI + Vercel.
- Browser em https://squadshoes-real.vercel.app: aprovar PV de teste (ou fluxo
  visível), conferir comprometimento, reservas por material, Ateliê intacto.
- Login bloqueando: reportar, não afirmar tela certa.

## Flow

```
PV → Aprovado
  ├─ (existente) materialize OPs + Ateliê soft/jobs
  ├─ commit_sale_order_material_demand  [NOVO — mesma TX]
  │     net atelier_prep / exclui solado / upsert pv_commitment
  └─ outbox: cabedal_prep OC → dublagem → per_pv OC (lê commitments)

Entrada OC/NF
  └─ sobe físico → cover_open_material_commitments (prioridade)
        sobra = disponível

Cancel/altera PV
  └─ recompute → release excess → adjust OC não recebida
```

## Success criteria (v1 = “está bom”)

1. PV aprovado compromete consumo (sem solado) sem duplicar Ateliê/OP.
2. Outro PV não consome do comprometido (bloqueio duro via disponível).
3. Falta abre/atualiza OC; compra a mais → sobra disponível após cobrir demandas.
4. Listas PV + material mostram a mesma conta.
5. Cancel/alteração atualiza demanda, solta bloqueio, ajusta OC aberta.
6. Ateliê segue funcionando; complexo ganha prioridade na escassez.
7. Typecheck app limpo; contratos anti-2× verdes.

## Open implementation notes (não são decisões de produto)

- Preferir coluna `sale_order_id` em `material_reservations` vs tabela nova —
  escolher na Phase 1 pelo menor risco de double-sync.
- `billing_week` é text polimórfico na UI; prioridade **sempre** via
  `resolve_billing_week_for_order`, nunca sort da string crua.
- Solado continua debitando/reservando no confirm atual — só fica **fora** do
  writer de `pv_commitment`; não apagar o fluxo de solado.
