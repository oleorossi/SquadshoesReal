-- 1. Remover visões dependentes (ordem inversa de dependência)
DROP VIEW IF EXISTS public.v_production_planning_kpis;
DROP VIEW IF EXISTS public.purchase_projection_timeline;
DROP VIEW IF EXISTS public.v_capacity_driven_lead_times;
DROP VIEW IF EXISTS public.v_sector_load;

-- 2. Recriar v_sector_load com novos setores
CREATE VIEW public.v_sector_load AS
WITH pending_stages AS (
    SELECT 
        COALESCE(pr.shoe_category, 'Geral'::text) AS shoe_category,
        os.stage_name,
        sum(os.quantity_total - os.quantity_processed) AS pending_quantity
    FROM public.order_stages os
    JOIN public.orders o ON os.order_id = o.id
    LEFT JOIN public.product_references pr ON o.reference_id = pr.id
    WHERE os.status <> 'concluido'::text
    GROUP BY pr.shoe_category, os.stage_name
)
SELECT 
    shoe_category,
    sum(CASE WHEN stage_name IN ('Corte', 'Corte Forração') THEN pending_quantity ELSE 0 END) AS load_corte,
    sum(CASE WHEN stage_name IN ('Forração', 'Corte Palmilha') THEN pending_quantity ELSE 0 END) AS load_forracao,
    sum(CASE WHEN stage_name = 'Silk' THEN pending_quantity ELSE 0 END) AS load_silk,
    sum(CASE WHEN stage_name = 'Colagem' THEN pending_quantity ELSE 0 END) AS load_colagem,
    sum(CASE WHEN stage_name = 'Montagem' THEN pending_quantity ELSE 0 END) AS load_montagem,
    sum(CASE WHEN stage_name = 'Acabamento' THEN pending_quantity ELSE 0 END) AS load_acabamento,
    sum(CASE WHEN stage_name = 'Expedição' THEN pending_quantity ELSE 0 END) AS load_expedicao
FROM pending_stages
GROUP BY shoe_category;

-- 3. Limpar colunas obsoletas das tabelas base
ALTER TABLE public.default_lead_times 
DROP COLUMN IF EXISTS mesa_daily_capacity,
DROP COLUMN IF EXISTS soling_capacity_per_day;

ALTER TABLE public.technical_sheets 
DROP COLUMN IF EXISTS mesa_daily_capacity,
DROP COLUMN IF EXISTS soling_capacity_per_day,
DROP COLUMN IF EXISTS palmilha_daily_capacity;

-- 4. Recriar v_capacity_driven_lead_times
CREATE VIEW public.v_capacity_driven_lead_times AS
SELECT 
    dlt.shoe_category,
    dlt.notes,
    dlt.cutting_capacity_per_day,
    dlt.sewing_capacity_per_day AS forracao_capacity_per_day,
    dlt.silk_capacity_per_day,
    dlt.gluing_capacity_per_day,
    dlt.assembly_capacity_per_day,
    dlt.finishing_capacity_per_day,
    COALESCE(sl.load_corte, 0) AS current_load_corte,
    COALESCE(sl.load_forracao, 0) AS current_load_forracao,
    COALESCE(sl.load_silk, 0) AS current_load_silk,
    COALESCE(sl.load_colagem, 0) AS current_load_colagem,
    COALESCE(sl.load_montagem, 0) AS current_load_montagem,
    COALESCE(sl.load_acabamento, 0) AS current_load_acabamento,
    COALESCE(sl.load_expedicao, 0) AS current_load_expedicao,
    ceil(COALESCE(sl.load_corte, 0)::double precision / NULLIF(dlt.cutting_capacity_per_day, 0)::double precision) AS dynamic_days_corte,
    ceil(COALESCE(sl.load_forracao, 0)::double precision / NULLIF(dlt.sewing_capacity_per_day, 0)::double precision) AS dynamic_days_forracao,
    ceil(COALESCE(sl.load_silk, 0)::double precision / NULLIF(dlt.silk_capacity_per_day, 0)::double precision) AS dynamic_days_silk,
    ceil(COALESCE(sl.load_colagem, 0)::double precision / NULLIF(dlt.gluing_capacity_per_day, 0)::double precision) AS dynamic_days_colagem,
    ceil(COALESCE(sl.load_montagem, 0)::double precision / NULLIF(dlt.assembly_capacity_per_day, 0)::double precision) AS dynamic_days_montagem,
    ceil(COALESCE(sl.load_acabamento, 0)::double precision / NULLIF(dlt.finishing_capacity_per_day, 0)::double precision) AS dynamic_days_acabamento,
    dlt.lead_time_buffer_material_dias,
    ceil(
        COALESCE(COALESCE(sl.load_corte, 0)::double precision / NULLIF(dlt.cutting_capacity_per_day, 0)::double precision, 0) +
        COALESCE(COALESCE(sl.load_forracao, 0)::double precision / NULLIF(dlt.sewing_capacity_per_day, 0)::double precision, 0) +
        COALESCE(COALESCE(sl.load_silk, 0)::double precision / NULLIF(dlt.silk_capacity_per_day, 0)::double precision, 0) +
        COALESCE(COALESCE(sl.load_colagem, 0)::double precision / NULLIF(dlt.gluing_capacity_per_day, 0)::double precision, 0) +
        COALESCE(COALESCE(sl.load_montagem, 0)::double precision / NULLIF(dlt.assembly_capacity_per_day, 0)::double precision, 0) +
        COALESCE(COALESCE(sl.load_acabamento, 0)::double precision / NULLIF(dlt.finishing_capacity_per_day, 0)::double precision, 0) +
        dlt.lead_time_buffer_material_dias::double precision
    ) AS total_dynamic_lead_time_days
