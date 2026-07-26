-- =============================================================================
-- Relatório financeiro de Ordens de Serviço por prestador (2026-07-26)
--
-- PROBLEMA: `v_contractor_metrics.total_value_paid` NUNCA consultou
-- `accounts_payable` — somava OS com status Concluído/received/finalizado. Ou
-- seja: OS entregue e NÃO paga aparecia como "paga" no relatório de
-- /terceirizados?tab=relatorio. Para um relatório financeiro isso é erro
-- material (o prestador cobra de novo e o número do dashboard defende o erro).
--
-- FONTE DE VERDADE DO DINHEIRO: `accounts_payable` com
-- reference_type='service_order' e reference_id = service_orders.id. Há no
-- máximo UMA AP por OS — índice único parcial `uq_ap_per_service_order`
-- (reference_id) WHERE reference_type='service_order', que vale para QUALQUER
-- status, inclusive 'cancelled'. Por isso o LEFT JOIN simples abaixo não
-- multiplica linha.
--
-- QUANDO A AP NASCE: no gatilho de finalização da OS — e imediatamente no caso
-- da OS avulsa (`useAvulso.ts`). Consequência importante para o relatório: OS
-- ainda aberta legitimamente NÃO tem conta a pagar. Isso não é anomalia, é o
-- estado normal ("ainda não faturado") e precisa ser distinguido do caso em que
-- a OS foi finalizada e a AP não existe (aí sim é falha).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) View nova: 1 linha por OS não cancelada, com o estado real de pagamento
--
-- Não reusa `v_contractor_history_orders` de propósito: aquela view filtra
-- `WHERE so.status IN (finalizadas)`, o que esconderia justamente as OS abertas
-- e as avulsas pendentes — que são metade da pergunta "o que ainda não paguei".
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_contractor_os_financials
WITH (security_invoker = true) AS
SELECT
  b.*,
  (b.payment_state = 'unpaid' AND b.due_date IS NOT NULL AND b.due_date < CURRENT_DATE)
                                                         AS is_overdue,
  CASE
    WHEN b.payment_state = 'unpaid' AND b.due_date IS NOT NULL AND b.due_date < CURRENT_DATE
    THEN (CURRENT_DATE - b.due_date)
    ELSE 0
  END                                                    AS days_overdue
FROM (
  SELECT
    so.id                                                AS os_id,
    so.order_number                                      AS order_number,
    so.contractor_id                                     AS contractor_id,
    COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, ''), '—') AS contractor_name,
    c.service_type                                       AS service_type,
    COALESCE(NULLIF(so.target_sector, ''), NULLIF(so.sector, ''), 'costura') AS sector,
    so.description                                       AS description,
    so.is_avulsa                                         AS is_avulsa,
    so.status                                            AS os_status,
    so.quantity                                          AS quantity,
    so.total_value                                       AS total_value,

    -- Conta a pagar vinculada (no máximo uma — ver índice único no cabeçalho)
    ap.id                                                AS ap_id,
    ap.status                                            AS ap_status,
    ap.amount                                            AS ap_amount,
    ap.amount_paid                                       AS ap_amount_paid,
    ap.payment_method                                    AS payment_method,

    -- Valor de referência: o que a conta cobra quando ela existe; senão o valor
    -- da própria OS (OS aberta ainda não gerou conta).
    COALESCE(ap.amount, so.total_value)                  AS amount_due,
    -- Valor efetivamente pago. `amount_paid` nem sempre é preenchido na
    -- quitação, então cai para `amount` quando está zerado — subestimar
    -- pagamento é pior que arredondar para o valor da conta.
    CASE
      WHEN ap.status = 'paid' THEN COALESCE(NULLIF(ap.amount_paid, 0), ap.amount)
      ELSE 0
    END                                                  AS amount_paid_effective,

    -- Três eixos de data — o frontend escolhe por qual filtrar o período.
    so.service_date                                      AS service_date,
    COALESCE(ap.due_date, so.payment_due_date)           AS due_date,
    ap.payment_date                                      AS payment_date,
    COALESCE(so.delivered_at, so.receipt_generated_at, so.updated_at) AS finished_at,

    CASE
      WHEN ap.id IS NOT NULL AND ap.status = 'paid'      THEN 'paid'
      WHEN ap.id IS NOT NULL AND ap.status = 'cancelled' THEN 'ap_cancelled'
      WHEN ap.id IS NOT NULL                             THEN 'unpaid'
      WHEN so.status = ANY (ARRAY[
        'Concluído','Concluido','concluido','received','finalizado','Finalizado'
      ])                                                 THEN 'missing_ap'
      ELSE 'not_billed'
    END                                                  AS payment_state
  FROM public.service_orders so
  LEFT JOIN public.contractors c
    ON c.id = so.contractor_id
  LEFT JOIN public.accounts_payable ap
    ON ap.reference_type = 'service_order'
   AND ap.reference_id   = so.id
  WHERE so.status <> ALL (ARRAY['Cancelado','cancelled','cancelado','estornado'])
) b;

