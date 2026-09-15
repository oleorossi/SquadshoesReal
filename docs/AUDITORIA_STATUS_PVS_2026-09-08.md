# Auditoria de status dos Pedidos de Venda — 2026-09-08

## Escopo

Relatório **somente-leitura** (opção 1 do pedido): para cada PV ativo,
se o cancelamento automático (e Aprovado→Rascunho) passa, e o motivo
quando não passa. Sem afrouxar a regra de fato físico no path default.

## Path compensatório (2026-09-09)

Migration `20270101022300_sale_order_compensatory_cancel_physical_fact`:

| Peça | Papel |
|---|---|
| `sale_order_physical_fact_blockers(pv)` | Blockers com **nº da OP** + `fact_kinds` |
| `preflight_sale_order_command` | Anexa blockers em `cancel` e Aprovado→Rascunho |
| `cancel_sale_order_atomic_internal` | Default RAISE com order_number; GUC compensatório chama `cancel_production_order_internal` |
| `execute_sale_order_command` | Gate admin + motivo ≥15 + `payload.compensatory=true` |
| UI `AdminCompensatoryCancelDialog` | Só admin; checklist + motivo |

Cancel automático **continua** recusando fato físico (PZ105). Compensatório
ainda recusa NF-e ativa (PZ112) e OP Finalizado/Concluído.

## Ferramenta

| Arquivo | Papel |
|---|---|
| [`sql-scripts/audit-sale-order-status-transitions.sql`](../sql-scripts/audit-sale-order-status-transitions.sql) | Fonte da verdade — cole no SQL Editor |
| [`scripts/run-audit-sale-order-status.mjs`](../scripts/run-audit-sale-order-status.mjs) | Runner opcional com `SUPABASE_SERVICE_ROLE_KEY` |
| [`src/__tests__/auditSaleOrderStatusTransitions.contract.test.ts`](../src/__tests__/auditSaleOrderStatusTransitions.contract.test.ts) | Trava que o SQL espelha o cancel atômico |

Espelha `cancel_sale_order_atomic_internal` (+ helper de blockers na mig 22300):

| Código | Significado |
|---|---|
| `ok` | Pode cancelar (restaura estoque reversível e cancela OPs) |
| `PZ112` | NF-e `autorizada` / `processando` / `cancelando` |
| `PZ105_op_finalizada` | Alguma OP já Finalizado/Concluído |
| `PZ105_fato_fisico` | OP aberta com etapa/lote/reserva consumida/consumo |
| `PZ110_status` | Status do PV fora do allow-list do cancel |
| `ja_cancelado` | Já Cancelado |

**Fato físico** (qualquer um basta na OP):

- `order_stages`: `quantity_processed > 0` ou `started_at`/`completed_at` ou status ≠ pendente
- `order_lots`: iniciado/concluído ou status ≠ pendente
- `material_reservations`: consumida / convertida / `pending_reconciliation`
- `production_consumptions`: `actual_quantity > 0` (não superseded)

Reserva só `reserved` **não** bloqueia.

## Como executar

```text
https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/sql/new
```

Cole o SQL → Run. A saída traz seção `resumo` (totais por código) e
`detalhe` (uma linha por PV).

## Achado confirmado — PV-00139 / OP-2026-01146

Toast legado (UUID):

> Erro: OP ab7e391d-… possui fato físico; cancelamento automático recusado

Isso é **PZ105_fato_fisico** — comportamento esperado do writer default.
Após a mig 22300, preflight/cancel usam **OP-2026-01146** + `stage`.

### Probe read-only (2026-09-09)

Confirmado: `sale_order_physical_fact_blockers` / preflight `cancel` do
**PV-00139** (Em Produção) devolvem:

- `ready: false`
- `OP-2026-01146` com `fact_kinds: ["stage"]`
- mensagem: `OP OP-2026-01146 possui fato físico (stage); cancelamento automático recusado`

**Não cancelar** o PV em produção só para “provar” o path; o probe de
preflight basta.

## O que NÃO muda no default

- Cancel automático com fato físico continua recusado
- NF-e ativa e OP Finalizado continuam barrados mesmo no compensatório
