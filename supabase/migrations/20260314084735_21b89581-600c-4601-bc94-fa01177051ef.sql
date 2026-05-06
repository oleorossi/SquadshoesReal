
CREATE OR REPLACE FUNCTION public.debit_stock_for_order(p_reference_id uuid, p_order_quantity integer, p_color text DEFAULT ''::text, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  mat RECORD;
  required numeric;
  current_qty numeric;
  target_product_id uuid;
  target_name text;
  target_qty numeric;
  v_components jsonb;
  v_item jsonb;
  v_group_name text;
  v_consumption numeric;
  v_product_id uuid;
  v_upper_material text;
  v_upper_consumption numeric;
  v_lining_material text;
  v_lining_consumption numeric;
  v_insole_material text;
  v_insole_consumption numeric;
  v_sole_material text;
  v_sole_consumption numeric;
  v_lining_accessories jsonb;
  v_spec_label text;
BEGIN
  -- ========== 1) DEBIT sheet_materials (BOM) ==========
  FOR mat IN
    SELECT sm.product_id, sm.quantity_per_unit, p.quantity AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id
  LOOP
    required := mat.quantity_per_unit * p_order_quantity;
    target_product_id := mat.product_id;
    target_name := mat.name;
    target_qty := mat.current_stock;
    
    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p
      WHERE p.active = true AND p.color = p_color
        AND ((mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
             OR (mat.group_id IS NULL AND p.name = mat.name))
      LIMIT 1;
      IF target_product_id IS NULL THEN
        target_product_id := mat.product_id;
        target_name := mat.name;
        target_qty := mat.current_stock;
      END IF;
    END IF;
    
    IF target_qty < required THEN
      RAISE EXCEPTION 'Estoque insuficiente para "%" (%): disponivel %, necessario %', 
        target_name, COALESCE(p_color, ''), target_qty, required;
    END IF;
  END LOOP;

  FOR mat IN
    SELECT sm.product_id, sm.quantity_per_unit, p.quantity AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id
  LOOP
    required := mat.quantity_per_unit * p_order_quantity;
    target_product_id := mat.product_id;
    current_qty := mat.current_stock;
    
    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.quantity INTO target_product_id, current_qty
      FROM public.products p
      WHERE p.active = true AND p.color = p_color
        AND ((mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
             OR (mat.group_id IS NULL AND p.name = mat.name))
      LIMIT 1;
      IF target_product_id IS NULL THEN
        target_product_id := mat.product_id;
        current_qty := mat.current_stock;
      END IF;
    END IF;

    UPDATE public.products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (target_product_id, 'out', required, current_qty, current_qty - required, 
            'Debito BOM' || CASE WHEN p_color <> '' THEN ' (Cor: ' || p_color || ')' ELSE '' END,
            p_order_id);
  END LOOP;

  -- ========== 2) DEBIT components_accessories ==========
  SELECT ts.components_accessories INTO v_components
  FROM public.technical_sheets ts
  WHERE ts.id = p_reference_id;

  IF v_components IS NOT NULL AND jsonb_typeof(v_components) = 'array' AND jsonb_array_length(v_components) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_components) AS value
    LOOP
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_consumption <= 0 THEN
        CONTINUE;
      END IF;

      required := v_consumption * p_order_quantity;

      v_product_id := NULL;
      BEGIN
        v_product_id := (v_item ->> 'id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_product_id := NULL;
      END;

      IF v_product_id IS NOT NULL THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM public.products p WHERE p.id = v_product_id AND p.active = true;

        IF target_product_id IS NULL THEN
          RAISE EXCEPTION 'Componente nao encontrado no estoque (ID: %)', v_product_id;
        END IF;
      ELSE
        v_group_name := v_item ->> 'material';
        IF v_group_name IS NULL OR v_group_name = '' THEN
          CONTINUE;
        END IF;

        target_product_id := NULL;
        IF p_color IS NOT NULL AND p_color <> '' THEN
          SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_group_name AND p.color = p_color
          LIMIT 1;
        END IF;

        IF target_product_id IS NULL THEN
          SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_group_name
          LIMIT 1;
        END IF;

        IF target_product_id IS NULL THEN
          RAISE EXCEPTION 'Material extra "%" nao encontrado no estoque', v_group_name;
        END IF;
      END IF;

      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para "%" : disponivel %, necessario %',
          target_name, target_qty, required;
      END IF;

      UPDATE public.products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required,
              'Debito Componente (' || target_name || ')' || CASE WHEN p_color <> '' THEN ' Cor: ' || p_color ELSE '' END,
              p_order_id);
    END LOOP;
  END IF;

  -- ========== 3) DEBIT specs materials (upper, lining, insole, sole) ==========
  SELECT ts.upper_material, ts.upper_consumption, ts.lining_material, ts.lining_consumption,
         ts.insole_material, ts.insole_consumption, ts.sole_material, ts.sole_consumption,
         ts.lining_accessories
  INTO v_upper_material, v_upper_consumption, v_lining_material, v_lining_consumption,
       v_insole_material, v_insole_consumption, v_sole_material, v_sole_consumption,
       v_lining_accessories
  FROM public.technical_sheets ts
  WHERE ts.id = p_reference_id;

  -- Helper: debit each spec material by group name + color fallback
  -- Upper (Cabedal)
  IF v_upper_material IS NOT NULL AND v_upper_material <> '' AND COALESCE(v_upper_consumption, 0) > 0 THEN
    required := v_upper_consumption * p_order_quantity;
    target_product_id := NULL;
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_upper_material AND p.color = p_color LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_upper_material LIMIT 1;
    END IF;
    IF target_product_id IS NOT NULL THEN
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para Cabedal "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      UPDATE public.products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required,
              'Debito Cabedal (' || target_name || ')' || CASE WHEN p_color <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);
    END IF;
  END IF;

  -- Lining (Forro)
  IF v_lining_material IS NOT NULL AND v_lining_material <> '' AND COALESCE(v_lining_consumption, 0) > 0 THEN
    required := v_lining_consumption * p_order_quantity;
    target_product_id := NULL;
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_lining_material AND p.color = p_color LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_lining_material LIMIT 1;
    END IF;
    IF target_product_id IS NOT NULL THEN
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para Forro "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      UPDATE public.products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required,
              'Debito Forro (' || target_name || ')' || CASE WHEN p_color <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);
    END IF;
  END IF;

  -- Extra lining accessories
  IF v_lining_accessories IS NOT NULL AND jsonb_typeof(v_lining_accessories) = 'array' AND jsonb_array_length(v_lining_accessories) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_lining_accessories) AS value
    LOOP
      v_group_name := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      required := v_consumption * p_order_quantity;
      target_product_id := NULL;
      IF p_color IS NOT NULL AND p_color <> '' THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_group_name AND p.color = p_color LIMIT 1;
      END IF;
      IF target_product_id IS NULL THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_group_name LIMIT 1;
      END IF;
      IF target_product_id IS NOT NULL THEN
        IF target_qty < required THEN
          RAISE EXCEPTION 'Estoque insuficiente para Forro extra "%": disponivel %, necessario %', target_name, target_qty, required;
        END IF;
        UPDATE public.products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
        INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (target_product_id, 'out', required, target_qty, target_qty - required,
                'Debito Forro Extra (' || target_name || ')' || CASE WHEN p_color <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);
      END IF;
    END LOOP;
  END IF;

  -- Insole (Palmilha)
  IF v_insole_material IS NOT NULL AND v_insole_material <> '' AND COALESCE(v_insole_consumption, 0) > 0 THEN
    required := v_insole_consumption * p_order_quantity;
    target_product_id := NULL;
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_insole_material AND p.color = p_color LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_insole_material LIMIT 1;
    END IF;
    IF target_product_id IS NOT NULL THEN
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para Palmilha "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      UPDATE public.products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required,
              'Debito Palmilha (' || target_name || ')' || CASE WHEN p_color <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);
    END IF;
  END IF;

  -- Sole (Sola)
  IF v_sole_material IS NOT NULL AND v_sole_material <> '' AND COALESCE(v_sole_consumption, 0) > 0 THEN
    required := v_sole_consumption * p_order_quantity;
    target_product_id := NULL;
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material AND p.color = p_color LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material LIMIT 1;
    END IF;
    IF target_product_id IS NOT NULL THEN
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para Sola "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      UPDATE public.products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required,
              'Debito Sola (' || target_name || ')' || CASE WHEN p_color <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);
    END IF;
  END IF;
END;
$function$;
