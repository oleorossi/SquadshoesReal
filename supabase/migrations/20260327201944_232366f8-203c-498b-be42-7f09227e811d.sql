
DROP FUNCTION IF EXISTS public.hybrid_debit_stock_for_order(p_reference_id uuid, p_order_quantity numeric, p_color text, p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(p_reference_id uuid, p_order_quantity numeric, p_color text DEFAULT ''::text, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  mat RECORD;
  required numeric;
  target_product_id uuid;
  target_name text;
  target_qty numeric;
  v_category text;
  v_is_immediate boolean;
  v_result jsonb := '[]'::jsonb;
  v_components jsonb;
  v_item jsonb;
  v_group_name text;
  v_consumption numeric;
  v_product_id uuid;
  v_direct_components jsonb;
  v_upper_material text; v_upper_consumption numeric;
  v_lining_material text; v_lining_consumption numeric;
  v_insole_material text; v_insole_consumption numeric;
  v_lining_accessories jsonb;
  v_lining_debited boolean := false;
  v_upper_debited boolean := false;
  v_upper_accessories jsonb;
  -- Track group names already processed via BOM to avoid double-debit
  v_bom_group_names text[] := '{}';
  v_pg_name text;
BEGIN
  -- ========== 1) PROCESS sheet_materials (BOM) ==========
  FOR mat IN
    SELECT sm.product_id, sm.quantity_per_unit, p.quantity AS current_stock,
           p.name, p.group_id, p.color AS product_color, p.category
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id
  LOOP
    required := mat.quantity_per_unit * p_order_quantity;
    target_product_id := mat.product_id;
    target_name := mat.name;
    target_qty := mat.current_stock;
    v_category := LOWER(COALESCE(mat.category, ''));

    -- Track the group name of this BOM item to skip later in specs
    IF mat.group_id IS NOT NULL THEN
      SELECT pg.name INTO v_pg_name FROM public.product_groups pg WHERE pg.id = mat.group_id;
      IF v_pg_name IS NOT NULL THEN
        v_bom_group_names := array_append(v_bom_group_names, v_pg_name);
      END IF;
    END IF;

    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.name, p.quantity, p.category INTO target_product_id, target_name, target_qty, v_category
      FROM public.products p
      WHERE p.active = true AND p.color = p_color
        AND ((mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
             OR (mat.group_id IS NULL AND p.name = mat.name))
      LIMIT 1;
      IF target_product_id IS NULL THEN
        SELECT p.id, p.name, p.quantity, p.category INTO target_product_id, target_name, target_qty, v_category
        FROM public.products p
        WHERE p.active = true
          AND ((mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
               OR (mat.group_id IS NULL AND p.name = mat.name))
          AND LOWER(p.name) LIKE '%' || LOWER(p_color) || '%'
        LIMIT 1;
      END IF;
      IF target_product_id IS NULL THEN
        target_product_id := mat.product_id;
        target_name := mat.name;
        target_qty := mat.current_stock;
        v_category := LOWER(COALESCE(mat.category, ''));
      END IF;
    END IF;

    v_is_immediate := (v_category IN ('químico', 'quimico', 'cola', 'adesivo', 'cola / químico', 'embalagem'));
    IF v_is_immediate THEN
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      UPDATE products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required, 'Debito OP (' || target_name || ')', p_order_id);
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, target_product_id, required, required, 'consumed', 'hard');
      v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'debited');
    ELSE
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, target_product_id, required, 0, 'reserved', 'soft');
      v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'reserved');
    END IF;
  END LOOP;

  -- ========== 2) PROCESS specifications (Cabedal, Forro, Palmilha) ==========
  SELECT ts.upper_material, ts.upper_consumption, ts.lining_material, ts.lining_consumption,
         ts.insole_material, ts.insole_consumption, ts.lining_accessories, ts.components_accessories
  INTO v_upper_material, v_upper_consumption, v_lining_material, v_lining_consumption,
       v_insole_material, v_insole_consumption, v_lining_accessories, v_upper_accessories
  FROM public.technical_sheets ts WHERE ts.id = p_reference_id;

  -- ========== CABEDAL: Skip if already processed via BOM ==========
  v_upper_debited := false;

  -- Try main upper material (skip if already in BOM)
  IF NOT v_upper_debited AND v_upper_material IS NOT NULL AND v_upper_material <> '' AND COALESCE(v_upper_consumption, 0) > 0 THEN
    IF v_upper_material = ANY(v_bom_group_names) THEN
      v_upper_debited := true; -- Already handled via BOM
    ELSE
      target_product_id := NULL;
      required := v_upper_consumption * p_order_quantity;
      IF p_color <> '' THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p JOIN product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_upper_material AND p.color = p_color LIMIT 1;
        IF target_product_id IS NULL THEN
          SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
          FROM products p JOIN product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_upper_material AND LOWER(p.name) LIKE '%' || LOWER(p_color) || '%' LIMIT 1;
        END IF;
      END IF;
      IF target_product_id IS NOT NULL THEN
        IF target_qty < required THEN
          RAISE EXCEPTION 'Estoque insuficiente para Cabedal "%": disponivel %, necessario %', target_name, target_qty, required;
        END IF;
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
        VALUES (p_order_id, target_product_id, required, 0, 'reserved', 'soft');
        v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'reserved');
        v_upper_debited := true;
      END IF;
    END IF;
  END IF;

  -- Try upper accessories (alternative cabedal options) - skip if group already in BOM
  IF NOT v_upper_debited AND v_upper_accessories IS NOT NULL AND jsonb_typeof(v_upper_accessories) = 'array' AND jsonb_array_length(v_upper_accessories) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_upper_accessories) AS value
    LOOP
      IF v_upper_debited THEN EXIT; END IF;
      v_group_name := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      IF v_group_name = ANY(v_bom_group_names) THEN CONTINUE; END IF; -- Skip if already in BOM
      required := v_consumption * p_order_quantity;
      target_product_id := NULL;
      IF p_color <> '' THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p JOIN product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_group_name AND p.color = p_color LIMIT 1;
        IF target_product_id IS NULL THEN
          SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
          FROM products p JOIN product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_group_name AND LOWER(p.name) LIKE '%' || LOWER(p_color) || '%' LIMIT 1;
        END IF;
      END IF;
      IF target_product_id IS NOT NULL THEN
        IF target_qty < required THEN
          RAISE EXCEPTION 'Estoque insuficiente para Cabedal "%": disponivel %, necessario %', target_name, target_qty, required;
        END IF;
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
        VALUES (p_order_id, target_product_id, required, 0, 'reserved', 'soft');
        v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'reserved');
        v_upper_debited := true;
      END IF;
    END LOOP;
  END IF;

  -- ========== LINING: Skip if already processed via BOM ==========
  v_lining_debited := false;

  IF NOT v_lining_debited AND v_lining_material IS NOT NULL AND v_lining_material <> '' AND COALESCE(v_lining_consumption, 0) > 0 THEN
    IF v_lining_material = ANY(v_bom_group_names) THEN
      v_lining_debited := true; -- Already handled via BOM
    ELSE
      target_product_id := NULL;
      required := v_lining_consumption * p_order_quantity;
      IF p_color <> '' THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p JOIN product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_lining_material AND p.color = p_color LIMIT 1;
        IF target_product_id IS NULL THEN
          SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
          FROM products p JOIN product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_lining_material AND LOWER(p.name) LIKE '%' || LOWER(p_color) || '%' LIMIT 1;
        END IF;
      END IF;
      IF target_product_id IS NOT NULL THEN
        IF target_qty < required THEN
          RAISE EXCEPTION 'Estoque insuficiente para Forro "%": disponivel %, necessario %', target_name, target_qty, required;
        END IF;
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
        VALUES (p_order_id, target_product_id, required, 0, 'reserved', 'soft');
        v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'reserved');
        v_lining_debited := true;
      END IF;
    END IF;
  END IF;

  -- Lining accessories - skip if group already in BOM
  IF NOT v_lining_debited AND v_lining_accessories IS NOT NULL AND jsonb_typeof(v_lining_accessories) = 'array' AND jsonb_array_length(v_lining_accessories) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_lining_accessories) AS value
    LOOP
      IF v_lining_debited THEN EXIT; END IF;
      v_group_name := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      IF v_group_name = ANY(v_bom_group_names) THEN CONTINUE; END IF; -- Skip if already in BOM
      required := v_consumption * p_order_quantity;
      target_product_id := NULL;
      IF p_color <> '' THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p JOIN product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_group_name AND p.color = p_color LIMIT 1;
        IF target_product_id IS NULL THEN
          SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
          FROM products p JOIN product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_group_name AND LOWER(p.name) LIKE '%' || LOWER(p_color) || '%' LIMIT 1;
        END IF;
      END IF;
      IF target_product_id IS NOT NULL THEN
        IF target_qty < required THEN
          RAISE EXCEPTION 'Estoque insuficiente para Forro "%": disponivel %, necessario %', target_name, target_qty, required;
        END IF;
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
        VALUES (p_order_id, target_product_id, required, 0, 'reserved', 'soft');
        v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'reserved');
        v_lining_debited := true;
      END IF;
    END LOOP;
  END IF;

  -- Palmilha - SOFT reservation (skip if already in BOM)
  IF v_insole_material IS NOT NULL AND v_insole_material <> '' AND COALESCE(v_insole_consumption, 0) > 0 THEN
    IF NOT (v_insole_material = ANY(v_bom_group_names)) THEN
      required := v_insole_consumption * p_order_quantity;
      target_product_id := NULL;
      IF p_color <> '' THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p JOIN product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_insole_material AND p.color = p_color LIMIT 1;
      END IF;
      IF target_product_id IS NULL AND p_color <> '' THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p JOIN product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_insole_material AND LOWER(p.name) LIKE '%' || LOWER(p_color) || '%' LIMIT 1;
      END IF;
      IF target_product_id IS NULL THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p JOIN product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_insole_material LIMIT 1;
      END IF;
      IF target_product_id IS NOT NULL THEN
        IF target_qty < required THEN
          RAISE EXCEPTION 'Estoque insuficiente para Palmilha "%": disponivel %, necessario %', target_name, target_qty, required;
        END IF;
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
        VALUES (p_order_id, target_product_id, required, 0, 'reserved', 'soft');
        v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'reserved');
      END IF;
    END IF;
  END IF;

  -- ========== 3) PROCESS direct_components (HARD debit) ==========
  SELECT ts.direct_components INTO v_direct_components FROM technical_sheets ts WHERE ts.id = p_reference_id;
  IF v_direct_components IS NOT NULL AND jsonb_typeof(v_direct_components) = 'array' AND jsonb_array_length(v_direct_components) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_direct_components) AS value
    LOOP
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      required := v_consumption * p_order_quantity;
      v_product_id := NULL;
      BEGIN v_product_id := (v_item ->> 'id')::uuid; EXCEPTION WHEN OTHERS THEN v_product_id := NULL; END;
      IF v_product_id IS NOT NULL THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p WHERE p.id = v_product_id AND p.active = true;
        IF target_product_id IS NULL THEN RAISE EXCEPTION 'Componente nao encontrado (ID: %)', v_product_id; END IF;
      ELSE
        CONTINUE;
      END IF;
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      UPDATE products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required, 'Debito Componente (' || target_name || ')', p_order_id);
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, target_product_id, required, required, 'consumed', 'hard');
      v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'debited');
    END LOOP;
  END IF;

  RETURN v_result;
END;
$function$;
