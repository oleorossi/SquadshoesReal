-- 0. DROP existing function that needs return type change
DROP FUNCTION IF EXISTS public.compute_wave_timeline(uuid[]);

-- 2. REPLACE stage_order()
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    -- ── New canonical ordering ──
    WHEN 'corte_palmilha' THEN 1
    WHEN 'corte_forracao' THEN 2
    WHEN 'mesa'           THEN 3
    WHEN 'silk'           THEN 4
    WHEN 'colagem'        THEN 5
    WHEN 'montagem'       THEN 6
    WHEN 'solagem'        THEN 7
    WHEN 'acabamento'     THEN 8
    WHEN 'expedicao'      THEN 9
    -- ── Legacy backward-compat ──
    WHEN 'corte'          THEN 1
    WHEN 'palmilha'       THEN 1
    WHEN 'costura'        THEN 2
    ELSE 99
  END;
$$;

-- 3. CREATE sector_display_to_enum()
CREATE OR REPLACE FUNCTION public.sector_display_to_enum(p_name text)
RETURNS production_stage_enum
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(trim(p_name))
    WHEN 'corte palmilha'  THEN 'corte_palmilha'::production_stage_enum
    WHEN 'corte forração'  THEN 'corte_forracao'::production_stage_enum
    WHEN 'corte forracao'  THEN 'corte_forracao'::production_stage_enum
    WHEN 'mesa'            THEN 'mesa'::production_stage_enum
    WHEN 'silk'            THEN 'silk'::production_stage_enum
    WHEN 'colagem'         THEN 'colagem'::production_stage_enum
    WHEN 'montagem'        THEN 'montagem'::production_stage_enum
    WHEN 'solagem'         THEN 'solagem'::production_stage_enum
    WHEN 'acabamento'      THEN 'acabamento'::production_stage_enum
    WHEN 'expedição'       THEN 'expedicao'::production_stage_enum
    WHEN 'expedicao'       THEN 'expedicao'::production_stage_enum
    -- Legacy / alternate names
    WHEN 'corte'           THEN 'corte_palmilha'::production_stage_enum
    WHEN 'costura'         THEN 'corte_forracao'::production_stage_enum
    WHEN 'palmilha'        THEN 'corte_palmilha'::production_stage_enum
    WHEN 'aviamento'       THEN 'mesa'::production_stage_enum
    WHEN 'forração'        THEN 'corte_forracao'::production_stage_enum
    WHEN 'forracao'        THEN 'corte_forracao'::production_stage_enum
    WHEN 'forro'           THEN 'corte_forracao'::production_stage_enum
    WHEN 'serigrafia'      THEN 'silk'::production_stage_enum
    WHEN 'silkscreen'      THEN 'silk'::production_stage_enum
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.sector_display_to_enum(text) TO authenticated;

