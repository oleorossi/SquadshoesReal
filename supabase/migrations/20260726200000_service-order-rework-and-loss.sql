-- =============================================================================
-- ONDA 03 — Retrabalho de defeito e visibilidade de perda (2026-07-26)
--
-- PROBLEMA: o retorno registra bom/defeito/perda, mas o defeito não vira nada.
-- `v_service_order_balance` calcula:
--     qty_in_field    = despachado − (bom + defeito + perda)
--     qty_to_dispatch = GREATEST(0, quantidade − despachado)
-- Ou seja: o par defeituoso SAI de "na rua" (voltou de fato à fábrica) e, como
-- o despacho já bateu a quantidade da OS, `qty_to_dispatch` fica zero — não há
-- como mandar de volta pro prestador consertar. O par some do controle: não é
-- pago, não está na rua, e não está previsto pra sair de novo.
--
-- CORREÇÃO (decisão do dono: reabrir saldo pra retrabalho):
--   · nova coluna `qty_defect_scrapped` — do defeito, quanto virou sucata e NÃO
--     volta pro prestador. O resto é retrabalho pendente.
--   · `qty_to_dispatch` passa a somar o defeito pendente de retrabalho, o que
--     reabre o botão de remessa para mandar os pares de volta.
--   · a view expõe `qty_defect_pending_rework` e `qty_short` (perda + sucata),
--     que é o quanto a OS NUNCA vai entregar e precisa de reposição.
--
-- PAGAMENTO NÃO DUPLICA: a conta a pagar sai por `qty_good`, e par defeituoso
-- nunca foi pago. Quando o retrabalho voltar bom, entra um retorno com
-- qty_good e é pago então — uma vez só, no total certo.
-- =============================================================================

ALTER TABLE public.service_order_returns
  ADD COLUMN IF NOT EXISTS qty_defect_scrapped integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.service_order_returns.qty_defect_scrapped IS
  'Dos pares em qty_defect, quantos viraram sucata e NÃO voltam ao prestador. '
  'O restante (qty_defect - qty_defect_scrapped) é retrabalho pendente e reabre '
  'saldo despachável em v_service_order_balance.';

-- Sucata não pode passar do defeito registrado no mesmo retorno.
ALTER TABLE public.service_order_returns
  DROP CONSTRAINT IF EXISTS chk_defect_scrapped_within_defect;
ALTER TABLE public.service_order_returns
  ADD CONSTRAINT chk_defect_scrapped_within_defect
  CHECK (qty_defect_scrapped >= 0 AND qty_defect_scrapped <= qty_defect);

CREATE OR REPLACE VIEW public.v_service_order_balance
WITH (security_invoker = true) AS
SELECT
  so.id AS service_order_id,
  so.contractor_id,
  so.quantity AS qty_sent,
  COALESCE(r.good, 0::bigint)   AS qty_returned_good,
  COALESCE(r.defect, 0::bigint) AS qty_returned_defect,
  COALESCE(r.loss, 0::bigint)   AS qty_loss,
  CASE WHEN so.dispatch_tracked THEN COALESCE(d.dispatched, 0::bigint)
       ELSE so.quantity::bigint END
    - COALESCE(r.good + r.defect + r.loss, 0::bigint) AS qty_in_field,
  r.last_return_at,
  so.dispatch_tracked,
  CASE WHEN so.dispatch_tracked THEN COALESCE(d.dispatched, 0::bigint)
       ELSE so.quantity::bigint END AS qty_dispatched,

  -- Saldo despachável: o que falta enviar MAIS o retrabalho pendente. Sem a
  -- segunda parcela, o par defeituoso nunca podia voltar pro conserto.
  -- (Posição preservada — CREATE OR REPLACE não aceita reordenar colunas.)
  GREATEST(0::bigint,
    so.quantity - CASE WHEN so.dispatch_tracked THEN COALESCE(d.dispatched, 0::bigint)
                       ELSE so.quantity::bigint END
  ) + GREATEST(0::bigint, COALESCE(r.defect, 0::bigint) - COALESCE(r.scrapped, 0::bigint))
    AS qty_to_dispatch,

  -- Colunas NOVAS vão no fim, por exigência do CREATE OR REPLACE.
  -- Defeito que ainda pode voltar ao prestador (não foi sucateado).
  GREATEST(0::bigint, COALESCE(r.defect, 0::bigint) - COALESCE(r.scrapped, 0::bigint))
    AS qty_defect_pending_rework,

  -- O que a OS nunca vai entregar sem reposição: perda + sucata.
  COALESCE(r.loss, 0::bigint) + COALESCE(r.scrapped, 0::bigint) AS qty_short
FROM public.service_orders so
LEFT JOIN (
  SELECT service_order_id, sum(qty_dispatched) AS dispatched
  FROM public.service_order_dispatches GROUP BY service_order_id
) d ON d.service_order_id = so.id
LEFT JOIN (
  SELECT service_order_id,
         sum(qty_good)            AS good,
         sum(qty_defect)          AS defect,
         sum(qty_loss)            AS loss,
         sum(qty_defect_scrapped) AS scrapped,
         max(returned_at)         AS last_return_at
  FROM public.service_order_returns GROUP BY service_order_id
) r ON r.service_order_id = so.id;

COMMENT ON VIEW public.v_service_order_balance IS
  'Saldo físico da OS. Desde 2026-07-26: qty_to_dispatch inclui o defeito pendente de '
  'retrabalho (reabre remessa para o par voltar ao prestador), qty_defect_pending_rework '
  'mostra quanto está esperando conserto e qty_short (perda + sucata) é o que a OS não '
  'entrega sem reposição de material.';

GRANT SELECT ON public.v_service_order_balance TO authenticated;

-- A view de overview (consumida pela lista de OS) precisa expor as colunas
-- novas, senão o retrabalho e a falta ficam invisíveis na tela. Colunas novas
-- no fim, mesma exigência do CREATE OR REPLACE.
CREATE OR REPLACE VIEW public.v_service_order_overview
WITH (security_invoker = true) AS
SELECT
  so.id AS service_order_id,
  ap.accounts_payable_id, ap.payment_status, ap.payable_amount,
  ap.payment_due_date, ap.payment_date,
  COALESCE(ap.n_payables, 0) > 0 AS has_payable,
  COALESCE(ap.all_paid, false)   AS is_paid,
  bal.qty_sent, bal.qty_returned_good, bal.qty_returned_defect, bal.qty_loss,
  bal.qty_in_field, bal.last_return_at,
  bal.qty_defect_pending_rework,
  bal.qty_short
FROM public.service_orders so
LEFT JOIN LATERAL (
  SELECT
    count(*) AS n_payables,
    CASE WHEN count(*) = 1 THEN (array_agg(p.accounts_payable_id))[1] END AS accounts_payable_id,
    CASE WHEN count(*) FILTER (WHERE p.status = 'paid') = count(*) THEN 'paid' ELSE 'pending' END AS payment_status,
    sum(p.amount) AS payable_amount,
    COALESCE(min(p.due_date) FILTER (WHERE p.status <> 'paid'), min(p.due_date)) AS payment_due_date,
    max(p.payment_date) AS payment_date,
    count(*) FILTER (WHERE p.status = 'paid') = count(*) AS all_paid
  FROM public.v_service_order_payables p
  WHERE p.service_order_id = so.id
    AND p.status <> ALL (ARRAY['cancelled','cancelado','estornado'])
  HAVING count(*) > 0
) ap ON true
LEFT JOIN public.v_service_order_balance bal ON bal.service_order_id = so.id;

GRANT SELECT ON public.v_service_order_overview TO authenticated;
