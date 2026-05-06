DROP FUNCTION IF EXISTS public.create_solo_wave(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.create_solo_wave(p_sale_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave_id    uuid;
  v_wave_code  text;
  v_week_start date;
  v_week_end   date;
  v_order_num  text;
  v_item_id    uuid;
  v_row        RECORD;
  v_mesa_cap   int := 0;
  v_needs_palm boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  v_week_start := date_trunc('week', current_date)::date;
  v_week_end   := v_week_start + 6;

  SELECT COALESCE(order_number, id::text) INTO v_order_num
    FROM sale_orders WHERE id = p_sale_order_id;

  v_wave_code := 'PV-' || v_order_num;

  INSERT INTO production_waves(code, week_start, week_end, status, created_by, start_mode)
  VALUES (v_wave_code, v_week_start, v_week_end, 'draft', auth.uid(), 'auto')
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  -- Setores base (sempre presentes)
  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY['corte','costura','montagem','solagem','acabamento']) AS s
  ON CONFLICT DO NOTHING;

  -- Palmilha: quando ao menos um item não usa palmilha pronta
  SELECT EXISTS (
    SELECT 1 FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = p_sale_order_id
      AND (ts.insole_ready_made IS NULL OR ts.insole_ready_made = false)
  ) INTO v_needs_palm;

  IF v_needs_palm THEN
    INSERT INTO production_wave_stages(wave_id, stage, status)
    VALUES (v_wave_id, 'palmilha', 'pending')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Mesa: quando a referência exige (mesa_daily_capacity > 0)
  SELECT COALESCE(MAX(ts.mesa_daily_capacity), 0) INTO v_mesa_cap
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = p_sale_order_id
     AND ts.mesa_daily_capacity > 0;

  IF v_mesa_cap > 0 THEN
    INSERT INTO production_wave_stages(wave_id, stage, status, capacity_per_day)
    VALUES (v_wave_id, 'mesa', 'pending', v_mesa_cap)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Itens (agrupados por referência + solado + cor)
  FOR v_row IN
    SELECT
      soi.id                                  AS source_item_id,
      so.id                                   AS sale_order_id,
      so.client_id,
      COALESCE(c.razao_social, so.id::text)   AS store_name,
      soi.reference_id,
      COALESCE(soi.color, '')                 AS color,
      COALESCE(soi.quantity, 0)::numeric      AS qty,
      COALESCE(soi.grade, '{}'::jsonb)        AS grade,
      (SELECT sole_product_id
         FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
    WHERE so.id = p_sale_order_id
  LOOP
    INSERT INTO production_wave_items(wave_id, reference_id, sole_product_id, color, total_quantity, grade)
    VALUES (v_wave_id, v_row.reference_id, v_row.sole_id, v_row.color, v_row.qty, v_row.grade)
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET total_quantity = production_wave_items.total_quantity + EXCLUDED.total_quantity
    RETURNING id INTO v_item_id;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id, client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id,
      v_row.client_id, v_row.store_name, v_row.qty, v_row.grade
    );
  END LOOP;

  UPDATE production_waves SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = v_wave_id), 0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = v_wave_id), 0),
    status = 'planning'
  WHERE id = v_wave_id;

  PERFORM public.start_wave(v_wave_id);

  RETURN v_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_solo_wave(uuid) TO authenticated;

-- Trigger do PV passa a chamar create_solo_wave
DROP FUNCTION IF EXISTS public.tg_sale_order_autostart_wave() CASCADE;
CREATE OR REPLACE FUNCTION public.tg_sale_order_autostart_wave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'Em Produção'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    BEGIN
      PERFORM public.create_solo_wave(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Falha ao criar onda automática para PV %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;