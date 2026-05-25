-- =============================================================================
-- /terceiros-na-rua — breakdown ao expandir uma linha
-- =============================================================================
-- Quando o gestor clica numa linha da tabela "na rua", ele quer ver a
-- composição daquela OS:
--   • Caso artesanal (tingimento): receita aplicada (output) + base usada
--   • Caso materials_sent populado: cada material/cor/metros enviado
--   • Caso OS de gargalo com OP vinculada: grade da OP (numerações × pares)
--
-- Esta migration ESTENDE a view v_outsourced_in_field adicionando colunas que
-- viabilizam esse drilldown sem fetch adicional, e corrige bug do
-- contractor_name retornando vazio quando c.trade_name='' (string vazia
-- não é NULL — COALESCE não pulava pro c.name).
-- =============================================================================

CREATE OR REPLACE VIEW public.v_outsourced_in_field
WITH (security_invoker = true) AS
WITH service_order_rows AS (
  SELECT
    'service_order'::text                                  AS source,
    so.id                                                  AS id,
    so.contractor_id                                       AS contractor_id,
    -- Fix bug: trade_name='' não é NULL, então NULLIF antes do COALESCE
    COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, ''), '—') AS contractor_name,
    COALESCE(NULLIF(so.target_sector, ''), 'costura')      AS sector,
    o.id                                                   AS order_id,
    COALESCE(NULLIF(o.order_number, ''), '—')              AS op_number,
    sord.id                                                AS sale_order_id,
    COALESCE(NULLIF(sord.order_number, ''), '—')           AS sale_order_number,
    COALESCE(sord.client_name, '')                         AS client_name,
    COALESCE(NULLIF(ts.name, ''), NULLIF(ts.code, ''), NULLIF(so.material_name, ''), '—') AS sheet_name,
    COALESCE(NULLIF(so.material_color, ''), o.color, '')   AS color,
    COALESCE(so.quantity, o.quantity, 0)::numeric          AS pairs,
    COALESCE(so.service_date, so.created_at::date)         AS sent_at,
    so.quoted_deadline                                     AS expected_back,
    CASE
      WHEN so.quoted_deadline IS NOT NULL
       AND so.quoted_deadline < CURRENT_DATE
      THEN (CURRENT_DATE - so.quoted_deadline)
      ELSE 0
    END                                                    AS days_late,
    so.status                                              AS status,
    so.unit_price                                          AS unit_price,
    so.total_value                                         AS total_value,
    so.created_at                                          AS created_at,
    -- ── Breakdown (Fase 2) ──────────────────────────────────────────────────
    (so.artisanal_recipe_id IS NOT NULL)                   AS is_artisanal,
    COALESCE(so.materials_sent, '[]'::jsonb)               AS materials_sent,
    so.material_name                                       AS material_name,
    so.material_color                                      AS material_color,
    so.material_meters                                     AS material_meters,
    so.artisanal_output_name                               AS artisanal_output_name,
    so.artisanal_output_color                              AS artisanal_output_color,
    so.artisanal_output_meters                             AS artisanal_output_meters,
    so.artisanal_base_color                                AS artisanal_base_color,
    so.artisanal_for_order_meters                          AS artisanal_for_order_meters,
    so.artisanal_for_stock_meters                          AS artisanal_for_stock_meters,
    o.grade                                                AS order_grade,
    so.description                                         AS description,
    so.notes                                               AS notes
  FROM public.service_orders so
  LEFT JOIN public.contractors  c    ON c.id    = so.contractor_id
  LEFT JOIN public.orders       o    ON o.id    = so.order_id
  LEFT JOIN public.sale_orders  sord ON sord.id = COALESCE(so.sale_order_id, o.sale_order_id)
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  WHERE so.status NOT IN (
          'Concluído','Concluido','concluido','received',
          'Cancelado','cancelled','cancelado',
          'finalizado','Finalizado'
        )
),
outsourced_op_rows AS (
  SELECT
    'outsourced_op'::text                                  AS source,
    o.id                                                   AS id,
    o.outsourced_to_contractor_id                          AS contractor_id,
    COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, ''), '—') AS contractor_name,
    COALESCE(NULLIF(o.outsourced_sector, ''), 'costura')   AS sector,
    o.id                                                   AS order_id,
    COALESCE(NULLIF(o.order_number, ''), '—')              AS op_number,
    sord.id                                                AS sale_order_id,
    COALESCE(NULLIF(sord.order_number, ''), '—')           AS sale_order_number,
    COALESCE(sord.client_name, '')                         AS client_name,
    COALESCE(NULLIF(ts.name, ''), NULLIF(ts.code, ''), '—') AS sheet_name,
    COALESCE(o.color, '')                                  AS color,
    COALESCE(o.quantity, 0)::numeric                       AS pairs,
    COALESCE(o.outsourced_at::date, o.created_at::date)    AS sent_at,
    o.planned_delivery                                     AS expected_back,
    CASE
      WHEN o.planned_delivery IS NOT NULL
       AND o.planned_delivery < CURRENT_DATE
      THEN (CURRENT_DATE - o.planned_delivery)
      ELSE 0
    END                                                    AS days_late,
    'outsourced'::text                                     AS status,
    NULL::numeric                                          AS unit_price,
    NULL::numeric                                          AS total_value,
    o.outsourced_at                                        AS created_at,
    -- ── Breakdown ─────────────────────────────────────────────────────────
    false                                                  AS is_artisanal,
    '[]'::jsonb                                            AS materials_sent,
    NULL::text                                             AS material_name,
    NULL::text                                             AS material_color,
    NULL::numeric                                          AS material_meters,
    NULL::text                                             AS artisanal_output_name,
    NULL::text                                             AS artisanal_output_color,
    NULL::numeric                                          AS artisanal_output_meters,
    NULL::text                                             AS artisanal_base_color,
    NULL::numeric                                          AS artisanal_for_order_meters,
    NULL::numeric                                          AS artisanal_for_stock_meters,
    o.grade                                                AS order_grade,
    NULL::text                                             AS description,
    NULL::text                                             AS notes
  FROM public.orders o
  LEFT JOIN public.contractors c    ON c.id    = o.outsourced_to_contractor_id
  LEFT JOIN public.sale_orders sord ON sord.id = o.sale_order_id
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  WHERE o.outsourced_to_contractor_id IS NOT NULL
    AND o.outsourced_returned_at IS NULL
    AND COALESCE(o.status, '') NOT IN (
          'Concluído','Concluido','concluido',
          'Entregue','entregue',
          'Cancelado','cancelled','cancelado'
        )
    AND NOT EXISTS (
      SELECT 1 FROM public.service_orders so2
      WHERE so2.order_id = o.id
        AND so2.status NOT IN (
              'Concluído','Concluido','concluido','received',
              'Cancelado','cancelled','cancelado',
              'finalizado','Finalizado'
            )
    )
)
SELECT * FROM service_order_rows
UNION ALL
SELECT * FROM outsourced_op_rows;

COMMENT ON VIEW public.v_outsourced_in_field IS
  'Visão unificada do que está fora da fábrica AGORA. Une service_orders ativas + orders.outsourced_to_contractor_id ainda não retornadas. Inclui colunas de breakdown (materials_sent, artisanal_*, order_grade) usadas pelo expand da página /terceiros-na-rua.';

GRANT SELECT ON public.v_outsourced_in_field TO authenticated;
