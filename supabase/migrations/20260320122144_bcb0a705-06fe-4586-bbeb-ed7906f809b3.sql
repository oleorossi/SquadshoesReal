
CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id uuid,
  p_color text,
  p_order_grade jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sole_group_id uuid;
  v_sole_material text;
  target_product_id uuid;
  target_name text;
  v_stock_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_new_grade jsonb;
  v_total_debited numeric := 0;
  v_prev_total numeric;
BEGIN
  -- Get sole_group_id and sole_material from technical sheet
  SELECT ts.sole_group_id, ts.sole_material
  INTO v_sole_group_id, v_sole_material
  FROM public.technical_sheets ts
  WHERE ts.id = p_reference_id;

  -- If no sole configured, skip
  IF v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '') THEN
    RETURN;
  END IF;

  -- If no grade provided, skip
  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  -- Find the sole product by group_id + color
  target_product_id := NULL;

  IF v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_sole_group_id
        AND UPPER(TRIM(p.color)) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_sole_group_id
      LIMIT 1;
    END IF;
  END IF;

  -- Fallback to sole_material (group name)
  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material
        AND UPPER(TRIM(p.color)) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material
      LIMIT 1;
    END IF;
  END IF;

  -- No sole product found, skip
  IF target_product_id IS NULL THEN
    RETURN;
  END IF;

  -- Initialize stock_grade if null
  IF v_stock_grade IS NULL THEN
    v_stock_grade := '{}'::jsonb;
  END IF;

  v_new_grade := v_stock_grade;
  v_prev_total := 0;

  -- Calculate previous total from stock_grade
  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade)
  LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- Validate availability for each size first
  FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponivel %, necessario %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- Debit each size
  FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  -- Update the product stock_grade and quantity
  IF v_total_debited > 0 THEN
    UPDATE public.products
    SET stock_grade = v_new_grade,
        quantity = GREATEST(0, quantity - v_total_debited),
        updated_at = now()
    WHERE id = target_product_id;

    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (target_product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
            'Debito Solado por grade (' || target_name || ')' || CASE WHEN p_color <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);
  END IF;
END;
$$;
