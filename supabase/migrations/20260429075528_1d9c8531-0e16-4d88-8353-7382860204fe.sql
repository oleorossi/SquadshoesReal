-- Auto-create and start a production wave when a sale order moves to "Em Produção".
DROP FUNCTION IF EXISTS public.create_wave_from_sale_order(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.create_wave_from_sale_order(p_sale_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wave_id        uuid;
  v_order          record;
  v_code           text;
  v_week_start     date;
  v_week_end       date;
  v_now            timestamptz := now();
  v_total_pairs    numeric := 0;
  v_total_items    int := 0;
  v_has_mesa       boolean := false;
  v_first_stage    production_stage_enum;
BEGIN
  -- Block duplicates: if an active wave already references this PV, return it.
  SELECT pw.id INTO v_wave_id
    FROM production_waves pw
    JOIN production_wave_items pwi ON pwi.wave_id = pw.id
    JOIN production_wave_item_sources pws ON pws.wave_item_id = pwi.id
   WHERE pws.sale_order_id = p_sale_order_id
     AND pw.status NOT IN ('finished', 'cancelled')
   LIMIT 1;

  IF v_wave_id IS NOT NULL THEN
    RETURN v_wave_id;
  END IF;

  SELECT id, order_number, client_id, client_name, delivery_deadline
    INTO v_order
    FROM sale_orders
   WHERE id = p_sale_order_id;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pedido de venda não encontrado: %', p_sale_order_id;
  END IF;

  v_code       := 'PV-' || COALESCE(v_order.order_number, p_sale_order_id::text);
  v_week_start := date_trunc('week', COALESCE(v_order.delivery_deadline, v_now::date))::date;
  v_week_end   := v_week_start + 6;

  -- Ensure unique code (should not collide due to dedup above, but safe).
  IF EXISTS (SELECT 1 FROM production_waves WHERE code = v_code) THEN
    v_code := v_code || '-' || to_char(v_now, 'YYYYMMDDHH24MISS');
  END IF;

  INSERT INTO production_waves (code, week_start, week_end, status, start_mode, earliest_deadline, notes)
  VALUES (v_code, v_week_start, v_week_end, 'planning', 'auto', v_order.delivery_deadline,
          'Onda gerada automaticamente do PV ' || COALESCE(v_order.order_number, ''))
  RETURNING id INTO v_wave_id;

  -- Aggregate items by reference + color (sole_product_id null at this stage).
  WITH agg AS (
    SELECT soi.reference_id,
           soi.color,
           SUM(soi.quantity)::numeric AS qty,
           jsonb_object_agg(g.key, g.value::int) FILTER (WHERE g.value IS NOT NULL) AS grade_agg
      FROM sale_order_items soi
      LEFT JOIN LATERAL jsonb_each_text(COALESCE(soi.grade, '{}'::jsonb)) g ON true
     WHERE soi.sale_order_id = p_sale_order_id
     GROUP BY soi.reference_id, soi.color
  ),
  ins_items AS (
    INSERT INTO production_wave_items (wave_id, reference_id, color, total_quantity, grade, sort_order)
    SELECT v_wave_id, agg.reference_id, COALESCE(agg.color, ''), agg.qty,
           COALESCE(agg.grade_agg, '{}'::jsonb),
           row_number() OVER (ORDER BY agg.reference_id, agg.color) - 1
      FROM agg
    RETURNING id, reference_id, color, total_quantity
  )
  SELECT COUNT(*), COALESCE(SUM(total_quantity), 0)
    INTO v_total_items, v_total_pairs
    FROM ins_items;

  -- Source mapping per sale order item.
  INSERT INTO production_wave_item_sources (wave_item_id, sale_order_id, sale_order_item_id, client_id, store_name, quantity, grade)
  SELECT pwi.id, p_sale_order_id, soi.id, v_order.client_id, v_order.client_name, soi.quantity, COALESCE(soi.grade, '{}'::jsonb)
    FROM sale_order_items soi
    JOIN production_wave_items pwi
      ON pwi.wave_id = v_wave_id
     AND pwi.reference_id = soi.reference_id
     AND pwi.color = COALESCE(soi.color, '')
   WHERE soi.sale_order_id = p_sale_order_id;

  UPDATE production_waves
     SET total_items = v_total_items,
         total_pairs = v_total_pairs
   WHERE id = v_wave_id;

  -- Detect whether any reference has mesa_daily_capacity > 0.
  SELECT EXISTS (
    SELECT 1
      FROM production_wave_items pwi
      JOIN technical_sheets ts ON ts.id = pwi.reference_id
     WHERE pwi.wave_id = v_wave_id
       AND COALESCE(ts.mesa_daily_capacity, 0) > 0
  ) INTO v_has_mesa;

  -- Seed all 7 stages as pending.
  INSERT INTO production_wave_stages (wave_id, stage, status)
  SELECT v_wave_id, s, 'pending'::stage_status_enum
    FROM unnest(ARRAY['corte','palmilha','costura','mesa','montagem','solagem','acabamento']::production_stage_enum[]) AS s;

  -- Auto-start: corte always; mesa only if capacity > 0.
  UPDATE production_wave_stages
     SET status     = 'in_progress',
         started_at = v_now,
         updated_at = v_now
   WHERE wave_id = v_wave_id
     AND (stage = 'corte' OR (stage = 'mesa' AND v_has_mesa));

  SELECT stage INTO v_first_stage
    FROM production_wave_stages
   WHERE wave_id = v_wave_id
     AND stage = 'corte'
   LIMIT 1;

  UPDATE production_waves
     SET status        = 'running',
         current_stage = v_first_stage,
         started_at    = v_now
   WHERE id = v_wave_id;

  RETURN v_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_wave_from_sale_order(uuid) TO authenticated;

-- Trigger: when a sale order transitions to "Em Produção", auto-create the wave.
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
      PERFORM public.create_wave_from_sale_order(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Falha ao criar onda automática para PV %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_order_autostart_wave ON public.sale_orders;
CREATE TRIGGER trg_sale_order_autostart_wave
AFTER INSERT OR UPDATE OF status ON public.sale_orders
FOR EACH ROW
EXECUTE FUNCTION public.tg_sale_order_autostart_wave();