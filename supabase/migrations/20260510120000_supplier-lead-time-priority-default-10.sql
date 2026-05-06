-- =============================================================================
-- Lead time de fornecedor com prioridade + default 10 dias
-- =============================================================================
--
-- Mudança de regra de negócio:
--
--   1. Default novo de lead time = 10 dias (antes 7) para fornecedor e
--      matéria-prima quando nenhum dos dois tem valor cadastrado.
--
--   2. Quando o fornecedor TEM lead_time_days cadastrado (> 0), TODOS os
--      materiais ligados a esse fornecedor devem seguir o lead time do
--      fornecedor — independentemente de o material ter um valor próprio.
--      Cadastrar uma vez no fornecedor passa a ser suficiente para todos
--      os SKUs dele.
--
--   3. Material só pode sobrescrever lead time se o fornecedor estiver
--      com 0 (não cadastrado). Nesse caso, prevalece o do material; se o
--      material também é 0/NULL, usa o default 10.
--
-- Resumo da prioridade no view `purchase_projection_timeline`:
--
--   effective_supplier_lead_time_days =
--     COALESCE(NULLIF(suppliers.lead_time_days, 0),
--              NULLIF(products.supplier_lead_time_days, 0),
--              10)
--
-- =============================================================================

-- 1) Default de coluna em products: 7 → 10. Linhas existentes com 7 não são
--    alteradas (poderiam ser intencionais). Apenas novas inserções pegarão 10.
ALTER TABLE public.products
  ALTER COLUMN supplier_lead_time_days SET DEFAULT 10;

-- 2) Default de coluna em suppliers: 0 → 10 também. Mantém coerência:
--    fornecedor novo entra com 10 dias até ser ajustado.
ALTER TABLE public.suppliers
  ALTER COLUMN lead_time_days SET DEFAULT 10;

-- 3) Recria a view `purchase_projection_timeline` aplicando a prioridade
--    fornecedor → material → 10.
--    O campo `supplier_lead_time_days` exposto agora é o EFETIVO
--    (fornecedor vence quando setado), não mais o cru de products.
--    Adiciona também `material_lead_time_raw` para auditoria.
DROP VIEW IF EXISTS public.purchase_projection_timeline CASCADE;

CREATE VIEW public.purchase_projection_timeline AS
WITH lt AS (
  SELECT
    o.id               AS order_id,
    o.order_number     AS pedido_ref,
    o.sale_order_id,
    so.delivery_deadline AS data_entrega_cliente,
    o.quantity         AS op_quantity,
    o.status           AS order_status,
    o.reference_id,
    ts.name            AS referencia_nome,
    ts.id              AS sheet_id,
    ts.shoe_category   AS sheet_category,

    CASE
      WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                      dlt.cutting_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
    END AS lead_time_corte_dias,

    CASE
      WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                      dlt.sewing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3)
    END AS lead_time_costura_dias,

    CASE
      WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                      dlt.assembly_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
    END AS lead_time_montagem_dias,

    CASE
      WHEN ts.has_straps = true AND COALESCE(ts.handling_time_minutes, 0) > 0
        THEN GREATEST(1, CEIL(ts.handling_time_minutes::numeric
                              * o.quantity::numeric / 480.0)::integer)
      ELSE 0
    END AS lead_time_mesa_dias,

    CASE
      WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                      dlt.finishing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
    END AS lead_time_acabamento_dias,

    COALESCE(ts.lead_time_buffer_material_dias,
             dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias

  FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE o.status <> ALL (ARRAY['Pronto', 'FINALIZADO', 'Cancelado'])
    AND so.delivery_deadline IS NOT NULL
)
SELECT
  lt.order_id,
  lt.pedido_ref,
  lt.sale_order_id,
  lt.data_entrega_cliente,
  lt.op_quantity,
  lt.order_status,
  lt.reference_id,
  lt.referencia_nome,
  lt.lead_time_corte_dias,
  lt.lead_time_costura_dias,
  lt.lead_time_montagem_dias,
  lt.lead_time_mesa_dias,
  lt.lead_time_acabamento_dias,
  lt.lead_time_buffer_material_dias,

  -- Cascade: entrega → acabamento → mesa → montagem → costura → corte
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    AS data_inicio_acabamento,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias
    AS data_inicio_mesa,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    AS data_inicio_montagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias
    AS data_inicio_costura,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    AS data_inicio_corte,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    - lt.lead_time_buffer_material_dias
    AS data_chegada_material,

  -- Lead time efetivo do fornecedor: prioridade fornecedor → material → 10.
  -- Antes era COALESCE(material, 7); agora qualquer fornecedor com
  -- lead_time_days > 0 vence todos os SKUs ligados a ele.
  COALESCE(NULLIF(sup.lead_time_days, 0),
           NULLIF(m.supplier_lead_time_days, 0),
           10) AS supplier_lead_time_days,

  -- Mantém também o cru pra auditoria: o que está no material vs no fornecedor.
  m.supplier_lead_time_days        AS material_lead_time_raw,
  sup.lead_time_days               AS supplier_lead_time_raw,

  -- data_limite_compra usa o lead time efetivo
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    - lt.lead_time_buffer_material_dias
    - COALESCE(NULLIF(sup.lead_time_days, 0),
               NULLIF(m.supplier_lead_time_days, 0),
               10)
    AS data_limite_compra,

  m.id              AS material_id,
  m.name            AS material,
  m.group_id        AS material_group_id,
  pg.name           AS grupo_material,
  m.unit            AS unidade,
  m.quantity        AS estoque_atual,
  m.min_stock,
  m.supplier_id,
  sup.name          AS supplier_name,
  COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric
    AS quantidade_necessaria

FROM lt
  JOIN public.sheet_materials sm ON sm.sheet_id = lt.sheet_id
  JOIN public.products m ON m.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = m.group_id
  LEFT JOIN public.suppliers sup ON sup.id = m.supplier_id;

COMMENT ON VIEW public.purchase_projection_timeline IS
  'Cronograma reverso por OP+material. supplier_lead_time_days é o EFETIVO '
  'aplicando prioridade fornecedor → material → 10. material_lead_time_raw e '
  'supplier_lead_time_raw expostos para auditoria.';