COMMENT ON VIEW public.v_contractor_os_financials IS
  'Uma linha por OS não cancelada com o estado REAL de pagamento, vindo de accounts_payable '
  '(reference_type=service_order). payment_state: paid = conta quitada · unpaid = conta em aberto · '
  'not_billed = OS ainda aberta, sem conta (normal — a AP nasce na finalização) · '
  'missing_ap = OS finalizada SEM conta a pagar (anomalia, investigar o gatilho) · '
  'ap_cancelled = conta cancelada com a OS ativa (anomalia). Expõe service_date, due_date e '
  'payment_date como colunas para o relatório filtrar o período por qualquer um dos três eixos. '
  'Usada por /terceirizados?tab=relatorio.';

GRANT SELECT ON public.v_contractor_os_financials TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) `v_contractor_metrics`: total_value_paid passa a significar DINHEIRO PAGO
--
-- Definição preservada integralmente (inclusive as colunas de devolução que a
-- migration 20260722200000 acrescentou); mudam só:
--   · total_value_paid      → agora soma accounts_payable quitadas
--   · total_value_completed → NOVA, guarda o significado antigo (OS concluída),
--                             que continua sendo métrica de produção legítima
--   · total_value_unpaid    → NOVA, contas em aberto (o que se deve ao prestador)
-- Colunas novas vão no FIM para não quebrar o CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_contractor_metrics
WITH (security_invoker = true) AS
SELECT
  c.id                                                   AS contractor_id,
  COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, ''), '—') AS contractor_name,
  c.service_type,
  c.active,
  count(so.id)                                           AS total_orders,
  count(so.id) FILTER (WHERE so.status = ANY (ARRAY['Concluído','Concluido','concluido','received','finalizado','Finalizado'])) AS completed_orders,
  count(so.id) FILTER (WHERE so.status = ANY (ARRAY['Cancelado','cancelled','cancelado'])) AS cancelled_orders,
  count(so.id) FILTER (WHERE so.status <> ALL (ARRAY['Concluído','Concluido','concluido','received','finalizado','Finalizado','Cancelado','cancelled','cancelado'])) AS open_orders,
  count(so.id) FILTER (WHERE (so.status = ANY (ARRAY['Concluído','Concluido','concluido','received','finalizado','Finalizado'])) AND so.quoted_deadline IS NOT NULL AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) <= so.quoted_deadline) AS on_time_count,
  count(so.id) FILTER (WHERE (so.status = ANY (ARRAY['Concluído','Concluido','concluido','received','finalizado','Finalizado'])) AND so.quoted_deadline IS NOT NULL AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline) AS late_count,
  count(so.id) FILTER (WHERE (so.status <> ALL (ARRAY['Concluído','Concluido','concluido','received','finalizado','Finalizado','Cancelado','cancelled','cancelado'])) AND so.quoted_deadline IS NOT NULL AND so.quoted_deadline < CURRENT_DATE) AS open_overdue_count,
  COALESCE(avg(
    CASE
      WHEN (so.status = ANY (ARRAY['Concluído','Concluido','concluido','received','finalizado','Finalizado'])) AND so.quoted_deadline IS NOT NULL AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline
      THEN COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) - so.quoted_deadline
      ELSE NULL::integer
    END), 0::numeric)::numeric(10,1)                     AS avg_late_days,
  COALESCE(sum(CASE WHEN so.status <> ALL (ARRAY['Cancelado','cancelled','cancelado']) THEN so.total_value ELSE 0::numeric END), 0::numeric) AS total_value_all,

  -- ⚠ MUDANÇA DE SIGNIFICADO: dinheiro efetivamente pago (accounts_payable).
  COALESCE(max(fin.paid_amount), 0::numeric)             AS total_value_paid,

  COALESCE(sum(CASE WHEN so.status <> ALL (ARRAY['Concluído','Concluido','concluido','received','finalizado','Finalizado','Cancelado','cancelled','cancelado']) THEN so.total_value ELSE 0::numeric END), 0::numeric) AS total_value_open,
  COALESCE(sum(CASE WHEN so.status <> ALL (ARRAY['Cancelado','cancelled','cancelado']) THEN so.quantity ELSE 0 END), 0::bigint) AS total_quantity,
  max(so.created_at)                                     AS last_order_at,
  COALESCE(max(ret.qty_good), 0::bigint)                 AS total_returned_good,
  COALESCE(max(ret.qty_defect), 0::bigint)               AS total_returned_defect,
  COALESCE(max(ret.qty_loss), 0::bigint)                 AS total_returned_loss,
  CASE
    WHEN (COALESCE(max(ret.qty_good), 0::bigint) + COALESCE(max(ret.qty_defect), 0::bigint)) > 0
    THEN round(100.0 * COALESCE(max(ret.qty_defect), 0::bigint)::numeric / (COALESCE(max(ret.qty_good), 0::bigint) + COALESCE(max(ret.qty_defect), 0::bigint))::numeric, 1)
    ELSE NULL::numeric
  END                                                    AS defect_pct,

  -- NOVAS (no fim, para o CREATE OR REPLACE aceitar)
  COALESCE(sum(CASE WHEN so.status = ANY (ARRAY['Concluído','Concluido','concluido','received','finalizado','Finalizado']) THEN so.total_value ELSE 0::numeric END), 0::numeric) AS total_value_completed,
  COALESCE(max(fin.unpaid_amount), 0::numeric)           AS total_value_unpaid
