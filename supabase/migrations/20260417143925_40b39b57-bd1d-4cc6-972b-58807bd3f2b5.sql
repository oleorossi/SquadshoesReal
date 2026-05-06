DROP VIEW IF EXISTS public.purchase_projection_timeline;

CREATE VIEW public.purchase_projection_timeline AS
SELECT
  o.id AS order_id,
  o.order_number AS pedido_ref,
  o.sale_order_id,
  so.delivery_deadline AS data_entrega_cliente,
  o.quantity AS op_quantity,

  (so.delivery_deadline
    - ts.lead_time_acabamento_dias
    - ts.lead_time_montagem_dias
    - ts.lead_time_costura_dias
    - ts.lead_time_corte_dias)::date AS data_inicio_producao,

  m.id AS material_id,
  m.name AS material,
  m.group_id AS material_group_id,
  pg.name AS grupo_material,
  m.unit AS unidade,
  m.quantity AS estoque_atual,
  m.min_stock,
  m.supplier_lead_time_days,
  m.supplier_id,
  sup.name AS supplier_name,
  COALESCE(sm.quantity_per_unit, 1::numeric) * o.quantity::numeric AS quantidade_necessaria,

  (so.delivery_deadline
    - ts.lead_time_acabamento_dias
    - ts.lead_time_montagem_dias
    - ts.lead_time_costura_dias
    - ts.lead_time_corte_dias
    - ts.lead_time_buffer_material_dias
    - COALESCE(m.supplier_lead_time_days, 7))::date AS data_limite_compra,

  o.status AS order_status,
  o.reference_id,
  ts.name AS referencia_nome,

  ts.lead_time_acabamento_dias,
  ts.lead_time_montagem_dias,
  ts.lead_time_costura_dias,
  ts.lead_time_corte_dias,
  ts.lead_time_buffer_material_dias,

  (so.delivery_deadline - ts.lead_time_acabamento_dias)::date AS data_inicio_acabamento,
  (so.delivery_deadline - ts.lead_time_acabamento_dias - ts.lead_time_montagem_dias)::date AS data_inicio_montagem,
  (so.delivery_deadline - ts.lead_time_acabamento_dias - ts.lead_time_montagem_dias - ts.lead_time_costura_dias)::date AS data_inicio_costura,
  (so.delivery_deadline - ts.lead_time_acabamento_dias - ts.lead_time_montagem_dias - ts.lead_time_costura_dias - ts.lead_time_corte_dias)::date AS data_inicio_corte,
  (so.delivery_deadline - ts.lead_time_acabamento_dias - ts.lead_time_montagem_dias - ts.lead_time_costura_dias - ts.lead_time_corte_dias - ts.lead_time_buffer_material_dias)::date AS data_chegada_material
FROM orders o
JOIN sale_orders so ON so.id = o.sale_order_id
JOIN technical_sheets ts ON ts.id = o.reference_id
JOIN sheet_materials sm ON sm.sheet_id = ts.id
JOIN products m ON m.id = sm.product_id
LEFT JOIN product_groups pg ON pg.id = m.group_id
LEFT JOIN suppliers sup ON sup.id = m.supplier_id
WHERE o.status NOT IN ('Pronto', 'FINALIZADO', 'Cancelado')
  AND so.delivery_deadline IS NOT NULL;