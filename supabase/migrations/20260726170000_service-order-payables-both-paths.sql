-- =============================================================================
-- Conta a pagar da OS: enxergar os DOIS caminhos de pagamento (2026-07-26)
--
-- BUG: existem dois modelos de pagamento de OS convivendo, e as views
-- financeiras só enxergavam um deles.
--
--   (a) OS normal  → trigger `tg_create_ap_for_service_order` cria UMA conta com
--       reference_type = 'service_order' e reference_id = service_orders.id.
--
--   (b) OS dividida (`dispatch_tracked = true`, que é como `send_terceirizacao_os`
--       cria TODA OS vinda de PV — migration 20260825120000:132) → o trigger
--       acima retorna cedo (20260826120000:76) e quem paga é
--       `tg_ap_per_service_order_return`, que cria UMA CONTA POR RETORNO com
--       reference_type = 'service_order_return' e reference_id =
--       service_order_returns.id — ou seja, aponta para o RETORNO, não para a OS.
--
-- Tanto `v_service_order_overview` (20260613170000) quanto
-- `v_contractor_os_financials` (20260726150000) só faziam join com
-- reference_type = 'service_order'. Efeito: OS do caminho (b) apareciam como se
-- não tivessem conta a pagar — o badge da tela acusaria "Sem conta a pagar" e o
-- relatório financeiro marcaria `missing_ap` justamente nas OS que TÊM conta,
-- além de subestimar o passivo total.
--
-- Hoje o defeito é LATENTE (nenhuma OS em produção está com dispatch_tracked =
-- true e service_order_returns está vazia), mas o caminho de código está vivo:
-- a primeira OS criada a partir de um PV cairia nele.
--
-- Correção: uma view-base resolve o vínculo AP → OS pelos dois caminhos, e as
-- duas views financeiras passam a AGREGAR (o caminho (b) gera N contas por OS,
-- então deixa de existir "a" conta da OS).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Base: toda conta a pagar de OS, venha por qual caminho vier
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_service_order_payables
WITH (security_invoker = true) AS
SELECT
  ap.id            AS accounts_payable_id,
  ap.reference_type,
  so.id            AS service_order_id,
  ap.status, ap.amount, ap.amount_paid, ap.due_date, ap.payment_date,
  ap.payment_method, ap.supplier_id
FROM public.accounts_payable ap
JOIN public.service_orders so ON so.id = ap.reference_id
WHERE ap.reference_type = 'service_order'
UNION ALL
SELECT
  ap.id            AS accounts_payable_id,
  ap.reference_type,
  r.service_order_id,
  ap.status, ap.amount, ap.amount_paid, ap.due_date, ap.payment_date,
  ap.payment_method, ap.supplier_id
FROM public.accounts_payable ap
JOIN public.service_order_returns r ON r.id = ap.reference_id
WHERE ap.reference_type = 'service_order_return';

COMMENT ON VIEW public.v_service_order_payables IS
  'Todas as contas a pagar de Ordens de Serviço, resolvendo os DOIS vínculos: '
  'reference_type=service_order (aponta para a OS) e reference_type=service_order_return '
  '(aponta para o RETORNO, usado pelas OS dispatch_tracked, que geram uma conta por retorno). '
  'Fonte única para as views financeiras de OS — não consultar accounts_payable direto.';

GRANT SELECT ON public.v_service_order_payables TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) v_service_order_overview — mesmas colunas, agora agregando as N contas
--
-- Contrato preservado (a tela lê has_payable / payment_status / is_paid /
-- payment_due_date / payment_date). Semântica com várias contas:
--   is_paid        = TODAS as contas não canceladas estão quitadas
--   payable_amount = soma das contas não canceladas
--   payment_due_date = vencimento MAIS PRÓXIMO ainda em aberto
--   payment_date   = data do ÚLTIMO pagamento
--   accounts_payable_id = a conta, quando há exatamente uma (senão NULL)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_service_order_overview
WITH (security_invoker = true) AS
SELECT
  so.id                                                  AS service_order_id,
  ap.accounts_payable_id                                 AS accounts_payable_id,
  ap.payment_status                                      AS payment_status,
  ap.payable_amount                                      AS payable_amount,
  ap.payment_due_date                                    AS payment_due_date,
  ap.payment_date                                        AS payment_date,
  COALESCE(ap.n_payables, 0) > 0                         AS has_payable,
  COALESCE(ap.all_paid, false)                           AS is_paid,
  bal.qty_sent,
  bal.qty_returned_good,
  bal.qty_returned_defect,
  bal.qty_loss,
  bal.qty_in_field,
  bal.last_return_at
