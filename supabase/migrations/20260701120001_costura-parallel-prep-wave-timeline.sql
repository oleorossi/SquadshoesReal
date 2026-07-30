-- =============================================================================
-- Costura passa a rodar em PARALELO com a prep no motor de datas das ondas.
-- =============================================================================
-- Decisão do dono da fábrica (2026-06-28): Costura e Aviamento (Mesa) são
-- PARALELOS. Antes, compute_wave_timeline tratava Costura como SEQUENCIAL
-- (somava o lead de costura em v_post_prep, depois da prep), o que inflava o
-- lead total da onda e empurrava material_ready_date/purchase_deadline pra trás.
--
-- Topologia canônica passa a ser:
--   Bloco prep PARALELO (lead = MAX): Corte Palmilha ‖ Corte Forração ‖
--     Aviamento(Mesa) ‖ Costura
--   Sequencial depois: Silk → Colagem → Montagem → Solagem → Acabamento → Expedição
--
-- Espelhado no front em src/lib/sectorCapacity.ts (computeParallelWindows /
-- FORWARD_PREP) para não divergir do servidor.
--
-- Mudança contida: a função é STABLE (read-only). Só altera as datas calculadas
-- daqui pra frente; ondas com datas já persistidas só recalculam quando
-- update_wave_timeline/recompute rodar (mudança de deadline, nova onda).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
 RETURNS TABLE(earliest_deadline date, corte_palmilha_start_date date, corte_forracao_start_date date, costura_start_date date, mesa_start_date date, silk_start_date date, colagem_start_date date, montagem_start_date date, solagem_start_date date, acabamento_start_date date, acabamento_end_date date, pickup_tuesday_date date, pickup_friday_date date, material_ready_date date, purchase_deadline date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_palmilha int; v_lead_forracao int; v_lead_costura int; v_lead_mesa int;
  v_lead_silk int; v_lead_colagem int; v_lead_montagem int; v_lead_solagem int;
  v_lead_acab int; v_lead_buffer int; v_lead_supplier int;
  v_deadline date; v_lead_prep_max int; v_post_prep int;
  v_seq_start date; v_earliest_prep date; v_acab_start date; v_acab_end date;
  v_pickup_tue date; v_pickup_fri date;
BEGIN
  SELECT MIN(so.delivery_deadline) INTO v_deadline FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;
  IF v_deadline IS NULL THEN RETURN; END IF;
  SELECT
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
      THEN CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
      ELSE 0 END), 1),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
      THEN CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura')
      THEN CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.costura_capacity_per_day::numeric)::int) ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa')
      THEN CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk')
      THEN CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2) END), 2),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1) END), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0), dlt.lead_time_buffer_material_dias, 2)), 2)
  INTO v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
       v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);
  SELECT COALESCE(MAX(CASE WHEN COALESCE(needed.total_needed,0) > GREATEST(0, COALESCE(p.quantity,0) - COALESCE(p.reserved_stock,0))
         THEN public.get_effective_supplier_lead_days(p.id, NULL) ELSE 0 END), 0)
    INTO v_lead_supplier
    FROM (SELECT sm.product_id, SUM(sm.quantity_per_unit*soi.quantity) AS total_needed
            FROM sale_order_items soi JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
           WHERE soi.sale_order_id = ANY(p_sale_order_ids) GROUP BY sm.product_id) AS needed
    JOIN products p ON p.id = needed.product_id;
  -- Costura agora é PREP PARALELA (junto com palmilha/forração/mesa), não mais
  -- sequencial. v_seq_start = início da cadeia sequencial (= silk_start).
  v_post_prep := v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem + v_lead_silk;
  v_lead_prep_max := GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa, v_lead_costura);
  v_seq_start := add_business_days(v_deadline, -v_post_prep)::date;
  v_earliest_prep := add_business_days(v_seq_start, -v_lead_prep_max)::date;
  v_acab_start := add_business_days(v_deadline, -v_lead_acab)::date;
  v_acab_end := v_deadline;
  v_pickup_fri := public.next_dow(v_acab_end, 5);
  v_pickup_tue := public.next_dow(add_business_days(v_acab_start, GREATEST(1, v_lead_acab/2))::date, 2);
  IF v_pickup_tue >= v_pickup_fri THEN v_pickup_tue := v_pickup_fri - 3; END IF;
  RETURN QUERY SELECT v_deadline,
    add_business_days(v_seq_start, -v_lead_palmilha)::date,
    add_business_days(v_seq_start, -v_lead_forracao)::date,
    add_business_days(v_seq_start, -v_lead_costura)::date,
    add_business_days(v_seq_start, -v_lead_mesa)::date,
    v_seq_start,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem))::date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem))::date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem))::date,
    v_acab_start, v_acab_end, v_pickup_tue, v_pickup_fri,
    add_business_days(v_earliest_prep, -v_lead_buffer)::date,
    add_business_days(v_earliest_prep, -(v_lead_buffer + v_lead_supplier))::date;
END;
$function$;
</content>
