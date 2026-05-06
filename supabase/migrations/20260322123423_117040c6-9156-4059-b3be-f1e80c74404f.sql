
-- ========== HYBRID STOCK DEBIT RPC ==========
-- Aviamentos/Solas/Componentes = baixa imediata (hard)
-- Couros/Forros/Materiais variáveis = reserva (soft)
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
  p_reference_id uuid,
  p_order_quantity integer,
  p_color text DEFAULT '',
  p_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

    -- Color matching
    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.name, p.quantity, p.category INTO target_product_id, target_name, target_qty, v_category
      FROM public.products p
      WHERE p.active = true AND p.color = p_color
        AND ((mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
             OR (mat.group_id IS NULL AND p.name = mat.name))
      LIMIT 1;
      IF target_product_id IS NULL THEN
        target_product_id := mat.product_id;
        target_name := mat.name;
        target_qty := mat.current_stock;
        v_category := LOWER(COALESCE(mat.category, ''));
      END IF;
    END IF;

    -- Determine if immediate debit based on category
    v_is_immediate := v_category IN ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado');

    IF target_qty < required THEN
      RAISE EXCEPTION 'Estoque insuficiente para "%" (%): disponivel %, necessario %',
        target_name, COALESCE(p_color, ''), target_qty, required;
    END IF;

    IF v_is_immediate THEN
      -- HARD DEBIT: immediate stock out
      UPDATE public.products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required,
              'Debito OP (imediato) ' || target_name || CASE WHEN p_color <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);
    END IF;

    -- Create reservation record
    INSERT INTO public.material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
    VALUES (
      p_order_id, target_product_id, required,
      CASE WHEN v_is_immediate THEN required ELSE 0 END,
      CASE WHEN v_is_immediate THEN 'consumed' ELSE 'reserved' END,
      CASE WHEN v_is_immediate THEN 'hard' ELSE 'soft' END
    );

    v_result := v_result || jsonb_build_object(
      'product_id', target_product_id, 'product_name', target_name,
      'required', required, 'type', CASE WHEN v_is_immediate THEN 'debited' ELSE 'reserved' END
    );
  END LOOP;

  -- ========== 2) PROCESS specifications (Cabedal, Forro, Palmilha) ==========
  SELECT ts.upper_material, ts.upper_consumption, ts.lining_material, ts.lining_consumption,
         ts.insole_material, ts.insole_consumption, ts.lining_accessories
  INTO v_upper_material, v_upper_consumption, v_lining_material, v_lining_consumption,
       v_insole_material, v_insole_consumption, v_lining_accessories
  FROM public.technical_sheets ts WHERE ts.id = p_reference_id;

  -- Upper (Cabedal) - SOFT reservation (variable material)
  IF v_upper_material IS NOT NULL AND v_upper_material <> '' AND COALESCE(v_upper_consumption, 0) > 0 THEN
    required := v_upper_consumption * p_order_quantity;
    target_product_id := NULL;
    IF p_color <> '' THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM products p JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_upper_material AND p.color = p_color LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM products p JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_upper_material LIMIT 1;
    END IF;
    IF target_product_id IS NOT NULL THEN
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para Cabedal "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      -- Soft reservation for variable materials
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, target_product_id, required, 0, 'reserved', 'soft');
      v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'reserved');
    END IF;
  END IF;

  -- Lining (Forro) - SOFT reservation
  IF v_lining_material IS NOT NULL AND v_lining_material <> '' AND COALESCE(v_lining_consumption, 0) > 0 THEN
    required := v_lining_consumption * p_order_quantity;
    target_product_id := NULL;
    IF p_color <> '' THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM products p JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_lining_material AND p.color = p_color LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM products p JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_lining_material LIMIT 1;
    END IF;
    IF target_product_id IS NOT NULL THEN
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para Forro "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, target_product_id, required, 0, 'reserved', 'soft');
      v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'reserved');
    END IF;
  END IF;

  -- Insole (Palmilha) - SOFT reservation
  IF v_insole_material IS NOT NULL AND v_insole_material <> '' AND COALESCE(v_insole_consumption, 0) > 0 THEN
    required := v_insole_consumption * p_order_quantity;
    target_product_id := NULL;
    IF p_color <> '' THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM products p JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_insole_material AND p.color = p_color LIMIT 1;
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

  -- Lining accessories - HARD debit (small items)
  IF v_lining_accessories IS NOT NULL AND jsonb_typeof(v_lining_accessories) = 'array' AND jsonb_array_length(v_lining_accessories) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_lining_accessories) AS value
    LOOP
      v_group_name := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      required := v_consumption * p_order_quantity;
      target_product_id := NULL;
      IF p_color <> '' THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p JOIN product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_group_name AND p.color = p_color LIMIT 1;
      END IF;
      IF target_product_id IS NULL THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p JOIN product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_group_name LIMIT 1;
      END IF;
      IF target_product_id IS NOT NULL THEN
        IF target_qty < required THEN
          RAISE EXCEPTION 'Estoque insuficiente para Acessorio Forro "%": disponivel %, necessario %', target_name, target_qty, required;
        END IF;
        UPDATE products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
        INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (target_product_id, 'out', required, target_qty, target_qty - required, 'Debito Acessorio Forro (' || target_name || ')', p_order_id);
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
        VALUES (p_order_id, target_product_id, required, required, 'consumed', 'hard');
      END IF;
    END LOOP;
  END IF;

  -- ========== 3) PROCESS direct_components (HARD debit) ==========
  SELECT ts.direct_components INTO v_direct_components FROM technical_sheets ts WHERE ts.id = p_reference_id;
  IF v_direct_components IS NOT NULL AND jsonb_typeof(v_direct_components) = 'array' AND jsonb_array_length(v_direct_components) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_direct_components) AS value
    LOOP
      v_consumption := COALESCE((v_item ->> 'quantity')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      required := v_consumption * p_order_quantity;
      v_product_id := NULL;
      BEGIN v_product_id := (v_item ->> 'product_id')::uuid; EXCEPTION WHEN OTHERS THEN v_product_id := NULL; END;
      IF v_product_id IS NULL THEN CONTINUE; END IF;
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM products p WHERE p.id = v_product_id AND p.active = true;
      IF target_product_id IS NOT NULL THEN
        IF target_qty < required THEN
          RAISE EXCEPTION 'Estoque insuficiente para componente "%": disponivel %, necessario %', target_name, target_qty, required;
        END IF;
        UPDATE products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
        INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (target_product_id, 'out', required, target_qty, target_qty - required, 'Debito Componente (' || target_name || ')', p_order_id);
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
        VALUES (p_order_id, target_product_id, required, required, 'consumed', 'hard');
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$$;

-- ========== CONFIRM PICKING (convert soft reservation to hard debit) ==========
CREATE OR REPLACE FUNCTION public.confirm_picking_reservation(
  p_reservation_id uuid,
  p_picked_by text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_res RECORD;
  v_current_qty numeric;
BEGIN
  SELECT * INTO v_res FROM material_reservations WHERE id = p_reservation_id AND status = 'reserved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva não encontrada ou já consumida';
  END IF;

  SELECT quantity INTO v_current_qty FROM products WHERE id = v_res.product_id FOR UPDATE;
  
  IF v_current_qty < v_res.quantity_reserved THEN
    RAISE EXCEPTION 'Estoque insuficiente para confirmar picking: disponivel %, necessario %', v_current_qty, v_res.quantity_reserved;
  END IF;

  UPDATE products SET quantity = quantity - v_res.quantity_reserved, updated_at = now() WHERE id = v_res.product_id;
  
  INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
  VALUES (v_res.product_id, 'out', v_res.quantity_reserved, v_current_qty, v_current_qty - v_res.quantity_reserved,
          'Debito Picking Confirmado', v_res.order_id);

  UPDATE material_reservations 
  SET status = 'consumed', quantity_consumed = quantity_reserved, consumed_at = now(), reservation_type = 'hard', updated_at = now()
  WHERE id = p_reservation_id;
END;
$$;
