-- Create a view to calculate the current load per sector and category
DROP VIEW IF EXISTS public.v_sector_load CASCADE;
CREATE OR REPLACE VIEW public.v_sector_load AS
WITH pending_stages AS (
    SELECT 
        pr.shoe_category,
        os.stage_name,
        SUM(os.quantity_total - os.quantity_processed) as pending_quantity
    FROM public.order_stages os
    JOIN public.orders o ON os.order_id = o.id
    LEFT JOIN public.product_references pr ON o.reference_id = pr.id
    WHERE os.status != 'concluido'
    GROUP BY pr.shoe_category, os.stage_name
)
SELECT 
    COALESCE(shoe_category, 'Geral') as shoe_category,
    -- Map order_stages to capacity sectors in default_lead_times
    SUM(CASE WHEN stage_name IN ('Corte') THEN pending_quantity ELSE 0 END) as load_corte,
    SUM(CASE WHEN stage_name IN ('Forração', 'Aviamento', 'Costura', 'Silk') THEN pending_quantity ELSE 0 END) as load_costura,
    SUM(CASE WHEN stage_name IN ('Colagem', 'Montagem', 'Solagem') THEN pending_quantity ELSE 0 END) as load_montagem,
    SUM(CASE WHEN stage_name IN ('Acabamento') THEN pending_quantity ELSE 0 END) as load_acabamento
FROM pending_stages
GROUP BY shoe_category;

-- Create the main capacity-driven lead times view
DROP VIEW IF EXISTS public.v_capacity_driven_lead_times CASCADE;
CREATE OR REPLACE VIEW public.v_capacity_driven_lead_times AS
SELECT 
    dlt.shoe_category,
    dlt.notes,
    -- Daily capacities
    dlt.cutting_capacity_per_day,
    dlt.sewing_capacity_per_day,
    dlt.assembly_capacity_per_day,
    dlt.finishing_capacity_per_day,
    -- Current loads
    COALESCE(sl.load_corte, 0) as current_load_corte,
    COALESCE(sl.load_costura, 0) as current_load_costura,
    COALESCE(sl.load_montagem, 0) as current_load_montagem,
    COALESCE(sl.load_acabamento, 0) as current_load_acabamento,
    -- Dynamic Lead Times (Load / Capacity)
    CEIL(COALESCE(sl.load_corte, 0)::float / NULLIF(dlt.cutting_capacity_per_day, 0)) as dynamic_days_corte,
    CEIL(COALESCE(sl.load_costura, 0)::float / NULLIF(dlt.sewing_capacity_per_day, 0)) as dynamic_days_costura,
    CEIL(COALESCE(sl.load_montagem, 0)::float / NULLIF(dlt.assembly_capacity_per_day, 0)) as dynamic_days_montagem,
    CEIL(COALESCE(sl.load_acabamento, 0)::float / NULLIF(dlt.finishing_capacity_per_day, 0)) as dynamic_days_acabamento,
    -- Fixed Buffers
    dlt.lead_time_buffer_material_dias,
    -- Total Dynamic Lead Time
    CEIL(
        COALESCE(sl.load_corte, 0)::float / NULLIF(dlt.cutting_capacity_per_day, 0) +
        COALESCE(sl.load_costura, 0)::float / NULLIF(dlt.sewing_capacity_per_day, 0) +
        COALESCE(sl.load_montagem, 0)::float / NULLIF(dlt.assembly_capacity_per_day, 0) +
        COALESCE(sl.load_acabamento, 0)::float / NULLIF(dlt.finishing_capacity_per_day, 0) +
        dlt.lead_time_buffer_material_dias
    ) as total_dynamic_lead_time_days
FROM public.default_lead_times dlt
LEFT JOIN public.v_sector_load sl ON dlt.shoe_category = sl.shoe_category;

-- Helper function to get estimated delivery date
DROP FUNCTION IF EXISTS public.estimate_delivery_date(p_shoe_category TEXT, p_quantity INTEGER) CASCADE;
CREATE OR REPLACE FUNCTION public.estimate_delivery_date(p_shoe_category TEXT, p_quantity INTEGER)
RETURNS DATE AS $$
DECLARE
    v_total_days INTEGER;
BEGIN
    SELECT 
        CEIL((current_load_corte + p_quantity)::float / NULLIF(cutting_capacity_per_day, 0)) +
        CEIL((current_load_costura + p_quantity)::float / NULLIF(sewing_capacity_per_day, 0)) +
        CEIL((current_load_montagem + p_quantity)::float / NULLIF(assembly_capacity_per_day, 0)) +
        CEIL((current_load_acabamento + p_quantity)::float / NULLIF(finishing_capacity_per_day, 0)) +
        lead_time_buffer_material_dias
    INTO v_total_days
    FROM public.v_capacity_driven_lead_times
    WHERE shoe_category = p_shoe_category;

    IF v_total_days IS NULL THEN
        RETURN CURRENT_DATE + 30; -- Default fallback
    END IF;

    RETURN CURRENT_DATE + v_total_days;
END;
$$ LANGUAGE plpgsql STABLE;
