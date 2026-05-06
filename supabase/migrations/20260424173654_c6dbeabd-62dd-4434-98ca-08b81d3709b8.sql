-- ── 1. Helper: compute required quantity respecting per-size consumption ──────

CREATE OR REPLACE FUNCTION public.calc_required_for_grade(
  p_consumption_per_size jsonb,    -- { "36": 0.42, "37": 0.44, ... }  (material unit per pair per size)
  p_order_grade          jsonb,    -- { "36": 50,   "37": 100, ... }   (pairs per size)
  p_quantity_per_unit    numeric,  -- fallback: average consumption per pair
  p_total_quantity       numeric   -- fallback: total pairs
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
  -- Use per-size path only when BOTH grade and consumption_per_size are non-empty
  IF p_consumption_per_size IS NOT NULL
     AND p_order_grade IS NOT NULL
     AND (SELECT COUNT(*) FROM jsonb_object_keys(p_consumption_per_size)) > 0
     AND (SELECT COUNT(*) FROM jsonb_object_keys(p_order_grade)) > 0
  THEN
    FOR v_size, v_pairs IN
      SELECT key, value::text::numeric FROM jsonb_each_text(p_order_grade)
    LOOP
      IF v_pairs IS NULL OR v_pairs <= 0 THEN CONTINUE; END IF;
      -- Use per-size consumption; fall back to quantity_per_unit if size not mapped
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

  -- Fallback: flat rate
  RETURN COALESCE(p_quantity_per_unit, 0) * COALESCE(p_total_quantity, 0);
END;
$$;

-- ── 2. Update check_stock_availability to use sheet_materials + per-size ──────
-- Replaces the old reference_materials-based check so the pre-approval
-- validation matches what hybrid_debit_stock_for_order actually debits.

CREATE OR REPLACE FUNCTION public.check_stock_availability(
  p_reference_id uuid,
  p_order_quantity integer,
  p_color text DEFAULT '',
  p_order_grade jsonb DEFAULT NULL   -- { "36": 50, "37": 100, ... }
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
  -- Check sheet_materials (ficha técnica BOM) using per-size consumption
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

    -- Resolve color variant
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.calc_required_for_grade(jsonb, jsonb, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_stock_availability(uuid, integer, text, jsonb) TO authenticated;