FROM contractors c
LEFT JOIN service_orders so
  ON so.contractor_id = c.id
LEFT JOIN (
  SELECT so2.contractor_id,
         sum(r.qty_good)   AS qty_good,
         sum(r.qty_defect) AS qty_defect,
         sum(r.qty_loss)   AS qty_loss
  FROM service_order_returns r
  JOIN service_orders so2 ON so2.id = r.service_order_id
  GROUP BY so2.contractor_id
) ret ON ret.contractor_id = c.id
LEFT JOIN (
  SELECT so3.contractor_id,
         sum(CASE WHEN ap.status = 'paid' THEN COALESCE(NULLIF(ap.amount_paid, 0), ap.amount) ELSE 0::numeric END) AS paid_amount,
         sum(CASE WHEN ap.status <> ALL (ARRAY['paid','cancelled']) THEN ap.amount ELSE 0::numeric END)            AS unpaid_amount
  FROM accounts_payable ap
  JOIN service_orders so3 ON so3.id = ap.reference_id
  WHERE ap.reference_type = 'service_order'
  GROUP BY so3.contractor_id
) fin ON fin.contractor_id = c.id
GROUP BY c.id, c.trade_name, c.name, c.service_type, c.active;

COMMENT ON VIEW public.v_contractor_metrics IS
  'Métricas all-time agregadas por contractor. ATENÇÃO (2026-07-26): total_value_paid agora é '
  'DINHEIRO EFETIVAMENTE PAGO (accounts_payable quitadas) — antes somava OS concluídas, o que '
  'fazia OS entregue e não paga contar como paga. O significado antigo virou total_value_completed. '
  'total_value_unpaid = contas em aberto. Filtro de período aplica-se no frontend; para o '
  'relatório financeiro por período use v_contractor_os_financials.';

GRANT SELECT ON public.v_contractor_metrics TO authenticated;
