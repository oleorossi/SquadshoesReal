-- Já aplicada no cknb (15/11/2026) via MCP com o carimbo de calendário 20261115125806 (corrige_devolucao_e_views_private_costura).
-- Idempotente: pode ser reexecutada pelo workflow de migrations sem efeito adicional
-- (CREATE OR REPLACE, DROP TRIGGER IF EXISTS, GRANT/REVOKE determinísticos).
-- 1) increment_qty_devolvida: sale_order_items não tem updated_at (a função falhava com 42703).
CREATE OR REPLACE FUNCTION public.increment_qty_devolvida(p_sale_order_item_id uuid, p_qty numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current numeric;
  v_total numeric;
  v_new_qty numeric;
BEGIN
  SELECT COALESCE(qty_devolvida, 0), COALESCE(quantity, 0)
    INTO v_current, v_total
    FROM public.sale_order_items
   WHERE id = p_sale_order_item_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_order_item_id % não encontrado', p_sale_order_item_id;
  END IF;

  v_new_qty := v_current + p_qty;
  IF v_new_qty > v_total THEN
    RAISE EXCEPTION 'Devolução excede saldo: tentou +%, total %, já devolvido %',
      round(p_qty, 2), round(v_total, 2), round(v_current, 2);
  END IF;

  UPDATE public.sale_order_items
     SET qty_devolvida = v_new_qty
   WHERE id = p_sale_order_item_id;

  RETURN jsonb_build_object(
    'sale_order_item_id', p_sale_order_item_id,
    'previous', v_current,
    'increment', p_qty,
    'new_qty_devolvida', v_new_qty,
    'remaining', v_total - v_new_qty
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.increment_qty_devolvida(uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;

-- 2) Views movidas para o schema private: funções ainda apontavam para public.<view> (cron
--    notify-costura-overflow-daily falhava com 42P01). Só troca a referência; corpo igual.
CREATE OR REPLACE FUNCTION public.generate_rop_purchase_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_supplier RECORD; v_prod RECORD; v_po_id uuid; v_total numeric; v_qty numeric;
  v_sup_id uuid; v_sup_name text;
  v_unit_po text; v_price_po numeric; v_rate numeric;
  v_created int := 0; v_appended int := 0; v_items_added int := 0;
  v_idem text; v_po_status text;
BEGIN
  FOR v_supplier IN
    SELECT suggested_supplier_id, COALESCE(suggested_supplier, 'A definir') AS supplier_name
      FROM private.v_products_below_rop
     WHERE NOT has_active_po
       AND NOT COALESCE(is_artisanal, false)
     GROUP BY suggested_supplier_id, suggested_supplier
  LOOP
    v_sup_id := v_supplier.suggested_supplier_id;
    IF v_sup_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_sup_id) THEN
      v_sup_id := NULL;
    END IF;
    v_sup_name := v_supplier.supplier_name;
    v_idem := 'rop:' || COALESCE(v_sup_id::text, 'none') || ':' || to_char(now(), 'YYYY-MM-DD');

    SELECT id, status INTO v_po_id, v_po_status FROM public.purchase_orders
     WHERE idempotency_key = v_idem
       AND status NOT IN ('cancelled', 'received', 'receiving')
     LIMIT 1;

    IF v_po_id IS NOT NULL AND v_po_status IS DISTINCT FROM 'suggested' THEN
      CONTINUE;
    END IF;

    IF v_po_id IS NULL THEN
      SELECT id INTO v_po_id FROM public.purchase_orders
       WHERE COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(v_sup_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND status = 'suggested' AND auto_generated = true
         AND created_at > now() - interval '7 days'
       ORDER BY created_at DESC LIMIT 1;
    END IF;

    IF v_po_id IS NULL THEN
      INSERT INTO public.purchase_orders (status, supplier_id, supplier_name, total_value,
                                          auto_generated, notes, source_type, idempotency_key)
      VALUES ('suggested', v_sup_id, v_sup_name, 0, true,
        'Sugestao automatica ROP em ' || to_char(now(), 'DD/MM/YYYY HH24:MI'),
        'rop', v_idem)
      RETURNING id INTO v_po_id;
      v_created := v_created + 1;
    ELSE
      v_appended := v_appended + 1;
    END IF;
    v_total := COALESCE((SELECT total_value FROM public.purchase_orders WHERE id = v_po_id), 0);
    FOR v_prod IN
      SELECT * FROM private.v_products_below_rop
       WHERE NOT has_active_po
         AND NOT COALESCE(is_artisanal, false)
         AND COALESCE(suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(v_supplier.suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LOOP
      IF EXISTS (SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id = v_po_id AND product_id = v_prod.product_id) THEN CONTINUE; END IF;
      v_rate := COALESCE(NULLIF(v_prod.conversion_rate, 0), 1);
      v_qty := v_prod.suggested_qty / v_rate;
      v_price_po := COALESCE(v_prod.unit_price, 0) * v_rate;
      v_unit_po := COALESCE(v_prod.purchase_order_unit, v_prod.unit);
      v_qty := GREATEST(v_qty, COALESCE(v_prod.supplier_moq, 1));
      IF public.is_countable_purchase_unit(v_unit_po) THEN
        v_qty := CEIL(v_qty);
      END IF;
      IF COALESCE(v_prod.purchase_multiple, 0) > 1 THEN
        v_qty := CEIL(v_qty / v_prod.purchase_multiple) * v_prod.purchase_multiple;
      END IF;
      INSERT INTO public.purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
      VALUES (v_po_id, v_prod.product_id, v_prod.stock_qty, v_prod.min_stock, v_prod.max_stock, v_prod.suggested_qty, v_qty, v_price_po, v_unit_po);
      v_total := v_total + v_qty * v_price_po;
      v_items_added := v_items_added + 1;
    END LOOP;
    UPDATE public.purchase_orders
       SET total_value = COALESCE((
             SELECT SUM(COALESCE(i.quantity, 0) * COALESCE(i.unit_price, 0))
               FROM public.purchase_order_items i
              WHERE i.purchase_order_id = v_po_id
           ), 0)
     WHERE id = v_po_id;
  END LOOP;
  RETURN jsonb_build_object('pos_created', v_created, 'pos_appended', v_appended, 'items_added', v_items_added, 'run_at', now());
END;
$function$;
CREATE OR REPLACE FUNCTION public.notify_costura_overflow()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_created int := 0;
  v_resolved int := 0;
  v_rc int := 0;
  v_day record;
  v_week_key text;
  v_severity text;
  v_message text;
  v_active_keys text[];
BEGIN
  FOR v_day IN
    SELECT
      date_trunc('week', day)::date AS week_start,
      SUM(overflow_pairs) AS week_overflow,
      COUNT(*) FILTER (WHERE status = 'overflow') AS overflow_days,
      MAX(occupation_pct) AS max_occupation
    FROM private.v_costura_capacity_plan
    WHERE status = 'overflow' AND NOT is_weekend
      AND day BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
    GROUP BY date_trunc('week', day)
  LOOP
    v_week_key := 'costura_overflow:' || to_char(v_day.week_start, 'IYYY-IW');
    v_active_keys := COALESCE(v_active_keys, ARRAY[]::text[]) || v_week_key;

    IF v_day.max_occupation >= 200 THEN
      v_severity := 'critical';
    ELSE
      v_severity := 'warning';
    END IF;

    v_message := format(
      'Costura em overflow na semana de %s: %s pares acima da capacidade em %s dia(s) — considere terceirizar.',
      to_char(v_day.week_start, 'DD/MM'),
      v_day.week_overflow,
      v_day.overflow_days
    );

    INSERT INTO public.notifications (
      message, sector, category, severity, dedupe_key, link, payload, read
    )
    VALUES (
      v_message, 'Costura', 'production', v_severity, v_week_key,
      '/pcp?tab=costura-planner',
      jsonb_build_object(
        'week_start', v_day.week_start,
        'overflow_pairs', v_day.week_overflow,
        'overflow_days', v_day.overflow_days,
        'max_occupation_pct', v_day.max_occupation
      ),
      false
    )
    ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL
    DO UPDATE SET
      message = EXCLUDED.message,
      severity = EXCLUDED.severity,
      payload = EXCLUDED.payload;

    GET DIAGNOSTICS v_rc = ROW_COUNT;
    v_created := v_created + v_rc;
  END LOOP;

  UPDATE public.notifications
  SET resolved_at = now()
  WHERE category = 'production'
    AND dedupe_key LIKE 'costura_overflow:%'
    AND resolved_at IS NULL
    AND dedupe_key <> ALL(COALESCE(v_active_keys, ARRAY[]::text[]));

  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object(
    'created_or_updated', v_created,
    'resolved', v_resolved,
    'active_keys', COALESCE(v_active_keys, ARRAY[]::text[])
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.plan_costura_dispatch(p_horizon_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_day_data jsonb;
  v_day record;
  v_orders jsonb;
  v_chosen_orders uuid[] := ARRAY[]::uuid[];
  v_remaining int;
BEGIN
  FOR v_day IN
    SELECT day, overflow_pairs
    FROM private.v_costura_capacity_plan
    WHERE status = 'overflow' AND NOT is_weekend
      AND day BETWEEN CURRENT_DATE AND CURRENT_DATE + (p_horizon_days || ' days')::interval
    ORDER BY day
  LOOP
    v_remaining := v_day.overflow_pairs;

    WITH candidates AS (
      SELECT
        b.order_id,
        b.sale_order_id,
        b.sale_order_number,
        b.sale_order_deadline,
        b.reference_id,
        b.color,
        b.quantity,
        b.needed_date,
        b.material_ready,
        o.order_number,
        o.planned_delivery,
        COALESCE(NULLIF(ts.model, ''), ts.name) AS sheet_name,
        SUM(b.quantity) OVER (ORDER BY b.sale_order_deadline NULLS LAST, b.needed_date
                              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
      FROM private.v_costura_backlog_30d b
      LEFT JOIN public.orders o ON o.id = b.order_id
      LEFT JOIN public.technical_sheets ts ON ts.id = b.reference_id
      WHERE b.needed_date = v_day.day
        AND NOT b.in_service_order
        AND NOT (b.order_id = ANY(v_chosen_orders))
      ORDER BY b.sale_order_deadline NULLS LAST, b.needed_date
    ),
    picked AS (
      SELECT * FROM candidates
      WHERE running_total - quantity < v_remaining
    )
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'order_id', order_id,
        'order_number', order_number,
        'sale_order_id', sale_order_id,
        'sale_order_number', sale_order_number,
        'sale_order_deadline', sale_order_deadline,
        'reference_id', reference_id,
        'sheet_name', sheet_name,
        'color', color,
        'quantity', quantity,
        'needed_date', needed_date,
        'planned_delivery', planned_delivery,
        'material_ready', material_ready,
        'pairs_per_day', NULL
      ) ORDER BY sale_order_deadline NULLS LAST, needed_date), '[]'::jsonb)
    INTO v_orders
    FROM picked;

    v_chosen_orders := v_chosen_orders || ARRAY(
      SELECT (x->>'order_id')::uuid FROM jsonb_array_elements(v_orders) x
    );

    v_day_data := jsonb_build_object(
      'day', v_day.day,
      'week_iso', date_trunc('week', v_day.day)::date,
      'overflow_pairs', v_day.overflow_pairs,
      'contributing_orders', v_orders,
      'covered_pairs', (
        SELECT COALESCE(SUM((x->>'quantity')::int), 0)
        FROM jsonb_array_elements(v_orders) x
      )
    );

    v_result := v_result || jsonb_build_array(v_day_data);
  END LOOP;

  RETURN jsonb_build_object(
    'horizon_days', p_horizon_days,
    'computed_at', now(),
    'overflow_days', v_result
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.suggest_pv_deadline(p_sale_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_suggested_date date;
  v_capacity int;
  v_load_30d int;
  v_overflow_days int;
  v_total_quantity int;
  v_missing jsonb := '[]'::jsonb;
  v_missing_count int := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_no_lead_count int := 0;
BEGIN
  v_suggested_date := public.compute_min_billing_date(p_sale_order_id);

  SELECT costura_pairs_per_day_total INTO v_capacity
  FROM public.production_settings WHERE id = true;

  SELECT COALESCE(SUM(quantity), 0)::int INTO v_load_30d
  FROM private.v_costura_backlog_30d;

  SELECT COUNT(*)::int INTO v_overflow_days
  FROM private.v_costura_capacity_plan
  WHERE status = 'overflow' AND NOT is_weekend;

  SELECT COALESCE(SUM(quantity), 0)::int INTO v_total_quantity
  FROM public.sale_order_items WHERE sale_order_id = p_sale_order_id;

  -- Aggregate missing materials BY product+color (collapse duplicate rows)
  -- and limit top 20 by shortage to keep payload small
  WITH agg AS (
    SELECT 
      product_id, 
      MIN(product_name) AS product_name,
      color,
      SUM(needed_qty) AS needed_qty,
      MIN(stock_qty) AS stock_qty,
      SUM(shortage) AS shortage,
      MIN(supplier_name) AS supplier_name,
      MIN(supplier_lead_time_days) AS supplier_lead_time_days,
      MIN(unit) AS unit
    FROM public.get_wave_material_needs(ARRAY[p_sale_order_id])
    WHERE shortage > 0
    GROUP BY product_id, color
  )
  SELECT 
    COUNT(*)::int,
    COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY shortage DESC) FILTER (WHERE rn <= 20), '[]'::jsonb)
  INTO v_missing_count, v_missing
  FROM (SELECT *, row_number() OVER (ORDER BY shortage DESC) AS rn FROM agg) t;

  -- Count distinct supplier gaps from the same agg (best-effort warning)
  SELECT COUNT(*) FILTER (WHERE supplier_name IS NULL)
  INTO v_no_lead_count
  FROM (
    SELECT 
      product_id, 
      color,
      MIN(supplier_name) AS supplier_name
    FROM public.get_wave_material_needs(ARRAY[p_sale_order_id])
    WHERE shortage > 0
    GROUP BY product_id, color
  ) g;

  IF v_no_lead_count > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format('%s material(is) sem fornecedor cadastrado — usando 10 dias como estimativa', v_no_lead_count)
    );
  END IF;

  IF v_overflow_days > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format('Costura tem %s dia(s) em overflow nos próximos 30 dias — capacidade atual: %s pares/dia', v_overflow_days, v_capacity)
    );
  END IF;

  IF v_suggested_date IS NULL THEN
    v_warnings := v_warnings || jsonb_build_array('Não foi possível calcular data sugerida — verifique se PV tem itens com ficha técnica');
  END IF;

  RETURN jsonb_build_object(
    'suggested_date', v_suggested_date,
    'sale_order_total_pairs', v_total_quantity,
    'capacity_per_day', v_capacity,
    'current_costura_load_30d', v_load_30d,
    'overflow_days_30d', v_overflow_days,
    'missing_materials_count', v_missing_count,
    'missing_materials', v_missing,
    'warnings', v_warnings,
    'computed_at', now()
  );
END;
$function$;
