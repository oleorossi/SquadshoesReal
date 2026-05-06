DROP VIEW IF EXISTS public.v_capacity_driven_lead_times;
DROP VIEW IF EXISTS public.v_sector_load;

-- Update v_sector_load to be more granular
CREATE OR REPLACE VIEW public.v_sector_load AS
 WITH pending_stages AS (
         SELECT pr.shoe_category,
            os.stage_name,
            sum((os.quantity_total - os.quantity_processed)) AS pending_quantity
           FROM ((order_stages os
             JOIN orders o ON ((os.order_id = o.id)))
             LEFT JOIN product_references pr ON ((o.reference_id = pr.id)))
          WHERE (os.status <> 'concluido'::text)
          GROUP BY pr.shoe_category, os.stage_name
        )
 SELECT COALESCE(shoe_category, 'Geral'::text) AS shoe_category,
    sum(CASE WHEN (stage_name = 'Forração'::text) THEN pending_quantity ELSE (0)::bigint END) AS load_corte_forracao,
    sum(CASE WHEN (stage_name = 'Corte'::text) THEN pending_quantity ELSE (0)::bigint END) AS load_corte_palmilha,
    sum(CASE WHEN (stage_name = 'Mesa'::text) THEN pending_quantity ELSE (0)::bigint END) AS load_mesa,
    sum(CASE WHEN (stage_name = 'Silk'::text) THEN pending_quantity ELSE (0)::bigint END) AS load_silk,
    sum(CASE WHEN (stage_name = 'Colagem'::text) THEN pending_quantity ELSE (0)::bigint END) AS load_colagem,
    sum(CASE WHEN (stage_name = 'Montagem'::text) THEN pending_quantity ELSE (0)::bigint END) AS load_montagem,
    sum(CASE WHEN (stage_name = 'Solagem'::text) THEN pending_quantity ELSE (0)::bigint END) AS load_solagem,
    sum(CASE WHEN (stage_name = 'Acabamento'::text) THEN pending_quantity ELSE (0)::bigint END) AS load_acabamento
   FROM pending_stages
  GROUP BY shoe_category;

-- Update v_capacity_driven_lead_times
CREATE OR REPLACE VIEW public.v_capacity_driven_lead_times AS
 SELECT dlt.shoe_category,
    dlt.notes,
    dlt.cutting_capacity_per_day,
    dlt.sewing_capacity_per_day,
    dlt.mesa_daily_capacity,
    dlt.silk_capacity_per_day,
    dlt.gluing_capacity_per_day,
    dlt.assembly_capacity_per_day,
    dlt.soling_capacity_per_day,
    dlt.finishing_capacity_per_day,
    COALESCE(sl.load_corte_forracao, (0)::numeric) AS current_load_corte_forracao,
    COALESCE(sl.load_corte_palmilha, (0)::numeric) AS current_load_corte_palmilha,
    COALESCE(sl.load_mesa, (0)::numeric) AS current_load_mesa,
    COALESCE(sl.load_silk, (0)::numeric) AS current_load_silk,
    COALESCE(sl.load_colagem, (0)::numeric) AS current_load_colagem,
    COALESCE(sl.load_montagem, (0)::numeric) AS current_load_montagem,
    COALESCE(sl.load_solagem, (0)::numeric) AS current_load_solagem,
    COALESCE(sl.load_acabamento, (0)::numeric) AS current_load_acabamento,
    -- Dynamic days calculations
    ceil((COALESCE(sl.load_corte_forracao, (0)::numeric))::double precision / NULLIF(dlt.cutting_capacity_per_day, 0)::double precision) AS dynamic_days_corte_forracao,
    ceil((COALESCE(sl.load_corte_palmilha, (0)::numeric))::double precision / NULLIF(dlt.sewing_capacity_per_day, 0)::double precision) AS dynamic_days_corte_palmilha,
    ceil((COALESCE(sl.load_mesa, (0)::numeric))::double precision / NULLIF(dlt.mesa_daily_capacity, 0)::double precision) AS dynamic_days_mesa,
    ceil((COALESCE(sl.load_silk, (0)::numeric))::double precision / NULLIF(dlt.silk_capacity_per_day, 0)::double precision) AS dynamic_days_silk,
    ceil((COALESCE(sl.load_colagem, (0)::numeric))::double precision / NULLIF(dlt.gluing_capacity_per_day, 0)::double precision) AS dynamic_days_colagem,
    ceil((COALESCE(sl.load_montagem, (0)::numeric))::double precision / NULLIF(dlt.assembly_capacity_per_day, 0)::double precision) AS dynamic_days_montagem,
    ceil((COALESCE(sl.load_solagem, (0)::numeric))::double precision / NULLIF(dlt.soling_capacity_per_day, 0)::double precision) AS dynamic_days_solagem,
    ceil((COALESCE(sl.load_acabamento, (0)::numeric))::double precision / NULLIF(dlt.finishing_capacity_per_day, 0)::double precision) AS dynamic_days_acabamento,
    dlt.lead_time_buffer_material_dias,
    -- Total Dynamic Lead Time (sum of all dynamic days + buffer)
    ceil(
      (
        COALESCE((COALESCE(sl.load_corte_forracao, (0)::numeric))::double precision / NULLIF(dlt.cutting_capacity_per_day, 0)::double precision, 0) +
        COALESCE((COALESCE(sl.load_corte_palmilha, (0)::numeric))::double precision / NULLIF(dlt.sewing_capacity_per_day, 0)::double precision, 0) +
        COALESCE((COALESCE(sl.load_mesa, (0)::numeric))::double precision / NULLIF(dlt.mesa_daily_capacity, 0)::double precision, 0) +
        COALESCE((COALESCE(sl.load_silk, (0)::numeric))::double precision / NULLIF(dlt.silk_capacity_per_day, 0)::double precision, 0) +
        COALESCE((COALESCE(sl.load_colagem, (0)::numeric))::double precision / NULLIF(dlt.gluing_capacity_per_day, 0)::double precision, 0) +
        COALESCE((COALESCE(sl.load_montagem, (0)::numeric))::double precision / NULLIF(dlt.assembly_capacity_per_day, 0)::double precision, 0) +
        COALESCE((COALESCE(sl.load_solagem, (0)::numeric))::double precision / NULLIF(dlt.soling_capacity_per_day, 0)::double precision, 0) +
        COALESCE((COALESCE(sl.load_acabamento, (0)::numeric))::double precision / NULLIF(dlt.finishing_capacity_per_day, 0)::double precision, 0) +
        dlt.lead_time_buffer_material_dias::double precision
      )
    ) AS total_dynamic_lead_time_days
   FROM (default_lead_times dlt
     LEFT JOIN v_sector_load sl ON ((dlt.shoe_category = sl.shoe_category)));