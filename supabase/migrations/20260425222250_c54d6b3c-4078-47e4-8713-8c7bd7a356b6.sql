-- ============================================================
-- Migration 1/3: Fix debit_strap_stock — remove silent wrong-color fallback
-- ============================================================
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
  v_product_color text;
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

    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0;
      v_grade_total := 0;

      FOR v_size, v_pairs IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;

      IF v_grade_total > 0 THEN
        v_fichas := GREATEST(1, round(p_order_quantity::numeric / v_grade_total));
      ELSE
        v_fichas := 1;
      END IF;

      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      v_required := v_consumption * p_order_quantity;
    END IF;

    IF v_required <= 0 THEN CONTINUE; END IF;

    SELECT p.id, p.name, p.quantity, p.color
    INTO v_product_id, v_product_name, v_current_qty, v_product_color
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND lower(trim(p.color)) = lower(trim(v_color))
    LIMIT 1;

    IF v_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity, p.color
      INTO v_product_id, v_product_name, v_current_qty, v_product_color
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_group_id
        AND (p.color IS NULL OR trim(p.color) = '')
      LIMIT 1;
    END IF;

    IF v_product_id IS NULL THEN
      DECLARE v_wrong_name text; v_wrong_color text;
      BEGIN
        SELECT p.name, p.color INTO v_wrong_name, v_wrong_color
        FROM public.products p
        WHERE p.active = true AND p.group_id = v_group_id
        LIMIT 1;
        IF v_wrong_name IS NOT NULL THEN
          RAISE EXCEPTION
            'Tira "%" cor "%" não encontrada no estoque. Produto disponível no grupo: "%" (cor "%"). Cadastre o material na cor correta.',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_wrong_name, COALESCE(v_wrong_color, 'sem cor');
        ELSE
          RAISE EXCEPTION
            'Material da tira "%" (cor: %) não encontrado no estoque (grupo: %).',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_group_id;
        END IF;
      END;
    END IF;

    IF v_current_qty < v_required THEN
      RAISE EXCEPTION
        'Estoque insuficiente para tira "%" (cor: %): disponível %.4f, necessário %.4f metros.',
        v_product_name, v_color, v_current_qty, v_required;
    END IF;

    UPDATE public.products
    SET quantity = quantity - v_required, updated_at = now()
    WHERE id = v_product_id;

    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (
      v_product_id, 'out', v_required, v_current_qty, v_current_qty - v_required,
      'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color
        || ' - ' || round(v_required::numeric, 4) || 'm × ' || p_order_quantity || ' pares',
      p_order_id
    );
  END LOOP;
END;
$function$;

