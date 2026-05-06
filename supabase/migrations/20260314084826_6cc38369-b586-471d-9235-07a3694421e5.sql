
CREATE OR REPLACE FUNCTION public.check_stock_availability(p_reference_id uuid, p_order_quantity integer, p_color text DEFAULT ''::text)
 RETURNS TABLE(product_id uuid, product_name text, required numeric, available numeric, sufficient boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_components jsonb;
  v_item jsonb;
  v_group_name text;
  v_consumption numeric;
  v_pid uuid;
  v_pname text;
  v_pqty numeric;
  v_direct_id uuid;
  v_upper_material text;
  v_upper_consumption numeric;
  v_lining_material text;
  v_lining_consumption numeric;
  v_insole_material text;
  v_insole_consumption numeric;
  v_sole_material text;
  v_sole_consumption numeric;
  v_lining_accessories jsonb;
BEGIN
  -- BOM materials
  RETURN QUERY
  SELECT 
    COALESCE(
      CASE WHEN p_color <> '' AND sm_p.color <> p_color THEN
        (SELECT p2.id FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((sm_p.group_id IS NOT NULL AND p2.group_id = sm_p.group_id)
              OR (sm_p.group_id IS NULL AND p2.name = sm_p.name))
         LIMIT 1)
      END,
      sm.product_id
    ),
    COALESCE(
      CASE WHEN p_color <> '' AND sm_p.color <> p_color THEN
        (SELECT p2.name || ': ' || p2.color FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((sm_p.group_id IS NOT NULL AND p2.group_id = sm_p.group_id)
              OR (sm_p.group_id IS NULL AND p2.name = sm_p.name))
         LIMIT 1)
      END,
      sm_p.name
    ),
    (sm.quantity_per_unit * p_order_quantity)::numeric,
    COALESCE(
      CASE WHEN p_color <> '' AND sm_p.color <> p_color THEN
        (SELECT p2.quantity FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((sm_p.group_id IS NOT NULL AND p2.group_id = sm_p.group_id)
              OR (sm_p.group_id IS NULL AND p2.name = sm_p.name))
         LIMIT 1)
      END,
      sm_p.quantity
    ),
    COALESCE(
      CASE WHEN p_color <> '' AND sm_p.color <> p_color THEN
        (SELECT p2.quantity FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((sm_p.group_id IS NOT NULL AND p2.group_id = sm_p.group_id)
              OR (sm_p.group_id IS NULL AND p2.name = sm_p.name))
         LIMIT 1)
      END,
      sm_p.quantity
    ) >= (sm.quantity_per_unit * p_order_quantity)
  FROM public.sheet_materials sm
  JOIN public.products sm_p ON sm_p.id = sm.product_id
  WHERE sm.sheet_id = p_reference_id;

  -- Extra components from components_accessories
  SELECT ts.components_accessories INTO v_components
  FROM public.technical_sheets ts WHERE ts.id = p_reference_id;

  IF v_components IS NOT NULL AND jsonb_typeof(v_components) = 'array' AND jsonb_array_length(v_components) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_components) AS value
    LOOP
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;

      v_pid := NULL; v_pname := NULL; v_pqty := 0;

      BEGIN
        v_direct_id := (v_item ->> 'id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_direct_id := NULL;
      END;

      IF v_direct_id IS NOT NULL THEN
        SELECT p.id, p.name, p.quantity INTO v_pid, v_pname, v_pqty
        FROM public.products p WHERE p.id = v_direct_id AND p.active = true;
      ELSE
        v_group_name := v_item ->> 'material';
        IF v_group_name IS NULL OR v_group_name = '' THEN CONTINUE; END IF;

        IF p_color IS NOT NULL AND p_color <> '' THEN
          SELECT p.id, p.name || ': ' || p.color, p.quantity INTO v_pid, v_pname, v_pqty
          FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_group_name AND p.color = p_color LIMIT 1;
        END IF;
        IF v_pid IS NULL THEN
          SELECT p.id, p.name, p.quantity INTO v_pid, v_pname, v_pqty
          FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_group_name LIMIT 1;
        END IF;
      END IF;

      product_id := v_pid;
      product_name := COALESCE(v_pname, COALESCE(v_item ->> 'name', v_item ->> 'material', 'Componente'));
      required := v_consumption * p_order_quantity;
      available := COALESCE(v_pqty, 0);
      sufficient := COALESCE(v_pqty, 0) >= (v_consumption * p_order_quantity);
      RETURN NEXT;
    END LOOP;
  END IF;

  -- ========== Specs materials (upper, lining, insole, sole) ==========
  SELECT ts.upper_material, ts.upper_consumption, ts.lining_material, ts.lining_consumption,
         ts.insole_material, ts.insole_consumption, ts.sole_material, ts.sole_consumption,
         ts.lining_accessories
  INTO v_upper_material, v_upper_consumption, v_lining_material, v_lining_consumption,
       v_insole_material, v_insole_consumption, v_sole_material, v_sole_consumption,
       v_lining_accessories
  FROM public.technical_sheets ts WHERE ts.id = p_reference_id;

  -- Check each spec material
  -- Upper
  IF v_upper_material IS NOT NULL AND v_upper_material <> '' AND COALESCE(v_upper_consumption, 0) > 0 THEN
    v_pid := NULL; v_pname := NULL; v_pqty := 0;
    IF p_color <> '' THEN
      SELECT p.id, p.name || ': ' || p.color, p.quantity INTO v_pid, v_pname, v_pqty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_upper_material AND p.color = p_color LIMIT 1;
    END IF;
    IF v_pid IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO v_pid, v_pname, v_pqty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_upper_material LIMIT 1;
    END IF;
    product_id := v_pid; product_name := COALESCE(v_pname, 'Cabedal: ' || v_upper_material);
    required := v_upper_consumption * p_order_quantity; available := COALESCE(v_pqty, 0);
    sufficient := available >= required; RETURN NEXT;
  END IF;

  -- Lining
  IF v_lining_material IS NOT NULL AND v_lining_material <> '' AND COALESCE(v_lining_consumption, 0) > 0 THEN
    v_pid := NULL; v_pname := NULL; v_pqty := 0;
    IF p_color <> '' THEN
      SELECT p.id, p.name || ': ' || p.color, p.quantity INTO v_pid, v_pname, v_pqty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_lining_material AND p.color = p_color LIMIT 1;
    END IF;
    IF v_pid IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO v_pid, v_pname, v_pqty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_lining_material LIMIT 1;
    END IF;
    product_id := v_pid; product_name := COALESCE(v_pname, 'Forro: ' || v_lining_material);
    required := v_lining_consumption * p_order_quantity; available := COALESCE(v_pqty, 0);
    sufficient := available >= required; RETURN NEXT;
  END IF;

  -- Extra lining accessories
  IF v_lining_accessories IS NOT NULL AND jsonb_typeof(v_lining_accessories) = 'array' AND jsonb_array_length(v_lining_accessories) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_lining_accessories) AS value
    LOOP
      v_group_name := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      v_pid := NULL; v_pname := NULL; v_pqty := 0;
      IF p_color <> '' THEN
        SELECT p.id, p.name || ': ' || p.color, p.quantity INTO v_pid, v_pname, v_pqty
        FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_group_name AND p.color = p_color LIMIT 1;
      END IF;
      IF v_pid IS NULL THEN
        SELECT p.id, p.name, p.quantity INTO v_pid, v_pname, v_pqty
        FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
        WHERE p.active = true AND pg.name = v_group_name LIMIT 1;
      END IF;
      product_id := v_pid; product_name := COALESCE(v_pname, 'Forro Extra: ' || v_group_name);
      required := v_consumption * p_order_quantity; available := COALESCE(v_pqty, 0);
      sufficient := available >= required; RETURN NEXT;
    END LOOP;
  END IF;

  -- Insole
  IF v_insole_material IS NOT NULL AND v_insole_material <> '' AND COALESCE(v_insole_consumption, 0) > 0 THEN
    v_pid := NULL; v_pname := NULL; v_pqty := 0;
    IF p_color <> '' THEN
      SELECT p.id, p.name || ': ' || p.color, p.quantity INTO v_pid, v_pname, v_pqty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_insole_material AND p.color = p_color LIMIT 1;
    END IF;
    IF v_pid IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO v_pid, v_pname, v_pqty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_insole_material LIMIT 1;
    END IF;
    product_id := v_pid; product_name := COALESCE(v_pname, 'Palmilha: ' || v_insole_material);
    required := v_insole_consumption * p_order_quantity; available := COALESCE(v_pqty, 0);
    sufficient := available >= required; RETURN NEXT;
  END IF;

  -- Sole
  IF v_sole_material IS NOT NULL AND v_sole_material <> '' AND COALESCE(v_sole_consumption, 0) > 0 THEN
    v_pid := NULL; v_pname := NULL; v_pqty := 0;
    IF p_color <> '' THEN
      SELECT p.id, p.name || ': ' || p.color, p.quantity INTO v_pid, v_pname, v_pqty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material AND p.color = p_color LIMIT 1;
    END IF;
    IF v_pid IS NULL THEN
      SELECT p.id, p.name, p.quantity INTO v_pid, v_pname, v_pqty
      FROM public.products p JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material LIMIT 1;
    END IF;
    product_id := v_pid; product_name := COALESCE(v_pname, 'Sola: ' || v_sole_material);
    required := v_sole_consumption * p_order_quantity; available := COALESCE(v_pqty, 0);
    sufficient := available >= required; RETURN NEXT;
  END IF;
END;
$function$;
