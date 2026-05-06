
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
      IF v_consumption <= 0 THEN
        CONTINUE;
      END IF;

      v_pid := NULL;
      v_pname := NULL;
      v_pqty := 0;

      -- Try direct product ID first
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
        IF v_group_name IS NULL OR v_group_name = '' THEN
          CONTINUE;
        END IF;

        IF p_color IS NOT NULL AND p_color <> '' THEN
          SELECT p.id, p.name || ': ' || p.color, p.quantity INTO v_pid, v_pname, v_pqty
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_group_name AND p.color = p_color
          LIMIT 1;
        END IF;

        IF v_pid IS NULL THEN
          SELECT p.id, p.name, p.quantity INTO v_pid, v_pname, v_pqty
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
          WHERE p.active = true AND pg.name = v_group_name
          LIMIT 1;
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
END;
$function$
