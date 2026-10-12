-- Terceirizados: o relatório ganha o PEDIDO e a REFERÊNCIA.
--
-- Decisão do dono (12/10/2026): os relatórios vêm de cima pra baixo pelo prazo
-- de entrega do PV, com os itens agrupados por referência. As duas views do
-- Relatório de Terceirizados não tinham nem um nem outro — são OS por
-- prestador, com data de conclusão e dinheiro.
--
-- ⚠ ADITIVO. Nenhuma coluna existente muda de nome, tipo, ordem ou valor, e
-- nenhuma conta de pagamento é tocada: `amount_due`, `amount_paid_effective`,
-- `payment_state`, `is_overdue` e `days_overdue` saem idênticos. As colunas
-- novas vão no FIM, que é o que `CREATE OR REPLACE VIEW` aceita.
--
-- ⚠ A REFERÊNCIA MUITAS VEZES NÃO EXISTE NO DADO, e a view diz isso em vez de
-- inventar. Medido em 12/10/2026 nas 349 OS genéricas:
--   • `source_sale_order_item_id` (fixa UMA referência): ....  1
--   • `order_id` (OP, que tem referência): .................   3
--   • PV com referência única (inequívoco): ................  13
--   • PV com VÁRIAS referências (ambíguo) → NULL: ...........  55
--   • sem PV nenhum → NULL: ................................ 277
-- `reference_label` cobre 17 de 349. `reference_source` existe pra tela poder
-- dizer POR QUE está em branco: ambiguidade do PV é diferente de OS avulsa sem
-- pedido. O conserto de verdade é gravar `source_sale_order_item_id` na criação
-- da OS — mudança de cadastro, não de relatório, e não entra aqui.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper compartilhado pelas duas views.
--
-- ⚠ Mora em `public`, e NÃO é SECURITY DEFINER, de propósito:
--   • as três views são `security_invoker=true`, ou seja rodam com a permissão
--     de quem chama;
--   • `authenticated` NÃO tem USAGE no schema `private` (verificado), então um
--     helper lá dentro faria a view falhar com permission denied em vez de
--     retornar linha;
--   • sem DEFINER, a RLS do chamador continua valendo em `sale_order_items`,
--     `orders` e `technical_sheets` — a função não dá nenhum acesso que ele já
--     não tivesse. Ligar DEFINER aqui furaria a RLS dessas três tabelas.
-- Existe pra as duas views não carregarem a mesma derivação copiada, que é como
-- os dois lados divergem com o tempo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.service_order_reference(
  p_item_id uuid,
  p_order_id uuid,
  p_sale_order_id uuid
)
RETURNS TABLE (reference_label text, reference_source text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH por_item AS (
    SELECT COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.model), ''), ts.name) AS label
      FROM public.sale_order_items soi
      JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE p_item_id IS NOT NULL AND soi.id = p_item_id
  ),
  por_op AS (
    SELECT COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.model), ''), ts.name) AS label
      FROM public.orders o
      JOIN public.technical_sheets ts ON ts.id = o.reference_id
     WHERE p_order_id IS NOT NULL AND o.id = p_order_id
  ),
  -- PV com UMA referência só: inequívoco, então vale. Com duas ou mais, a OS
  -- cobre o pedido inteiro e escolher uma seria inventar.
  pv_unica AS (
    SELECT COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.model), ''), ts.name) AS label
      FROM public.technical_sheets ts
     WHERE p_sale_order_id IS NOT NULL
       AND ts.id = (
         SELECT CASE WHEN count(DISTINCT soi.reference_id) = 1
                     THEN (array_agg(DISTINCT soi.reference_id))[1] END
           FROM public.sale_order_items soi
          WHERE soi.sale_order_id = p_sale_order_id
            AND soi.reference_id IS NOT NULL
       )
  )
  SELECT label, 'item'::text FROM por_item
  UNION ALL
  SELECT label, 'op'::text FROM por_op
   WHERE NOT EXISTS (SELECT 1 FROM por_item)
  UNION ALL
  SELECT label, 'pv_referencia_unica'::text FROM pv_unica
   WHERE NOT EXISTS (SELECT 1 FROM por_item) AND NOT EXISTS (SELECT 1 FROM por_op)
  UNION ALL
  SELECT NULL::text,
         CASE WHEN p_sale_order_id IS NULL THEN 'sem_pedido'::text
              ELSE 'pv_varias_referencias'::text END
   WHERE NOT EXISTS (SELECT 1 FROM por_item)
     AND NOT EXISTS (SELECT 1 FROM por_op)
     AND NOT EXISTS (SELECT 1 FROM pv_unica)
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.service_order_reference(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_order_reference(uuid, uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Histórico de OS concluídas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_contractor_history_orders
WITH (security_invoker = true) AS
 SELECT so.id,
    so.contractor_id,
    COALESCE(NULLIF(c.trade_name, ''::text), NULLIF(c.name, ''::text), '—'::text) AS contractor_name,
    so.order_number,
    so.receipt_number,
    so.description,
    COALESCE(NULLIF(so.target_sector, ''::text), 'costura'::text) AS sector,
    so.service_date,
    so.quoted_deadline,
    COALESCE(so.delivered_at, so.receipt_generated_at, so.updated_at) AS finished_at,
    so.quantity,
    so.unit_price,
    so.total_value,
    so.status,
        CASE
            WHEN so.quoted_deadline IS NULL THEN 'no_deadline'::text
            WHEN COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) <= so.quoted_deadline THEN 'on_time'::text
            ELSE 'late'::text
        END AS punctuality,
        CASE
            WHEN so.quoted_deadline IS NOT NULL AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline THEN COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) - so.quoted_deadline
            ELSE 0
        END AS days_late,
    so.artisanal_recipe_id IS NOT NULL AS is_artisanal,
    so.materials_sent,
    so.signed_photo_url,
    so.created_at,
    so.material_requirements,
    pv.id AS pv_sale_order_id,
    pv.order_number AS pv_order_number,
    pv.client_name AS pv_client_name,
    pv.delivery_deadline AS pv_delivery_deadline,
    ref.reference_label,
    ref.reference_source
   FROM v_non_strap_service_orders so
     LEFT JOIN contractors c ON c.id = so.contractor_id
     LEFT JOIN sale_orders pv ON pv.id = COALESCE(so.source_sale_order_id, so.sale_order_id)
     LEFT JOIN LATERAL public.service_order_reference(
       so.source_sale_order_item_id, so.order_id, COALESCE(so.source_sale_order_id, so.sale_order_id)
     ) ref ON true
  WHERE so.status = ANY (ARRAY['Concluído'::text, 'Concluido'::text, 'concluido'::text, 'received'::text, 'finalizado'::text, 'Finalizado'::text]);

