-- Helper: calculates the per-size-aware required quantity for a material.
-- Returns: consumption_per_size json mapped against order grade, multiplied by fichas (when grade exists),
-- otherwise falls back to fallback_consumption * order_quantity.
CREATE OR REPLACE FUNCTION public._calc_required_per_size(
  p_consumption_per_size jsonb,
  p_fallback_consumption numeric,
  p_order_grade jsonb,
  p_order_quantity numeric
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_total numeric := 0;
  v_size text;
  v_pairs numeric;
  v_per_pair numeric;
  v_grade_total numeric := 0;
  v_fichas numeric := 1;
BEGIN
  -- Without per-size data or grade, fall back to flat estimate
  IF p_consumption_per_size IS NULL OR jsonb_typeof(p_consumption_per_size) <> 'object'
     OR p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN COALESCE(p_fallback_consumption, 0) * COALESCE(p_order_quantity, 0);
  END IF;

  -- Compute fichas multiplier: order_quantity / sum(grade)
  FOR v_size, v_pairs IN
    SELECT key, COALESCE(value::text::numeric, 0) FROM jsonb_each(p_order_grade)
  LOOP
    v_grade_total := v_grade_total + COALESCE(v_pairs, 0);
  END LOOP;

  IF v_grade_total > 0 AND p_order_quantity > 0 THEN
    v_fichas := p_order_quantity / v_grade_total;
  ELSE
    v_fichas := 1;
  END IF;

  FOR v_size, v_pairs IN
    SELECT key, COALESCE(value::text::numeric, 0) FROM jsonb_each(p_order_grade)
  LOOP
    IF v_pairs <= 0 THEN CONTINUE; END IF;
    v_per_pair := COALESCE((p_consumption_per_size ->> v_size)::numeric, p_fallback_consumption, 0);
    v_total := v_total + (v_pairs * v_fichas * v_per_pair);
  END LOOP;

  -- Safety: if nothing matched, use flat fallback
  IF v_total <= 0 THEN
    RETURN COALESCE(p_fallback_consumption, 0) * COALESCE(p_order_quantity, 0);
  END IF;

  RETURN v_total;
END;
$$;

-- Helper: pick the cabedal option (principal or alternative) whose group has products in the order color.
-- Returns selected (group_name, consumption, consumption_per_size).
CREATE OR REPLACE FUNCTION public._resolve_upper_option(
  p_reference_id uuid,
  p_color text
) RETURNS TABLE(group_name text, consumption numeric, consumption_per_size jsonb)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_principal_group text;
  v_principal_cons numeric;
  v_principal_per_size jsonb;
  v_components jsonb;
  v_item jsonb;
  v_group text;
  v_cons numeric;
  v_per_size jsonb;
  v_has_color boolean;
BEGIN
  SELECT ts.upper_material, ts.upper_consumption, ts.upper_consumption_per_size, ts.components_accessories
  INTO v_principal_group, v_principal_cons, v_principal_per_size, v_components
  FROM public.technical_sheets ts WHERE ts.id = p_reference_id;

  -- 1. Principal first if matches color (or no color filter)
  IF v_principal_group IS NOT NULL AND v_principal_group <> '' AND COALESCE(v_principal_cons, 0) > 0 THEN
    IF p_color IS NULL OR p_color = '' THEN
      group_name := v_principal_group; consumption := v_principal_cons; consumption_per_size := v_principal_per_size;
      RETURN NEXT; RETURN;
    END IF;
    SELECT EXISTS(
      SELECT 1 FROM products p
      JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_principal_group
        AND (p.color = p_color OR LOWER(p.name) LIKE '%' || LOWER(p_color) || '%')
    ) INTO v_has_color;
    IF v_has_color THEN
      group_name := v_principal_group; consumption := v_principal_cons; consumption_per_size := v_principal_per_size;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- 2. Search non-mandatory alternatives in components_accessories
  IF v_components IS NOT NULL AND jsonb_typeof(v_components) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_components) AS value LOOP
      -- Skip mandatory items (handled separately) and direct product entries (with id)
      IF (v_item ->> 'mandatory')::boolean IS TRUE THEN CONTINUE; END IF;
      IF (v_item ? 'id') AND (v_item ->> 'id') IS NOT NULL AND (v_item ->> 'id') <> '' THEN CONTINUE; END IF;

      v_group := v_item ->> 'material';
      v_cons := COALESCE((v_item ->> 'consumption')::numeric, 0);
      v_per_size := v_item -> 'consumption_per_size';
      IF v_group IS NULL OR v_group = '' OR v_cons <= 0 THEN CONTINUE; END IF;

      IF p_color IS NOT NULL AND p_color <> '' THEN
        SELECT EXISTS(
          SELECT 1 FROM products p
          JOIN product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_group
            AND (p.color = p_color OR LOWER(p.name) LIKE '%' || LOWER(p_color) || '%')
        ) INTO v_has_color;
        IF v_has_color THEN
          group_name := v_group; consumption := v_cons; consumption_per_size := v_per_size;
          RETURN NEXT; RETURN;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 3. Fallback: principal if defined, else nothing
  IF v_principal_group IS NOT NULL AND v_principal_group <> '' AND COALESCE(v_principal_cons, 0) > 0 THEN
    group_name := v_principal_group; consumption := v_principal_cons; consumption_per_size := v_principal_per_size;
    RETURN NEXT;
  END IF;
  RETURN;
