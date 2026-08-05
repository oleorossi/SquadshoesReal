-- v_contractor_metrics: alinhar "Pago"/"Em aberto" à regra canônica de saldo.
--
-- O ranking de contratadas (ContractorReports) divergia do Financeiro quando a
-- conta a pagar estava PARCIALMENTE quitada:
--
--   unpaid_amount somava `ap.amount` CHEIO de toda linha não-paga, ignorando
--   `ap.amount_paid`. Uma OS de R$ 1.000 com R$ 600 já pagos aparecia como
--   R$ 1.000 "Em aberto" no ranking, enquanto o card do Financeiro mostrava os
--   R$ 400 corretos (src/lib/ledgerBalance.ts → openBalanceOf).
--
--   paid_amount, por sua vez, só contava linha com status='paid' — os R$ 600 do
--   exemplo não entravam em lugar nenhum. A parcial errava dos DOIS lados.
--
-- Agora espelha openBalanceOf: em aberto = amount - amount_paid (nunca negativo),
-- pago = o que de fato saiu do caixa. Mantido o fallback histórico
-- COALESCE(NULLIF(amount_paid,0), amount) para linhas marcadas 'paid' sem
-- amount_paid preenchido (dado legado) — sem ele essas OSs zerariam o "Pago".
--
-- Só o subselect `fin` muda; a lista de colunas da view é idêntica.