-- ============================================================
-- Migration 2/3: calc_required_for_grade + check_stock_availability per-size
-- ============================================================
DROP FUNCTION IF EXISTS public.calc_required_for_grade(
  p_consumption_per_size jsonb,
  p_order_grade          jsonb,
  p_quantity_per_unit    numeric,
  p_total_quantity       numeric
) CASCADE;
CREATE OR REPLACE FUNCTION public.calc_required_for_grade(
  p_consumption_per_size jsonb,
  p_order_grade          jsonb,
  p_quantity_per_unit    numeric,
  p_total_quantity       numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total  numeric := 0;
  v_size   text;
  v_pairs  numeric;
  v_cons   numeric;
BEGIN
  IF p_consumption_per_size IS NOT NULL
     AND p_order_grade IS NOT NULL
     AND (SELECT COUNT(*) FROM jsonb_object_keys(p_consumption_per_size)) > 0
     AND (SELECT COUNT(*) FROM jsonb_object_keys(p_order_grade)) > 0
  THEN
    FOR v_size, v_pairs IN
      SELECT key, value::text::numeric FROM jsonb_each_text(p_order_grade)
    LOOP
      IF v_pairs IS NULL OR v_pairs <= 0 THEN CONTINUE; END IF;
      v_cons := COALESCE(
        NULLIF((p_consumption_per_size ->> v_size)::numeric, 0),
        p_quantity_per_unit
      );
      v_total := v_total + (v_pairs * v_cons);
    END LOOP;

    IF v_total > 0 THEN
      RETURN v_total;
    END IF;
  END IF;

  RETURN COALESCE(p_quantity_per_unit, 0) * COALESCE(p_total_quantity, 0);
END;
$$;

DROP FUNCTION IF EXISTS public.check_stock_availability(p_reference_id uuid, p_order_quantity integer, p_color text, p_order_grade jsonb) CASCADE;
CREATE OR REPLACE FUNCTION public.check_stock_availability(
  p_reference_id uuid,
  p_order_quantity integer,
  p_color text DEFAULT '',
  p_order_grade jsonb DEFAULT NULL
)
RETURNS TABLE(
  product_id   uuid,
  product_name text,
  required     numeric,
  available    numeric,
  sufficient   boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mat RECORD;
  v_required numeric;
  v_target_id uuid;
  v_target_name text;
  v_target_qty numeric;
BEGIN
  FOR mat IN
    SELECT sm.product_id,
           sm.quantity_per_unit,
           sm.consumption_per_size,
           p.quantity  AS current_stock,
           p.name,
           p.group_id,
           p.color     AS product_color
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id
  LOOP
    v_required := public.calc_required_for_grade(
      mat.consumption_per_size,
      p_order_grade,
      mat.quantity_per_unit,
      p_order_quantity
    );

    v_target_id   := mat.product_id;
    v_target_name := mat.name;
    v_target_qty  := mat.current_stock;

    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.name, p.quantity INTO v_target_id, v_target_name, v_target_qty
      FROM public.products p
      WHERE p.active = true AND p.color = p_color
        AND (  (mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
            OR (mat.group_id IS NULL      AND p.name    = mat.name    ))
      LIMIT 1;

      IF v_target_id IS NULL THEN
        v_target_id   := mat.product_id;
        v_target_name := mat.name;
        v_target_qty  := mat.current_stock;
      END IF;
    END IF;

    product_id   := v_target_id;
    product_name := v_target_name;
    required     := v_required;
    available    := v_target_qty;
    sufficient   := (v_target_qty >= v_required);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calc_required_for_grade(jsonb, jsonb, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_stock_availability(uuid, integer, text, jsonb) TO authenticated;

-- ============================================================
-- Migration 3/3: finalize_production_sector — dynamic sector flow + status fix
-- ============================================================
DROP FUNCTION IF EXISTS public.finalize_production_sector(p_order_id uuid, p_current_sector text) CASCADE;
CREATE OR REPLACE FUNCTION public.finalize_production_sector(p_order_id uuid, p_current_sector text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next_sector TEXT;
  v_result JSONB;
  v_started_at TIMESTAMPTZ;
  v_actual_minutes NUMERIC;
  v_current_stage_order INTEGER;
BEGIN
  SELECT started_at, stage_order
    INTO v_started_at, v_current_stage_order
  FROM public.order_stages
  WHERE order_id = p_order_id AND stage_name = p_current_sector;

  IF v_started_at IS NOT NULL THEN
    v_actual_minutes := EXTRACT(EPOCH FROM (NOW() - v_started_at)) / 60;
  ELSE
    v_actual_minutes := 0;
  END IF;

  UPDATE public.order_stages
  SET
    status = 'concluido',
    completed_at = NOW(),
    actual_time_minutes = v_actual_minutes,
    updated_at = NOW()
  WHERE order_id = p_order_id
    AND stage_name = p_current_sector
    AND status != 'concluido';

  SELECT stage_name INTO v_next_sector
  FROM public.order_stages
  WHERE order_id = p_order_id
    AND stage_order > COALESCE(v_current_stage_order, -1)
    AND status NOT IN ('concluido', 'cancelado')
  ORDER BY stage_order ASC
  LIMIT 1;

  IF v_next_sector IS NOT NULL THEN
    UPDATE public.orders
    SET
      status = 'Em Produção',
      production_step = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.production_orders
    SET
      current_sector = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    INSERT INTO public.notifications (sector, message)
    VALUES (v_next_sector, 'Nova carga de trabalho disponível: OP #' || p_order_id);

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', v_next_sector,
      'status', 'Em Produção',
      'actual_time_minutes', v_actual_minutes
    );
  ELSE
    UPDATE public.orders
    SET
      status = 'Pronto',
      production_step = 'Pronto',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.production_orders
    SET
      status = 'Pronto',
      current_sector = 'Pronto',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', NULL,
      'status', 'Pronto',
      'actual_time_minutes', v_actual_minutes
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- Repair stale 'EM_*' statuses left by the previous version
UPDATE public.orders
SET status = 'Em Produção', updated_at = NOW()
WHERE status LIKE 'EM_%'
  AND production_step IS NOT NULL
  AND production_step NOT IN ('Pronto', 'Pendente', 'Finalizado');