END;
$$;

-- Replace the main 5-arg overload (called from useSaleOrders/useOrders/resyncOPs)
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_order_id uuid,
  p_order_grade jsonb DEFAULT NULL::jsonb
) RETURNS jsonb
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
  v_per_size jsonb;
  v_product_id uuid;
  v_direct_components jsonb;
  v_lining_material text; v_lining_consumption numeric;
  v_insole_material text; v_insole_consumption numeric;
  v_lining_accessories jsonb;
  v_lining_debited boolean := false;
  v_upper RECORD;
BEGIN
  -- ========== 1) sheet_materials (BOM) ==========
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

    v_is_immediate := v_category IN ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado');

    IF target_qty < required THEN
      RAISE EXCEPTION 'Estoque insuficiente para "%" (%): disponivel %, necessario %',
        target_name, COALESCE(p_color, ''), target_qty, required;
    END IF;

    IF v_is_immediate THEN
      UPDATE public.products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required,
              'Debito OP (imediato) ' || target_name || CASE WHEN p_color <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);
    END IF;

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

  -- ========== 2) Cabedal: ESCOLHE 1 opção compatível com a cor (precisão por tamanho) ==========
  SELECT ts.lining_material, ts.lining_consumption, ts.insole_material, ts.insole_consumption,
         ts.lining_accessories, ts.components_accessories
  INTO v_lining_material, v_lining_consumption, v_insole_material, v_insole_consumption,
       v_lining_accessories, v_components
  FROM public.technical_sheets ts WHERE ts.id = p_reference_id;

  SELECT * INTO v_upper FROM public._resolve_upper_option(p_reference_id, COALESCE(p_color, ''));
  IF v_upper.group_name IS NOT NULL AND v_upper.consumption > 0 THEN
    required := public._calc_required_per_size(v_upper.consumption_per_size, v_upper.consumption, p_order_grade, p_order_quantity);
    target_product_id := NULL;
    IF p_color <> '' THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM products p JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_upper.group_name AND p.color = p_color LIMIT 1;
      IF target_product_id IS NULL THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p JOIN product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_upper.group_name AND LOWER(p.name) LIKE '%' || LOWER(p_color) || '%' LIMIT 1;
      END IF;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM products p JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_upper.group_name LIMIT 1;
    END IF;
    IF target_product_id IS NOT NULL THEN
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para Cabedal "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, target_product_id, required, 0, 'reserved', 'soft');
      v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'reserved_cabedal');
    END IF;
  END IF;

  -- ========== 2b) Materiais SEMPRE CONSUMIDOS (mandatory: true em components_accessories) ==========
  IF v_components IS NOT NULL AND jsonb_typeof(v_components) = 'array' AND jsonb_array_length(v_components) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_components) AS value LOOP
      IF (v_item ->> 'mandatory')::boolean IS NOT TRUE THEN CONTINUE; END IF;
      IF (v_item ? 'id') AND (v_item ->> 'id') IS NOT NULL AND (v_item ->> 'id') <> '' THEN CONTINUE; END IF;

      v_group_name := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, (v_item ->> 'quantity')::numeric, 0);
      v_per_size := v_item -> 'consumption_per_size';
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;

      required := public._calc_required_per_size(v_per_size, v_consumption, p_order_grade, p_order_quantity);
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
          RAISE EXCEPTION 'Estoque insuficiente para Material Fixo "%": disponivel %, necessario %', target_name, target_qty, required;
        END IF;
        UPDATE products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
        INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (target_product_id, 'out', required, target_qty, target_qty - required, 'Debito Material Fixo (' || target_name || ')', p_order_id);
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
        VALUES (p_order_id, target_product_id, required, required, 'consumed', 'hard');
        v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'debited_fixed');
      END IF;
    END LOOP;
  END IF;

  -- ========== 3) Forro: principal ou alternativa por cor ==========
  v_lining_debited := false;
  IF NOT v_lining_debited AND v_lining_material IS NOT NULL AND v_lining_material <> '' AND COALESCE(v_lining_consumption, 0) > 0 THEN
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

  IF NOT v_lining_debited AND v_lining_accessories IS NOT NULL AND jsonb_typeof(v_lining_accessories) = 'array' AND jsonb_array_length(v_lining_accessories) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_lining_accessories) AS value LOOP
      IF v_lining_debited THEN EXIT; END IF;
      v_group_name := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
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

  IF NOT v_lining_debited AND v_lining_material IS NOT NULL AND v_lining_material <> '' AND COALESCE(v_lining_consumption, 0) > 0 THEN
    required := v_lining_consumption * p_order_quantity;
    SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
    FROM products p JOIN product_groups pg ON pg.id = p.group_id
    WHERE p.active = true AND pg.name = v_lining_material LIMIT 1;
    IF target_product_id IS NOT NULL THEN
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para Forro "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, target_product_id, required, 0, 'reserved', 'soft');
      v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'reserved');
    END IF;
  END IF;

  -- ========== 4) Palmilha (soft reserve) ==========
  IF v_insole_material IS NOT NULL AND v_insole_material <> '' AND COALESCE(v_insole_consumption, 0) > 0 THEN
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

  -- ========== 5) direct_components (HARD debit) — produtos diretos ==========
  SELECT ts.direct_components INTO v_direct_components FROM technical_sheets ts WHERE ts.id = p_reference_id;
  IF v_direct_components IS NOT NULL AND jsonb_typeof(v_direct_components) = 'array' AND jsonb_array_length(v_direct_components) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_direct_components) AS value LOOP
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, (v_item ->> 'quantity')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      required := v_consumption * p_order_quantity;
      v_product_id := NULL;
      BEGIN
        v_product_id := COALESCE((v_item ->> 'product_id')::uuid, (v_item ->> 'id')::uuid);
      EXCEPTION WHEN OTHERS THEN v_product_id := NULL; END;
      IF v_product_id IS NOT NULL THEN
        SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
        FROM products p WHERE p.id = v_product_id AND p.active = true;
        IF target_product_id IS NULL THEN RAISE EXCEPTION 'Componente direto nao encontrado (ID: %)', v_product_id; END IF;
      ELSE
        v_group_name := v_item ->> 'material';
        IF v_group_name IS NULL OR v_group_name = '' THEN CONTINUE; END IF;
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
        IF target_product_id IS NULL THEN RAISE EXCEPTION 'Componente direto "%" nao encontrado', v_group_name; END IF;
      END IF;
      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para componente "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      UPDATE products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required, 'Debito Componente Direto (' || target_name || ')', p_order_id);
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, target_product_id, required, required, 'consumed', 'hard');
      v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'debited');
    END LOOP;
  END IF;

  -- ========== 6) components_accessories: SOMENTE produtos diretos com id (não cabedal/alternativas) ==========
  -- Itens com 'id' são produtos avulsos (acessórios diretos vinculados à ficha).
  -- Alternativas de cabedal (sem id, sem mandatory) já foram tratadas na seleção de cabedal por cor.
  -- Mandatórios (mandatory=true) já foram debitados na seção 2b.
  IF v_components IS NOT NULL AND jsonb_typeof(v_components) = 'array' AND jsonb_array_length(v_components) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_components) AS value LOOP
      -- só processa quando tem 'id' válido (produto direto)
      IF NOT (v_item ? 'id') OR (v_item ->> 'id') IS NULL OR (v_item ->> 'id') = '' THEN CONTINUE; END IF;
      IF (v_item ->> 'mandatory')::boolean IS TRUE THEN CONTINUE; END IF;

      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, (v_item ->> 'quantity')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      required := v_consumption * p_order_quantity;

      BEGIN v_product_id := (v_item ->> 'id')::uuid; EXCEPTION WHEN OTHERS THEN CONTINUE; END;
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM products p WHERE p.id = v_product_id AND p.active = true;
      IF target_product_id IS NULL THEN CONTINUE; END IF;

      IF target_qty < required THEN
        RAISE EXCEPTION 'Estoque insuficiente para "%": disponivel %, necessario %', target_name, target_qty, required;
      END IF;
      UPDATE products SET quantity = quantity - required, updated_at = now() WHERE id = target_product_id;
      INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (target_product_id, 'out', required, target_qty, target_qty - required, 'Debito Acessorio (' || target_name || ')', p_order_id);
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, target_product_id, required, required, 'consumed', 'hard');
      v_result := v_result || jsonb_build_object('product_id', target_product_id, 'product_name', target_name, 'required', required, 'type', 'debited');
    END LOOP;
  END IF;

  RETURN v_result;
END;
$function$;