FROM public.service_orders so
LEFT JOIN LATERAL (
  SELECT
    count(*)                                                          AS n_payables,
    -- uuid não tem min(); array_agg + índice pega a única conta quando há só uma
    CASE WHEN count(*) = 1 THEN (array_agg(p.accounts_payable_id))[1] END AS accounts_payable_id,
    CASE WHEN count(*) FILTER (WHERE p.status = 'paid') = count(*)
         THEN 'paid' ELSE 'pending' END                               AS payment_status,
    sum(p.amount)                                                     AS payable_amount,
    COALESCE(
      min(p.due_date) FILTER (WHERE p.status <> 'paid'),
      min(p.due_date)
    )                                                                 AS payment_due_date,
    max(p.payment_date)                                               AS payment_date,
    count(*) FILTER (WHERE p.status = 'paid') = count(*)              AS all_paid
  FROM public.v_service_order_payables p
  WHERE p.service_order_id = so.id
    AND p.status <> ALL (ARRAY['cancelled','cancelado','estornado'])
  HAVING count(*) > 0
) ap ON true
LEFT JOIN public.v_service_order_balance bal ON bal.service_order_id = so.id;

COMMENT ON VIEW public.v_service_order_overview IS
  'Visão por OS: pagamento + saldo de recebimento parcial. Desde 2026-07-26 enxerga os DOIS '
  'caminhos de conta a pagar via v_service_order_payables (OS normal e OS dispatch_tracked, '
  'que paga por retorno). Com várias contas: is_paid = todas quitadas, payment_due_date = '
  'vencimento mais próximo em aberto, payment_date = último pagamento, accounts_payable_id = '
  'preenchido só quando há exatamente uma conta.';

GRANT SELECT ON public.v_service_order_overview TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) v_contractor_os_financials — idem, e ganha o estado 'partially_paid'
--
-- O caminho (b) paga por retorno, então uma OS pode ficar legitimamente com
-- parte das contas quitadas. Isso não é 'paid' nem 'unpaid' — é um terceiro
-- estado, e achatá-lo em qualquer um dos dois mentiria no relatório.
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_contractor_os_financials;

CREATE VIEW public.v_contractor_os_financials
WITH (security_invoker = true) AS
SELECT
  b.*,
  (b.payment_state IN ('unpaid','partially_paid') AND b.due_date IS NOT NULL AND b.due_date < CURRENT_DATE)
                                                         AS is_overdue,
  CASE
    WHEN b.payment_state IN ('unpaid','partially_paid') AND b.due_date IS NOT NULL AND b.due_date < CURRENT_DATE
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

    COALESCE(ap.n_payables, 0)                           AS ap_count,
    ap.payment_method                                    AS payment_method,
    COALESCE(ap.payable_amount, so.total_value)          AS amount_due,
    COALESCE(ap.paid_amount, 0)                          AS amount_paid_effective,

    so.service_date                                      AS service_date,
    COALESCE(ap.due_date, so.payment_due_date)           AS due_date,
    ap.payment_date                                      AS payment_date,
    COALESCE(so.delivered_at, so.receipt_generated_at, so.updated_at) AS finished_at,

    CASE
      WHEN COALESCE(ap.n_payables, 0) = 0 THEN
        CASE WHEN so.status = ANY (ARRAY['Concluído','Concluido','concluido','received','finalizado','Finalizado'])
             THEN 'missing_ap' ELSE 'not_billed' END
      WHEN ap.n_paid = ap.n_payables THEN 'paid'
      WHEN ap.n_paid > 0             THEN 'partially_paid'
      ELSE 'unpaid'
    END                                                  AS payment_state
  FROM public.service_orders so
  LEFT JOIN public.contractors c ON c.id = so.contractor_id
  LEFT JOIN LATERAL (
    SELECT
      count(*)                                                        AS n_payables,
      count(*) FILTER (WHERE p.status = 'paid')                       AS n_paid,
      sum(p.amount)                                                   AS payable_amount,
      sum(CASE WHEN p.status = 'paid' THEN COALESCE(NULLIF(p.amount_paid, 0), p.amount) ELSE 0 END) AS paid_amount,
      COALESCE(min(p.due_date) FILTER (WHERE p.status <> 'paid'), min(p.due_date)) AS due_date,
      max(p.payment_date)                                             AS payment_date,
      min(p.payment_method)                                           AS payment_method
    FROM public.v_service_order_payables p
    WHERE p.service_order_id = so.id
      AND p.status <> ALL (ARRAY['cancelled','cancelado','estornado'])
    HAVING count(*) > 0
  ) ap ON true
  WHERE so.status <> ALL (ARRAY['Cancelado','cancelled','cancelado','estornado'])
) b;

COMMENT ON VIEW public.v_contractor_os_financials IS
  'Uma linha por OS não cancelada com o estado REAL de pagamento, agregando TODAS as contas a '
  'pagar da OS pelos dois caminhos (v_service_order_payables). payment_state: paid = todas as '
  'contas quitadas · partially_paid = parte quitada (OS dispatch_tracked paga por retorno) · '
  'unpaid = nenhuma quitada · not_billed = OS aberta, sem conta (normal, a conta nasce na '
  'finalização) · missing_ap = OS finalizada SEM conta (anomalia). Expõe service_date, due_date '
  'e payment_date como colunas para filtrar o período por qualquer eixo.';

GRANT SELECT ON public.v_contractor_os_financials TO authenticated;