FROM public.default_lead_times dlt
LEFT JOIN public.v_sector_load sl ON dlt.shoe_category = sl.shoe_category;

-- 5. Recriar purchase_projection_timeline
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
        COALESCE(ts.lead_time_expedicao_dias, dlt.lead_time_expedicao_dias, 2) AS lead_time_expedicao_dias,
        COALESCE(ts.lead_time_buffer_material_dias, dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias
    FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
    WHERE (o.status <> ALL (ARRAY['Pronto'::text, 'FINALIZADO'::text, 'Cancelado'::text])) AND so.delivery_deadline IS NOT NULL
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
    lt.data_entrega_cliente - lt.lead_time_expedicao_dias - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_colagem_dias - lt.lead_time_silk_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias - lt.lead_time_buffer_material_dias AS data_limite_compra
FROM lt;

-- 6. Recriar v_production_planning_kpis
CREATE VIEW public.v_production_planning_kpis AS
WITH sector_metrics AS (
    SELECT 
        os.stage_name AS sector,
        sum(os.quantity_total) AS total_pairs,
        sum(CASE WHEN os.status = 'pendente' THEN os.quantity_total ELSE 0 END) AS pending_pairs,
        sum(CASE WHEN os.status = 'em_andamento' THEN os.quantity_total - os.quantity_processed ELSE 0 END) AS in_progress_pairs,
        count(DISTINCT os.order_id) AS orders_count
    FROM public.order_stages os
    WHERE os.status IN ('pendente', 'em_andamento')
    GROUP BY os.stage_name
), capacity_data AS (
    SELECT 'Corte'::text AS sector, avg(cutting_capacity_per_day) AS avg_capacity FROM public.technical_sheets WHERE cutting_capacity_per_day > 0
    UNION ALL
    SELECT 'Forração'::text, avg(sewing_capacity_per_day) FROM public.technical_sheets WHERE sewing_capacity_per_day > 0
    UNION ALL
    SELECT 'Silk'::text, avg(silk_capacity_per_day) FROM public.technical_sheets WHERE silk_capacity_per_day > 0
    UNION ALL
    SELECT 'Colagem'::text, avg(gluing_capacity_per_day) FROM public.technical_sheets WHERE gluing_capacity_per_day > 0
    UNION ALL
    SELECT 'Montagem'::text, avg(assembly_capacity_per_day) FROM public.technical_sheets WHERE assembly_capacity_per_day > 0
    UNION ALL
    SELECT 'Acabamento'::text, avg(finishing_capacity_per_day) FROM public.technical_sheets WHERE finishing_capacity_per_day > 0
)
SELECT 
    sm.sector,
    sm.total_pairs,
    sm.pending_pairs,
    sm.in_progress_pairs,
    sm.orders_count,
    COALESCE(cd.avg_capacity, 0) AS daily_capacity,
    CASE WHEN cd.avg_capacity > 0 THEN round(sm.total_pairs::numeric / cd.avg_capacity, 1) ELSE 0 END AS days_of_backlog,
    CASE 
        WHEN cd.avg_capacity > 0 AND (sm.total_pairs::numeric / cd.avg_capacity) > 10 THEN 'crítico'
        WHEN cd.avg_capacity > 0 AND (sm.total_pairs::numeric / cd.avg_capacity) > 5 THEN 'atenção'
        ELSE 'normal'
    END AS risk_level
FROM sector_metrics sm
LEFT JOIN capacity_data cd ON sm.sector = cd.sector;