CREATE OR REPLACE VIEW public.v_contractor_metrics AS
 SELECT c.id AS contractor_id,
    COALESCE(NULLIF(c.trade_name, ''::text), NULLIF(c.name, ''::text), '—'::text) AS contractor_name,
    c.service_type,
    c.active,
    count(so.id) AS total_orders,
    count(so.id) FILTER (WHERE so.status = ANY (ARRAY['Concluído'::text, 'Concluido'::text, 'concluido'::text, 'received'::text, 'finalizado'::text, 'Finalizado'::text])) AS completed_orders,
    count(so.id) FILTER (WHERE so.status = ANY (ARRAY['Cancelado'::text, 'cancelled'::text, 'cancelado'::text])) AS cancelled_orders,
    count(so.id) FILTER (WHERE so.status <> ALL (ARRAY['Concluído'::text, 'Concluido'::text, 'concluido'::text, 'received'::text, 'finalizado'::text, 'Finalizado'::text, 'Cancelado'::text, 'cancelled'::text, 'cancelado'::text])) AS open_orders,
    count(so.id) FILTER (WHERE (so.status = ANY (ARRAY['Concluído'::text, 'Concluido'::text, 'concluido'::text, 'received'::text, 'finalizado'::text, 'Finalizado'::text])) AND so.quoted_deadline IS NOT NULL AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) <= so.quoted_deadline) AS on_time_count,
    count(so.id) FILTER (WHERE (so.status = ANY (ARRAY['Concluído'::text, 'Concluido'::text, 'concluido'::text, 'received'::text, 'finalizado'::text, 'Finalizado'::text])) AND so.quoted_deadline IS NOT NULL AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline) AS late_count,
    count(so.id) FILTER (WHERE (so.status <> ALL (ARRAY['Concluído'::text, 'Concluido'::text, 'concluido'::text, 'received'::text, 'finalizado'::text, 'Finalizado'::text, 'Cancelado'::text, 'cancelled'::text, 'cancelado'::text])) AND so.quoted_deadline IS NOT NULL AND so.quoted_deadline < CURRENT_DATE) AS open_overdue_count,
    COALESCE(avg(
        CASE
            WHEN (so.status = ANY (ARRAY['Concluído'::text, 'Concluido'::text, 'concluido'::text, 'received'::text, 'finalizado'::text, 'Finalizado'::text])) AND so.quoted_deadline IS NOT NULL AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline THEN COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) - so.quoted_deadline
            ELSE NULL::integer
        END), 0::numeric)::numeric(10,1) AS avg_late_days,
    COALESCE(sum(
        CASE
            WHEN so.status <> ALL (ARRAY['Cancelado'::text, 'cancelled'::text, 'cancelado'::text]) THEN so.total_value
            ELSE 0::numeric
        END), 0::numeric) AS total_value_all,
    COALESCE(max(fin.paid_amount), 0::numeric) AS total_value_paid,
    COALESCE(sum(
        CASE
            WHEN so.status <> ALL (ARRAY['Concluído'::text, 'Concluido'::text, 'concluido'::text, 'received'::text, 'finalizado'::text, 'Finalizado'::text, 'Cancelado'::text, 'cancelled'::text, 'cancelado'::text]) THEN so.total_value
            ELSE 0::numeric
        END), 0::numeric) AS total_value_open,
    COALESCE(sum(
        CASE
            WHEN so.status <> ALL (ARRAY['Cancelado'::text, 'cancelled'::text, 'cancelado'::text]) THEN so.quantity
            ELSE 0
        END), 0::bigint) AS total_quantity,
    max(so.created_at) AS last_order_at,
    COALESCE(max(ret.qty_good), 0::bigint) AS total_returned_good,
    COALESCE(max(ret.qty_defect), 0::bigint) AS total_returned_defect,
    COALESCE(max(ret.qty_loss), 0::bigint) AS total_returned_loss,
        CASE
            WHEN (COALESCE(max(ret.qty_good), 0::bigint) + COALESCE(max(ret.qty_defect), 0::bigint)) > 0 THEN round(100.0 * COALESCE(max(ret.qty_defect), 0::bigint)::numeric / (COALESCE(max(ret.qty_good), 0::bigint) + COALESCE(max(ret.qty_defect), 0::bigint))::numeric, 1)
            ELSE NULL::numeric
        END AS defect_pct,
    COALESCE(sum(
        CASE
            WHEN so.status = ANY (ARRAY['Concluído'::text, 'Concluido'::text, 'concluido'::text, 'received'::text, 'finalizado'::text, 'Finalizado'::text]) THEN so.total_value
            ELSE 0::numeric
        END), 0::numeric) AS total_value_completed,
    COALESCE(max(fin.unpaid_amount), 0::numeric) AS total_value_unpaid
   FROM contractors c
     LEFT JOIN service_orders so ON so.contractor_id = c.id
     LEFT JOIN ( SELECT so2.contractor_id,
            sum(r.qty_good) AS qty_good,
            sum(r.qty_defect) AS qty_defect,
            sum(r.qty_loss) AS qty_loss
           FROM service_order_returns r
             JOIN service_orders so2 ON so2.id = r.service_order_id
          GROUP BY so2.contractor_id) ret ON ret.contractor_id = c.id
     LEFT JOIN ( SELECT so3.contractor_id,
            -- Dinheiro que de fato saiu: inclui o já pago de uma PARCIAL.
            sum(
                CASE
                    WHEN ap.status = 'cancelled'::text THEN 0::numeric
                    WHEN ap.status = 'paid'::text THEN COALESCE(NULLIF(ap.amount_paid, 0::numeric), ap.amount)
                    ELSE COALESCE(ap.amount_paid, 0::numeric)
                END) AS paid_amount,
            -- Saldo em aberto: só o que FALTA — espelha openBalanceOf no TS.
            sum(
                CASE
                    WHEN ap.status = ANY (ARRAY['paid'::text, 'cancelled'::text]) THEN 0::numeric
                    ELSE GREATEST(0::numeric, ap.amount - COALESCE(ap.amount_paid, 0::numeric))
                END) AS unpaid_amount
           FROM accounts_payable ap
             JOIN service_orders so3 ON so3.id = ap.reference_id
          WHERE ap.reference_type = 'service_order'::text
          GROUP BY so3.contractor_id) fin ON fin.contractor_id = c.id
  GROUP BY c.id, c.trade_name, c.name, c.service_type, c.active;
