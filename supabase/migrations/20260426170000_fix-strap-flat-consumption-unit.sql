-- Fix: debit_strap_stock flat path unit mismatch
--
-- When consumption_per_size exists, the UI stores strap.consumption as the
-- average of the per-size values (in cm). But the flat fallback path used
-- v_consumption * p_order_quantity treating it as meters, causing 100x over-debit
-- on grade-less orders when per-size data is present.
--
-- Fix: when v_per_size is non-empty (consumption was set from per-size cm values),
-- divide by 100 to convert cm → meters before multiplying by order quantity.
-- Legacy data (no v_per_size) keeps the original meters-direct behaviour.

DROP FUNCTION IF EXISTS public.debit_strap_stock(p_strap_colors jsonb, p_order_quantity integer, p_order_id uuid, p_order_grade jsonb) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_strap_stock(
  p_strap_colors jsonb,
  p_order_quantity integer,
  p_order_id uuid DEFAULT NULL::uuid,
  p_order_grade jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_product_id uuid;
  v_product_name text;
  v_current_qty numeric;
  v_required numeric;
  v_consumption numeric;
  v_per_size jsonb;
  v_size text;
  v_pairs numeric;
  v_cm_per_pair numeric;
  v_total_cm numeric;
  v_grade_total numeric;
  v_fichas numeric;
  v_per_size_has_data boolean;
BEGIN
  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) != 'array' OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';

    BEGIN
      v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_group_id := NULL;
    END;

    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN
      CONTINUE;
    END IF;

    v_per_size := v_strap -> 'consumption_per_size';
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 1);
    IF v_consumption <= 0 THEN v_consumption := 1; END IF;

    -- Check whether per-size data actually contains values
    v_per_size_has_data := v_per_size IS NOT NULL
      AND jsonb_typeof(v_per_size) = 'object'
      AND v_per_size <> '{}'::jsonb;

    IF v_per_size_has_data
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      -- Grade-based: sum(pairs × cm_per_size) then convert to meters
      v_total_cm := 0;
      v_grade_total := 0;

      FOR v_size, v_pairs IN
        SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        -- v_consumption fallback is also in cm (set from per-size average in UI)
        v_cm_per_pair := COALESCE(NULLIF((v_per_size ->> v_size)::numeric, 0), v_consumption);
        v_total_cm    := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;

      IF v_grade_total > 0 THEN
        v_fichas := GREATEST(1, round(p_order_quantity::numeric / v_grade_total));
      ELSE
        v_fichas := 1;
      END IF;

      v_required := (v_total_cm * v_fichas) / 100; -- cm → meters

    ELSIF v_per_size_has_data THEN
      -- Per-size data exists but no grade (flat order):
      -- v_consumption was saved as cm average → divide by 100 to get meters
      v_required := (v_consumption / 100.0) * p_order_quantity;

    ELSE
      -- Legacy: no per-size data; v_consumption is already in meters per pair
      v_required := v_consumption * p_order_quantity;
    END IF;

    IF v_required <= 0 THEN CONTINUE; END IF;

    -- Find matching product: same group + same color
    SELECT p.id, p.name, p.quantity
    INTO v_product_id, v_product_name, v_current_qty
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND p.color = v_color
    LIMIT 1;

    IF v_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity
      INTO v_product_id, v_product_name, v_current_qty
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_group_id
        AND (p.color IS NULL OR trim(p.color) = '')
      LIMIT 1;
    END IF;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Material da tira nao encontrado no estoque (grupo: %)', v_group_id;
    END IF;

    IF v_current_qty < v_required THEN
      RAISE EXCEPTION 'Estoque insuficiente para tira "%" (cor: %): disponivel %, necessario %',
        v_product_name, v_color, v_current_qty, v_required;
    END IF;

    UPDATE public.products
    SET quantity = quantity - v_required, updated_at = now()
    WHERE id = v_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_product_id, 'out', v_required,
      v_current_qty, v_current_qty - v_required,
      'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color
        || ' - ' || round(v_required, 4) || 'm x ' || p_order_quantity || ' pares',
      p_order_id
    );
  END LOOP;
END;
$function$;
