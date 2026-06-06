-- Fix conferência de tira (2026-06-06): no loop de tiras de check_stock_availability,
-- quando não acha produto pra (group_id, cor) nem fallback sem-cor, a função fazia
-- CONTINUE — DROPAVA a tira silenciosamente (sem falta, sem OC, sem aviso), e depois o
-- débito travava com RAISE. Agora emite uma linha de FALTA com product_id NULL: nada some;
-- a UI/badge sinaliza e o StrapShortageDialog (pós-save) trata. Mantém o netting de
-- reservado (GREATEST(0, quantity - reserved_stock)). Callers são seguros com product_id
-- NULL (StockAvailabilityBadge e useSaleOrders só leem sufficient/required/available).
CREATE OR REPLACE FUNCTION public.check_stock_availability(p_reference_id uuid, p_order_quantity integer, p_color text DEFAULT ''::text, p_order_grade jsonb DEFAULT NULL::jsonb, p_strap_colors jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(product_id uuid, product_name text, required numeric, available numeric, sufficient boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  mat RECORD;
  v_required numeric;
  v_target_id uuid;
  v_target_name text;
  v_target_qty numeric;
  v_effective_straps jsonb;
  v_sheet_straps jsonb;
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_color_norm text;
  v_per_size jsonb;
  v_consumption numeric;
  v_size text;
  v_pairs numeric;
  v_cm_per_pair numeric;
  v_total_cm numeric;
  v_grade_total numeric;
  v_fichas numeric;
BEGIN
  FOR mat IN
    SELECT sm.product_id, sm.quantity_per_unit, sm.consumption_per_size,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
   WHERE sm.sheet_id = p_reference_id
  LOOP
    v_required := public.calc_required_for_grade(
      mat.consumption_per_size, p_order_grade, mat.quantity_per_unit, p_order_quantity
    );
    v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;

    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) INTO v_target_id, v_target_name, v_target_qty
        FROM public.products p
       WHERE p.active = true AND p.color = p_color
         AND ((mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
              OR (mat.group_id IS NULL AND p.name = mat.name))
       LIMIT 1;
      IF v_target_id IS NULL THEN
        v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;
      END IF;
    END IF;

    product_id := v_target_id; product_name := v_target_name; required := v_required;
    available := v_target_qty; sufficient := (v_target_qty >= v_required);
    RETURN NEXT;
  END LOOP;

  -- Decide qual JSONB de tiras usar:
  -- 1. p_strap_colors (caller passou — vem de sale_order_items, COM cor real)
  -- 2. ficha.strap_colors com fallback de cor pra p_color (operador escolheu uma cor única)
  IF p_strap_colors IS NOT NULL AND jsonb_typeof(p_strap_colors) = 'array'
     AND jsonb_array_length(p_strap_colors) > 0 THEN
    v_effective_straps := p_strap_colors;
  ELSE
    SELECT ts.strap_colors INTO v_sheet_straps
      FROM public.technical_sheets ts WHERE ts.id = p_reference_id;

    IF v_sheet_straps IS NULL OR jsonb_typeof(v_sheet_straps) <> 'array' OR jsonb_array_length(v_sheet_straps) = 0 THEN
      RETURN;
    END IF;

    -- Override de cor: substitui color vazia/null por p_color (fallback)
    SELECT jsonb_agg(
      CASE
        WHEN COALESCE(s ->> 'color', '') = '' AND p_color <> '' THEN s || jsonb_build_object('color', p_color)
        ELSE s
      END
    ) INTO v_effective_straps
    FROM jsonb_array_elements(v_sheet_straps) AS s;
  END IF;

  IF v_effective_straps IS NULL THEN RETURN; END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(v_effective_straps) AS value LOOP
    v_color := v_strap ->> 'color';
    BEGIN v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN v_group_id := NULL; END;
    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN CONTINUE; END IF;

    v_color_norm := lower(trim(extensions.unaccent(v_color)));
    v_per_size := v_strap -> 'consumption_per_size';
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 1);
    IF v_consumption <= 0 THEN v_consumption := 1; END IF;

    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0; v_grade_total := 0;
      FOR v_size, v_pairs IN
        SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;
      IF v_grade_total > 0 THEN
        v_fichas := GREATEST(1, ceil(p_order_quantity::numeric / v_grade_total));
      ELSE v_fichas := 1; END IF;
      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      v_required := v_consumption * p_order_quantity;
    END IF;
    IF v_required <= 0 THEN CONTINUE; END IF;

    SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
      INTO v_target_id, v_target_name, v_target_qty
      FROM public.products p
     WHERE p.active = true AND p.group_id = v_group_id
       AND lower(trim(extensions.unaccent(p.color))) = v_color_norm
     LIMIT 1;
    IF v_target_id IS NULL THEN
      SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) INTO v_target_id, v_target_name, v_target_qty
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_group_id
         AND (p.color IS NULL OR trim(p.color) = '')
       LIMIT 1;
    END IF;
    IF v_target_id IS NULL THEN
      -- Tira de cor recém-cadastrada SEM produto em estoque: NÃO dropa silenciosamente.
      -- Emite a falta com product_id NULL (a UI/StrapShortageDialog tratam).
      product_id := NULL;
      product_name := COALESCE(NULLIF(trim(v_color), ''), 'tira') || ' (tira não cadastrada)';
      required := v_required; available := 0; sufficient := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    product_id := v_target_id; product_name := v_target_name; required := v_required;
    available := COALESCE(v_target_qty, 0); sufficient := (COALESCE(v_target_qty,0) >= v_required);
    RETURN NEXT;
  END LOOP;
END;
$function$;