-- 4. REPLACE create_production_wave()
CREATE OR REPLACE FUNCTION public.create_production_wave(
  p_week_start date,
  p_sale_order_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave_id  uuid;
  v_code     text;
  v_week_end date;
  v_row      RECORD;
  v_item_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  v_week_end := p_week_start + 6;
  v_code := 'W' || to_char(p_week_start, 'IYYY-IW');

  INSERT INTO production_waves(code, week_start, week_end, status, created_by)
  VALUES (v_code, p_week_start, v_week_end, 'draft', auth.uid())
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  WITH sectors_needed AS (
    SELECT DISTINCT sector_display_to_enum(s.nm) AS stage
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      COALESCE(
        NULLIF(ts.production_sectors, 'null'::jsonb),
        '["Corte Palmilha","Corte Forração","Mesa","Silk","Colagem","Montagem","Solagem","Acabamento"]'::jsonb
      )
    ) AS s(nm)
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND sector_display_to_enum(s.nm) IS NOT NULL
  ),
  capacities(stage, cap) AS (
    SELECT 'corte_palmilha'::production_stage_enum, MAX(ts.sewing_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'corte_forracao'::production_stage_enum, MAX(ts.cutting_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'mesa'::production_stage_enum, MAX(ts.mesa_daily_capacity)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'silk'::production_stage_enum, MAX(ts.silk_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'colagem'::production_stage_enum, MAX(ts.gluing_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'montagem'::production_stage_enum, MAX(ts.assembly_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'solagem'::production_stage_enum, MAX(ts.soling_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'acabamento'::production_stage_enum, MAX(ts.finishing_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'expedicao'::production_stage_enum, 0
  )
  INSERT INTO production_wave_stages(wave_id, stage, status, capacity_per_day)
  SELECT v_wave_id, sn.stage, 'pending', COALESCE(c.cap, 0)
  FROM sectors_needed sn
  LEFT JOIN capacities c ON c.stage = sn.stage
  ON CONFLICT DO NOTHING;

  FOR v_row IN
    SELECT
      soi.id                                                         AS source_item_id,
      so.id                                                          AS sale_order_id,
      so.client_id                                                   AS client_id,
      COALESCE(c.razao_social, so.id::text)                          AS store_name,
      soi.reference_id                                               AS reference_id,
      COALESCE(soi.color, '')                                        AS color,
      COALESCE(soi.quantity, 0)::numeric                             AS qty,
      COALESCE(soi.grade, '{}'::jsonb)                               AS grade,
      (SELECT sole_product_id
         FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
    WHERE so.id = ANY(p_sale_order_ids)
  LOOP
    INSERT INTO production_wave_items(
      wave_id, reference_id, sole_product_id, color, total_quantity, grade
    )
    VALUES (
      v_wave_id, v_row.reference_id, v_row.sole_id,
      v_row.color, v_row.qty, v_row.grade
    )
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET total_quantity =
      production_wave_items.total_quantity + EXCLUDED.total_quantity
    RETURNING id INTO v_item_id;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id,
      client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id,
      v_row.client_id, v_row.store_name, v_row.qty, v_row.grade
    );
  END LOOP;

  UPDATE production_waves w
  SET
    total_pairs = COALESCE(
      (SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id), 0),
    total_items = COALESCE(
      (SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id), 0),
    status = 'planning'
  WHERE w.id = v_wave_id;

  RETURN v_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_wave(date, uuid[]) TO authenticated;

-- 5. REPLACE compute_wave_timeline()
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline     date,
  corte_start_date      date,
  costura_start_date    date,
  montagem_start_date   date,
  acabamento_start_date date,
  silk_start_date       date,
  colagem_start_date    date,
  solagem_start_date    date,
  material_ready_date   date,
  purchase_deadline     date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_palmilha  int;
  v_lead_forracao  int;
  v_lead_mesa      int;
  v_lead_silk      int;
  v_lead_colagem   int;
  v_lead_montagem  int;
  v_lead_solagem   int;
  v_lead_acab      int;
  v_lead_buffer    int;
  v_lead_supplier  int;
  v_deadline       date;
BEGIN
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  SELECT
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'corte_palmilha'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                          dlt.sewing_capacity_per_day, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                            dlt.sewing_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_costura_dias, 0),
                          dlt.lead_time_costura_dias, 1)
          END
        ELSE 0
      END
    ), 1),
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'corte_forracao'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                          dlt.cutting_capacity_per_day, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                            dlt.cutting_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_corte_dias, 0),
                          dlt.lead_time_corte_dias, 2)
          END
        ELSE 0
      END
    ), 0),
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'mesa'
        ) AND ts.mesa_daily_capacity > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.mesa_daily_capacity::numeric)::int)
        ELSE 0
      END
    ), 0),
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'silk'
        ) THEN
          CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day, 0), 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.silk_capacity_per_day::numeric)::int)
            ELSE 1 END
        ELSE 0
      END
    ), 0),
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'colagem'
        ) THEN
          CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day, 0), 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.gluing_capacity_per_day::numeric)::int)
            ELSE 1 END
        ELSE 0
      END
    ), 0),
    COALESCE(MAX(
      CASE
        WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                      dlt.assembly_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                        dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias, 0),
                      dlt.lead_time_montagem_dias, 2)
      END
    ), 2),
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'solagem'
        ) THEN
          CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day, 0), 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.soling_capacity_per_day::numeric)::int)
            ELSE 1 END
        ELSE 0
      END
    ), 0),
    COALESCE(MAX(
      CASE
        WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                      dlt.finishing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                        dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0),
                      dlt.lead_time_acabamento_dias, 1)
      END
    ), 1),
    COALESCE(MAX(COALESCE(
      NULLIF(ts.lead_time_buffer_material_dias, 0),
      dlt.lead_time_buffer_material_dias,
      2
    )), 2)
  INTO
    v_lead_palmilha, v_lead_forracao, v_lead_mesa,
    v_lead_silk, v_lead_colagem,
    v_lead_montagem, v_lead_solagem, v_lead_acab,
    v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 7) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id,
             SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  RETURN QUERY SELECT
    v_deadline,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao + v_lead_palmilha)
    )::date,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao)
    )::date,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem)
    )::date,
    add_business_days(v_deadline, -v_lead_acab)::date,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk)
    )::date,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem)
    )::date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem))::date,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao
        + v_lead_palmilha + v_lead_buffer)
    )::date,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao
        + v_lead_palmilha + v_lead_buffer + v_lead_supplier)
    )::date;
END;
$$;

-- 6. DATA MIGRATION — remap existing production_wave_stages rows
DO $$
BEGIN
  -- palmilha → corte_palmilha
  DELETE FROM production_wave_stages old
  WHERE old.stage = 'palmilha'
    AND EXISTS (
      SELECT 1 FROM production_wave_stages new
      WHERE new.wave_id = old.wave_id AND new.stage = 'corte_palmilha'
    );
  UPDATE production_wave_stages SET stage = 'corte_palmilha' WHERE stage = 'palmilha';

  -- corte → corte_palmilha
  DELETE FROM production_wave_stages old
  WHERE old.stage = 'corte'
    AND EXISTS (
      SELECT 1 FROM production_wave_stages new
      WHERE new.wave_id = old.wave_id AND new.stage = 'corte_palmilha'
    );
  UPDATE production_wave_stages SET stage = 'corte_palmilha' WHERE stage = 'corte';

  -- costura → corte_forracao
  DELETE FROM production_wave_stages old
  WHERE old.stage = 'costura'
    AND EXISTS (
      SELECT 1 FROM production_wave_stages new
      WHERE new.wave_id = old.wave_id AND new.stage = 'corte_forracao'
    );
  UPDATE production_wave_stages SET stage = 'corte_forracao' WHERE stage = 'costura';
END;
$$;