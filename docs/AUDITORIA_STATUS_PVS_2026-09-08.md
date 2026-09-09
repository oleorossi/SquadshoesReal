# Auditoria de status dos Pedidos de Venda — 2026-09-08

## Escopo

Relatório **somente-leitura** (opção 1 do pedido): para cada PV ativo,
se o cancelamento automático (e Aprovado→Rascunho) passa, e o motivo
quando não passa. Sem afrouxar a regra de fato físico e sem tela nova.

## Ferramenta

| Arquivo | Papel |
|---|---|
| [`sql-scripts/audit-sale-order-status-transitions.sql`](../sql-scripts/audit-sale-order-status-transitions.sql) | Fonte da verdade — cole no SQL Editor |
| [`scripts/run-audit-sale-order-status.mjs`](../scripts/run-audit-sale-order-status.mjs) | Runner opcional com `SUPABASE_SERVICE_ROLE_KEY` |
| [`src/__tests__/auditSaleOrderStatusTransitions.contract.test.ts`](../src/__tests__/auditSaleOrderStatusTransitions.contract.test.ts) | Trava que o SQL espelha o cancel atômico |

Espelha `cancel_sale_order_atomic_internal`
(`supabase/migrations/20270101010400_atomic_sale_order_promotion_command.sql`):

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

Alternativa (Actions):

```bash
gh workflow run "Supabase — Exec SQL file (Management API)" \
  --ref cursor/audit-sale-order-status-1272 \
  -f sql_path=sql-scripts/audit-sale-order-status-transitions.sql
```

## Achado já confirmado (print do usuário)

Toast:

> Erro: OP ab7e391d-d325-467e-a383-576e79311e6c possui fato físico;
> cancelamento automático recusado

Isso é **PZ105_fato_fisico** — comportamento esperado do writer, não
falha de UI. O PV pai dessa OP **não** cancela pelo dropdown até o fato
físico ser resolvido (ou decisão explícita de mudar a regra — fora de
escopo desta auditoria).

Na execução do SQL, a linha desse PV deve aparecer com
`cancel_block_code = PZ105_fato_fisico` e `cancel_block_detail` listando
a OP + o tipo (`stage` / `lot` / `reservation` / `consumption`).

## Censo completo

Bloqueado neste ambiente cloud: sem `SUPABASE_ACCESS_TOKEN` /
`SUPABASE_SERVICE_ROLE_KEY` e sem permissão de `workflow_dispatch`.
Assim que o SQL rodar, atualizar a tabela abaixo.

| cancel_block_code | qtd_pvs | pares |
|---|---|---|
| _pendente execução_ | — | — |

PVs que **não** podem cancelar (preencher após execução):

| order_number | status | código | detalhe |
|---|---|---|---|
| _(PV da OP ab7e391d…)_ | Em Produção? | PZ105_fato_fisico | OP ab7e391d… [tipo a confirmar no SQL] |

## O que NÃO muda

- Regra de cancelamento com fato físico
- UI de Pedidos / Diagnósticos
- Dados de produção
