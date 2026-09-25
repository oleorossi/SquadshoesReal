-- Cola de dublagem no custeio (R$/m × metros da face externa). Sem estoque/OC.

CREATE OR REPLACE FUNCTION public.dublagem_glue_cost_for_item(p_sale_order_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_ref uuid;
  v_linear numeric := 0;
  v_price numeric := 0;
  v_name text := 'Cola de dublagem';
  v_glue_id uuid;
  v_cost numeric;
BEGIN
  SELECT soi.dublagem_mode, soi.reference_id
    INTO v_mode, v_ref
    FROM public.sale_order_items soi
   WHERE soi.id = p_sale_order_item_id;
  IF v_mode IS NULL OR v_ref IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT d.linear_m, COALESCE(d.glue_id, ts.dublagem_glue_id)
    INTO v_linear, v_glue_id
    FROM public.dublagem_demands d
    JOIN public.technical_sheets ts ON ts.id = v_ref
   WHERE d.sale_order_item_id = p_sale_order_item_id
     AND d.face = 'external'
     AND d.status <> 'cancelled'
   LIMIT 1;

  IF v_glue_id IS NULL THEN
    SELECT ts.dublagem_glue_id INTO v_glue_id
      FROM public.technical_sheets ts WHERE ts.id = v_ref;
  END IF;

  IF v_glue_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT g.name, g.price_per_m INTO v_name, v_price
    FROM public.product_group_dublagem_glues g
   WHERE g.id = v_glue_id AND g.is_active;

  IF COALESCE(v_price, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_linear, 0) <= 0 THEN
    -- Sem demanda materializada: estima metros a partir do dm² e do acabado.
    SELECT public.dublagem_dm2_to_linear_m(
             public.dublagem_item_upper_dm2(p_sale_order_item_id),
             COALESCE(
               ts.upper_material_product_id,
               (SELECT p.id FROM public.products p
                 WHERE p.group_id = ts.upper_material_group_id
                   AND COALESCE(p.active, true)
                 ORDER BY p.id LIMIT 1)
             )
           )
      INTO v_linear
      FROM public.technical_sheets ts
     WHERE ts.id = v_ref;
  END IF;

  IF COALESCE(v_linear, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  v_cost := round(v_linear * v_price, 6);
  RETURN jsonb_build_object(
    'product_id', NULL,
    'product_name', COALESCE(v_name, 'Cola de dublagem'),
    'component', 'dublagem_glue',
    'required', v_linear,
    'consumption_unit', 'm',
    'product_unit', 'm',
    'unit_price', v_price,
    'subtotal', v_cost,
    'dublagem_glue_cost', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dublagem_glue_cost_for_item(uuid)
  TO authenticated, service_role;

DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.calculate_order_cost_item(uuid,boolean)'::regprocedure
  );

  IF position('dublagem_glue_cost_for_item' IN v_def) > 0 THEN
    RAISE NOTICE 'calculate_order_cost_item já chama dublagem_glue_cost_for_item';
    RETURN;
  END IF;

  v_old :=
    'FOR v_op IN' || E'\n' ||
    '    SELECT operation_name, cost_per_hour, standard_time_minutes' || E'\n' ||
    '      FROM public.bom_operations';

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora bom_operations ausente em calculate_order_cost_item';
  END IF;

  v_new :=
    'DECLARE v_dublagem_line jsonb;' || E'\n' ||
    '  BEGIN' || E'\n' ||
    '    v_dublagem_line := public.dublagem_glue_cost_for_item(v_item.id);' || E'\n' ||
    '    IF v_dublagem_line IS NOT NULL THEN' || E'\n' ||
    '      v_material := v_material + COALESCE((v_dublagem_line ->> ''subtotal'')::numeric, 0);' || E'\n' ||
    '      v_breakdown_materials := v_breakdown_materials || v_dublagem_line;' || E'\n' ||
    '    END IF;' || E'\n' ||
    '  END;' || E'\n' ||
    E'\n' ||
    '  ' || v_old;

  v_new :=
    '-- Cola de dublagem (custeio; sem estoque).' || E'\n' ||
    '  v_line := public.dublagem_glue_cost_for_item(v_item.id);' || E'\n' ||
    '  IF v_line IS NOT NULL THEN' || E'\n' ||
    '    v_material := v_material + COALESCE((v_line ->> ''subtotal'')::numeric, 0);' || E'\n' ||
    '    v_breakdown_materials := v_breakdown_materials || v_line;' || E'\n' ||
    '  END IF;' || E'\n' ||
    E'\n' ||
    '  ' || v_old;

  v_def := overlay(
    v_def
    placing v_new
    from position(v_old IN v_def)
    for length(v_old)
  );

  EXECUTE v_def;
END;
$patch$;
