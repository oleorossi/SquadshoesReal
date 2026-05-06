DROP VIEW IF EXISTS public.purchase_projection_timeline;

CREATE VIEW public.purchase_projection_timeline AS 
 WITH lt AS (
         SELECT o.id AS order_id,
            o.order_number AS pedido_ref,
            o.sale_order_id,
            so.delivery_deadline AS data_entrega_cliente,
            o.quantity AS op_quantity,
            o.status AS order_status,
            o.reference_id,
            ts.name AS referencia_nome,
            ts.id AS sheet_id,
            ts.shoe_category AS sheet_category,
                CASE
                    WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), dlt.cutting_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
                END AS lead_time_corte_dias,
                CASE
                    WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), dlt.sewing_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3)
                END AS lead_time_costura_dias,
                CASE
                    WHEN COALESCE(ts.silk_capacity_per_day, dlt.silk_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day, 0), dlt.silk_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(ts.lead_time_silk_dias, dlt.lead_time_silk_dias, 1)
                END AS lead_time_silk_dias,
                CASE
                    WHEN COALESCE(ts.gluing_capacity_per_day, dlt.gluing_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day, 0), dlt.gluing_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(ts.lead_time_colagem_dias, dlt.lead_time_colagem_dias, 1)
                END AS lead_time_colagem_dias,
                CASE
                    WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day, 0), dlt.assembly_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
                END AS lead_time_montagem_dias,
                CASE
                    WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day, 0), dlt.finishing_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
                END AS lead_time_acabamento_dias,
                CASE
                    WHEN COALESCE(ts.soling_capacity_per_day, dlt.soling_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day, 0), dlt.soling_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(ts.lead_time_expedicao_dias, dlt.lead_time_expedicao_dias, 2)
                END AS lead_time_expedicao_dias,
            COALESCE(ts.lead_time_buffer_material_dias, dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias
           FROM orders o
             JOIN sale_orders so ON so.id = o.sale_order_id
             JOIN technical_sheets ts ON ts.id = o.reference_id
             LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
          WHERE (o.status <> ALL (ARRAY['Pronto'::text, 'FINALIZADO'::text, 'Cancelado'::text])) AND so.delivery_deadline IS NOT NULL
        )
 SELECT lt.order_id,
    lt.pedido_ref,
    lt.sale_order_id,
    lt.data_entrega_cliente,
    lt.op_quantity,
    lt.order_status,
    lt.reference_id,
    lt.referencia_nome,
    lt.lead_time_corte_dias,
    lt.lead_time_costura_dias,
    lt.lead_time_silk_dias,
    lt.lead_time_colagem_dias,
    lt.lead_time_montagem_dias,
    lt.lead_time_acabamento_dias,
    lt.lead_time_expedicao_dias,
    lt.lead_time_buffer_material_dias,
    lt.data_entrega_cliente - lt.lead_time_expedicao_dias AS data_inicio_expedicao,
    lt.data_entrega_cliente - lt.lead_time_expedicao_dias - lt.lead_time_acabamento_dias AS data_inicio_acabamento,
    lt.data_entrega_cliente - lt.lead_time_expedicao_dias - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias AS data_inicio_montagem,
    lt.data_entrega_cliente - lt.lead_time_expedicao_dias - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_colagem_dias AS data_inicio_colagem,
    lt.data_entrega_cliente - lt.lead_time_expedicao_dias - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_colagem_dias - lt.lead_time_silk_dias AS data_inicio_silk,
    lt.data_entrega_cliente - lt.lead_time_expedicao_dias - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_colagem_dias - lt.lead_time_silk_dias - lt.lead_time_costura_dias AS data_inicio_costura,
    lt.data_entrega_cliente - lt.lead_time_expedicao_dias - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_colagem_dias - lt.lead_time_silk_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias AS data_inicio_corte,
    lt.data_entrega_cliente - lt.lead_time_expedicao_dias - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_colagem_dias - lt.lead_time_silk_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias - lt.lead_time_buffer_material_dias AS data_chegada_material,
    lt.data_entrega_cliente - lt.lead_time_expedicao_dias - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_colagem_dias - lt.lead_time_silk_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias - lt.lead_time_buffer_material_dias - COALESCE(m.supplier_lead_time_days, 7) AS data_limite_compra,
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
    COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric AS quantidade_necessaria
   FROM lt
     JOIN sheet_materials sm ON sm.sheet_id = lt.sheet_id
     JOIN products m ON m.id = sm.product_id
     LEFT JOIN product_groups pg ON pg.id = m.group_id
     LEFT JOIN suppliers sup ON sup.id = m.supplier_id;
