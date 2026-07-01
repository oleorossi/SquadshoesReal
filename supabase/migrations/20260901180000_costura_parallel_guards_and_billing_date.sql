-- ============================================================================
-- Costura em paralelo (não mais depois de Aviamento/Mesa): fecha os 3 lugares
-- que ficaram para trás depois da decisão de 2026-06-28 (já refletida em
-- compute_wave_timeline via 20260701120000_costura-parallel-prep-wave-timeline.sql)
-- ============================================================================
-- 1) fn_guard_manual_stage_transition: ainda exigia 'Aviamento' concluído antes
--    de liberar 'Costura' (order_stages) — bloqueava trabalho legítimo no chão
--    de fábrica.
-- 2) fn_guard_wave_stage_transition: mesma dependência obsoleta, mas no board
--    de onda (production_wave_stages).
-- 3) compute_min_billing_date: somava o lead time de Costura DEPOIS do
--    GREATEST(palmilha, forração, mesa) em vez de incluí-lo no próprio GREATEST
--    — data mínima de faturamento ficava mais conservadora (e divergente de
--    compute_wave_timeline) do que a agenda real de produção permite.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_manual_stage_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_required text[];
  v_blocking text;
  v_blocking_status text;
BEGIN
  IF NEW.status <> 'em_andamento' OR OLD.status <> 'pendente' THEN
    RETURN NEW;
  END IF;

  v_required := CASE NEW.stage_name
    -- Setores prep — paralelos, podem iniciar em qualquer ordem (Costura
    -- incluída desde 2026-06-28: roda em paralelo com Aviamento, não mais
    -- depois dele).
    WHEN 'Corte Palmilha' THEN ARRAY[]::text[]
    WHEN 'Corte Forração' THEN ARRAY[]::text[]
    WHEN 'Aviamento'      THEN ARRAY[]::text[]
    WHEN 'Mesa'           THEN ARRAY[]::text[]   -- legacy = Aviamento
    WHEN 'Silk'           THEN ARRAY[]::text[]
    WHEN 'Costura'        THEN ARRAY[]::text[]
    WHEN 'Colagem'        THEN ARRAY['Corte Palmilha','Costura']
    WHEN 'Montagem'       THEN ARRAY['Colagem']
    WHEN 'Solagem'        THEN ARRAY['Montagem']
    WHEN 'Acabamento'     THEN ARRAY['Solagem']
    WHEN 'Expedição'      THEN ARRAY['Acabamento']
    ELSE NULL
  END;

  IF v_required IS NULL OR cardinality(v_required) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT stage_name, status
    INTO v_blocking, v_blocking_status
  FROM public.order_stages
  WHERE order_id = NEW.order_id
    AND stage_name = ANY(v_required)
    AND status <> 'concluido'
  LIMIT 1;

  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'Setor "%": não pode iniciar porque o setor pré-requisito "%" não está finalizado (status atual: %).',
      NEW.stage_name, v_blocking, v_blocking_status;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_wave_stage_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_required production_stage_enum[];
  v_blocking production_stage_enum;
  v_blocking_status stage_status_enum;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'in_progress'
     AND OLD.status IN ('pending','blocked') THEN

    v_required := CASE NEW.stage::text
      WHEN 'corte'           THEN ARRAY[]::production_stage_enum[]
      WHEN 'corte_palmilha'  THEN ARRAY[]::production_stage_enum[]
      WHEN 'palmilha'        THEN ARRAY[]::production_stage_enum[]
      WHEN 'corte_forracao'  THEN ARRAY[]::production_stage_enum[]
      WHEN 'corte_cabedal'   THEN ARRAY[]::production_stage_enum[]
      WHEN 'mesa'            THEN ARRAY[]::production_stage_enum[]
      WHEN 'silk'            THEN ARRAY[]::production_stage_enum[]
      WHEN 'costura'         THEN ARRAY[]::production_stage_enum[]
      WHEN 'colagem'         THEN ARRAY['corte_palmilha','costura']::production_stage_enum[]
      WHEN 'montagem'        THEN ARRAY['colagem']::production_stage_enum[]
      WHEN 'solagem'         THEN ARRAY['montagem']::production_stage_enum[]
      WHEN 'acabamento'      THEN ARRAY['solagem']::production_stage_enum[]
      WHEN 'expedicao'       THEN ARRAY['acabamento']::production_stage_enum[]
      ELSE NULL
    END;

    IF v_required IS NOT NULL AND cardinality(v_required) > 0 THEN
      SELECT stage, status
        INTO v_blocking, v_blocking_status
      FROM public.production_wave_stages
      WHERE wave_id = NEW.wave_id
        AND stage = ANY(v_required)
        AND status <> 'completed'
      LIMIT 1;

      IF v_blocking IS NOT NULL THEN
        RAISE EXCEPTION
          'Setor "%": não pode iniciar porque o setor pré-requisito "%" não está finalizado (status atual: %).',
          NEW.stage, v_blocking, v_blocking_status::text;
      END IF;
    END IF;

    NEW.started_at := COALESCE(NEW.started_at, now());
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    NEW.finished_at := COALESCE(NEW.finished_at, now());
    NEW.progress_pct := 100;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_min_billing_date(p_sale_order_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_palmilha int := 0; v_lead_forracao int := 0; v_lead_costura int := 0; v_lead_mesa int := 0;
  v_lead_silk int := 0; v_lead_colagem int := 0; v_lead_montagem int := 0; v_lead_solagem int := 0;
  v_lead_acab int := 0; v_lead_buffer int := 0; v_lead_supplier int := 0;
  v_total_business_days int := 0; v_raw_date date; v_next_tue date; v_next_fri date;
BEGIN
  SELECT
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
      THEN CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
      ELSE 0 END), 0),
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
  WHERE soi.sale_order_id = p_sale_order_id;
  IF v_lead_palmilha IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(MAX(CASE WHEN COALESCE(needed.total_needed,0) > GREATEST(0, COALESCE(p.quantity,0) - COALESCE(p.reserved_stock,0))
         THEN public.get_effective_supplier_lead_days(p.id, NULL) ELSE 0 END), 0)
    INTO v_lead_supplier
    FROM (SELECT sm.product_id, SUM(sm.quantity_per_unit*soi.quantity) AS total_needed
            FROM sale_order_items soi JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
           WHERE soi.sale_order_id = p_sale_order_id GROUP BY sm.product_id) AS needed
    JOIN products p ON p.id = needed.product_id;
  -- Costura roda em PARALELO com Corte Palmilha/Corte Forração/Mesa (decisão
  -- 2026-06-28, já refletida em compute_wave_timeline) — entra no GREATEST
  -- junto dos outros preps, não mais somada depois. Mantém paridade entre as
  -- duas engines de prazo.
  v_total_business_days := COALESCE(v_lead_supplier, 0) + COALESCE(v_lead_buffer, 2)
    + GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa, v_lead_costura)
    + COALESCE(v_lead_silk, 0) + COALESCE(v_lead_colagem, 0)
    + COALESCE(v_lead_montagem, 2) + COALESCE(v_lead_solagem, 0) + COALESCE(v_lead_acab, 1);
  v_raw_date := public.add_business_days(CURRENT_DATE, v_total_business_days)::date;
  v_next_tue := public.next_dow(v_raw_date, 2);
  v_next_fri := public.next_dow(v_raw_date, 5);
  RETURN LEAST(v_next_tue, v_next_fri);
END;
$function$;