-- ─────────────────────────────────────────────────────────────────────────────
-- Financeiro de OS — pagas × não pagas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_contractor_os_financials
WITH (security_invoker = true) AS
 SELECT os_id,
    order_number,
    contractor_id,
    contractor_name,
    service_type,
    sector,
    description,
    is_avulsa,
    os_status,
    quantity,
    total_value,
    ap_count,
    payment_method,
    amount_due,
    amount_paid_effective,
    service_date,
    due_date,
    payment_date,
    finished_at,
    payment_state,
    (payment_state = ANY (ARRAY['unpaid'::text, 'partially_paid'::text])) AND due_date IS NOT NULL AND due_date < CURRENT_DATE AS is_overdue,
        CASE
            WHEN (payment_state = ANY (ARRAY['unpaid'::text, 'partially_paid'::text])) AND due_date IS NOT NULL AND due_date < CURRENT_DATE THEN CURRENT_DATE - due_date
            ELSE 0
        END AS days_overdue,
    pv_sale_order_id,
    pv_order_number,
    pv_client_name,
    pv_delivery_deadline,
    reference_label,
    reference_source
   FROM ( SELECT so.id AS os_id,
            so.order_number,
            so.contractor_id,
            COALESCE(NULLIF(c.trade_name, ''::text), NULLIF(c.name, ''::text), '—'::text) AS contractor_name,
            c.service_type,
            COALESCE(NULLIF(so.target_sector, ''::text), NULLIF(so.sector, ''::text), 'costura'::text) AS sector,
            so.description,
            so.is_avulsa,
            so.status AS os_status,
            so.quantity,
            so.total_value,
            COALESCE(ap.n_payables, 0::bigint) AS ap_count,
            ap.payment_method,
            COALESCE(ap.payable_amount, so.total_value) AS amount_due,
            COALESCE(ap.paid_amount, 0::numeric) AS amount_paid_effective,
            so.service_date,
            COALESCE(ap.due_date, so.payment_due_date) AS due_date,
            ap.payment_date,
            COALESCE(so.delivered_at, so.receipt_generated_at, so.updated_at) AS finished_at,
                CASE
                    WHEN COALESCE(ap.n_payables, 0::bigint) = 0 THEN
                    CASE
                        WHEN so.status = ANY (ARRAY['Concluído'::text, 'Concluido'::text, 'concluido'::text, 'received'::text, 'finalizado'::text, 'Finalizado'::text]) THEN 'missing_ap'::text
                        ELSE 'not_billed'::text
                    END
                    WHEN ap.n_paid = ap.n_payables THEN 'paid'::text
                    WHEN ap.n_paid > 0 THEN 'partially_paid'::text
                    ELSE 'unpaid'::text
                END AS payment_state,
            pv.id AS pv_sale_order_id,
            pv.order_number AS pv_order_number,
            pv.client_name AS pv_client_name,
            pv.delivery_deadline AS pv_delivery_deadline,
            ref.reference_label,
            ref.reference_source
           FROM v_non_strap_service_orders so
             LEFT JOIN contractors c ON c.id = so.contractor_id
             LEFT JOIN sale_orders pv ON pv.id = COALESCE(so.source_sale_order_id, so.sale_order_id)
             LEFT JOIN LATERAL public.service_order_reference(
               so.source_sale_order_item_id, so.order_id, COALESCE(so.source_sale_order_id, so.sale_order_id)
             ) ref ON true
             LEFT JOIN LATERAL ( SELECT count(*) AS n_payables,
                    count(*) FILTER (WHERE p.status = 'paid'::text) AS n_paid,
                    sum(p.amount) AS payable_amount,
                    sum(
                        CASE
                            WHEN p.status = 'paid'::text THEN COALESCE(NULLIF(p.amount_paid, 0::numeric), p.amount)
                            ELSE 0::numeric
                        END) AS paid_amount,
                    COALESCE(min(p.due_date) FILTER (WHERE p.status <> 'paid'::text), min(p.due_date)) AS due_date,
                    max(p.payment_date) AS payment_date,
                    min(p.payment_method) AS payment_method
                   FROM v_non_strap_service_order_payables p
                  WHERE p.service_order_id = so.id AND (p.status <> ALL (ARRAY['cancelled'::text, 'cancelado'::text, 'estornado'::text]))
                 HAVING count(*) > 0) ap ON true
          WHERE so.status <> ALL (ARRAY['Cancelado'::text, 'cancelled'::text, 'cancelado'::text, 'estornado'::text])) b;
