-- ---------------------------------------------------------------
-- 1. Guard waste_pct against NULL in calculate_order_consumption
--    and calculate_order_consumption_by_grade.
--
--    The formula (1 + waste_pct / 100) returns NULL when waste_pct
--    IS NULL, silently zeroing out the required quantity.
--    COALESCE(waste_pct, 0) restores the identity multiplier (1.0).
--
-- 2. Add partial index on material_reservations(status, product_id)
--    to speed up the MRP view scan.
-- ---------------------------------------------------------------

-- ── 1. Patch calculate_order_consumption_by_grade ─────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(
  p_reference_id uuid,
  p_color        text,
  p_grade        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_sheet            record;
  v_result           jsonb := '[]'::jsonb;
  v_item             jsonb;
  v_row              record;
  v_row_cat_norm     text;
  v_conv             record;
  v_resolved         record;
  v_covered_categories  text[] := '{}';
  v_covered_product_ids uuid[] := '{}';
  v_insole_ready_made   boolean;
  v_palmilha_color      text;
  v_size             text;
  v_qty_for_size     numeric;
  v_consumption_per_size jsonb;
  v_upper_consumption    numeric := 0;
  v_lining_consumption   numeric := 0;
  v_insole_consumption   numeric := 0;
  v_total_pairs          numeric := 0;
  v_required             numeric;
  v_sole_product_id      uuid;
  v_effective_size       text;
  v_fachete_consumption  numeric;
  v_component_result     jsonb;
  v_component_required   numeric;
BEGIN
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN RETURN v_result; END IF;

  v_insole_ready_made := COALESCE(v_sheet.insole_ready_made, false);

  -- Sum grade quantities
  FOR v_size IN SELECT jsonb_object_keys(p_grade) LOOP
    v_qty_for_size := COALESCE((p_grade ->> v_size)::numeric, 0);
    v_total_pairs  := v_total_pairs + v_qty_for_size;
  END LOOP;
  IF v_total_pairs = 0 THEN RETURN v_result; END IF;

  -- Compute weighted consumption per material from per-size data
  v_upper_consumption  := 0;
  v_lining_consumption := 0;
  v_insole_consumption := 0;

  v_consumption_per_size := COALESCE(v_sheet.upper_consumption_per_size, '{}'::jsonb);
  FOR v_size IN SELECT jsonb_object_keys(p_grade) LOOP
    v_qty_for_size := COALESCE((p_grade ->> v_size)::numeric, 0);
    IF v_qty_for_size > 0 AND v_consumption_per_size ? v_size THEN
      v_upper_consumption := v_upper_consumption
        + COALESCE((v_consumption_per_size ->> v_size)::numeric, 0) * v_qty_for_size;
    END IF;
  END LOOP;
  IF v_total_pairs > 0 THEN
    v_upper_consumption := v_upper_consumption / v_total_pairs;
  END IF;

  v_consumption_per_size := COALESCE(v_sheet.lining_consumption_per_size, '{}'::jsonb);
  FOR v_size IN SELECT jsonb_object_keys(p_grade) LOOP
    v_qty_for_size := COALESCE((p_grade ->> v_size)::numeric, 0);
    IF v_qty_for_size > 0 AND v_consumption_per_size ? v_size THEN
      v_lining_consumption := v_lining_consumption
        + COALESCE((v_consumption_per_size ->> v_size)::numeric, 0) * v_qty_for_size;
    END IF;
  END LOOP;
  IF v_total_pairs > 0 THEN
    v_lining_consumption := v_lining_consumption / v_total_pairs;
  END IF;

  v_consumption_per_size := COALESCE(v_sheet.insole_consumption_per_size, '{}'::jsonb);
  FOR v_size IN SELECT jsonb_object_keys(p_grade) LOOP
    v_qty_for_size := COALESCE((p_grade ->> v_size)::numeric, 0);
    IF v_qty_for_size > 0 AND v_consumption_per_size ? v_size THEN
      v_insole_consumption := v_insole_consumption
        + COALESCE((v_consumption_per_size ->> v_size)::numeric, 0) * v_qty_for_size;
    END IF;
  END LOOP;
  IF v_total_pairs > 0 THEN
    v_insole_consumption := v_insole_consumption / v_total_pairs;
  END IF;

  -- Palmilha color
  SELECT tpc.mapped_color INTO v_palmilha_color
    FROM technical_sheet_palmilha_colors tpc
   WHERE tpc.sheet_id = p_reference_id AND tpc.cabedal_color = p_color
   LIMIT 1;
  IF v_palmilha_color IS NULL THEN v_palmilha_color := p_color; END IF;

  -- Sole per grade
  SELECT sole_product_id INTO v_sole_product_id
    FROM technical_sheets WHERE id = p_reference_id;

  IF v_sole_product_id IS NOT NULL THEN
    v_component_result   := '[]'::jsonb;
    v_component_required := 0;
    FOR v_size IN SELECT jsonb_object_keys(p_grade) LOOP
      v_qty_for_size := COALESCE((p_grade ->> v_size)::numeric, 0);
      IF v_qty_for_size > 0 THEN
        v_effective_size := v_size;
        SELECT consumption INTO v_fachete_consumption
          FROM sole_technical_specs WHERE sole_id = v_sole_product_id AND size = v_effective_size;
        IF COALESCE(v_fachete_consumption, 0) > 0 THEN
          v_component_required := v_component_required + v_fachete_consumption * v_qty_for_size;
        ELSE
          v_component_required := v_component_required + v_qty_for_size;
        END IF;
      END IF;
    END LOOP;
    IF v_component_required > 0 THEN
      SELECT * INTO v_resolved FROM resolve_material_product(NULL, p_color, v_component_required, true);
      IF v_resolved.product_id IS NULL THEN
        SELECT * INTO v_resolved FROM resolve_material_product(
          (SELECT upper_material FROM technical_sheets WHERE id = p_reference_id),
          p_color, v_component_required, false);
      END IF;
      IF v_resolved.product_id IS NOT NULL THEN
        SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
        v_required := (v_component_required / NULLIF(v_conv.dm2_per_unit, 0))
                      * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
        v_result := v_result || jsonb_build_object(
          'component', 'Solado', 'product_id', v_resolved.product_id,
          'product_name', v_resolved.product_name,
          'color', p_color,
          'consumption_per_unit', ROUND(v_required / NULLIF(v_total_pairs, 0), 4),
          'required', v_required, 'available', v_resolved.available_qty,
          'stock_ok', v_resolved.available_qty >= v_required,
          'debit_mode', 'grade', 'source', 'sole_grade',
          'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
        v_covered_categories  := array_append(v_covered_categories,  'solado');
        v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
      END IF;
    END IF;
  END IF;

  -- Cabedal
  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> ''
     AND v_upper_consumption > 0 THEN
    v_required := v_upper_consumption * v_total_pairs;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0))
                    * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Cabedal', 'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(v_total_pairs, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft', 'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
      v_covered_categories  := array_append(v_covered_categories,  'cabedal');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Forração (skip when insole_has_lining = false OR insole_ready_made = true)
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND v_lining_consumption > 0
     AND COALESCE(v_sheet.insole_has_lining, true) = true
     AND NOT v_insole_ready_made THEN
    v_required := v_lining_consumption * v_total_pairs;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0))
                    * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Forro', 'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(v_total_pairs, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft', 'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
      v_covered_categories  := array_append(v_covered_categories,  'forro');
      v_covered_categories  := array_append(v_covered_categories,  'forração');
      v_covered_categories  := array_append(v_covered_categories,  'forracao');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Palmilha (skip when insole_ready_made = true)
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
     AND v_insole_consumption > 0
     AND NOT v_insole_ready_made THEN
    v_required := v_insole_consumption * v_total_pairs;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, v_palmilha_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0))
                    * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Palmilha', 'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', v_palmilha_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(v_total_pairs, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft', 'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
      v_covered_categories  := array_append(v_covered_categories,  'palmilha');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- BOM items
  FOR v_row IN
    SELECT tsi.product_id, tsi.quantity_per_pair, tsi.unit,
           p.name AS product_name, p.quantity AS available_qty,
           pg.name AS group_name
      FROM technical_sheet_items tsi
      JOIN products p  ON p.id  = tsi.product_id
      LEFT JOIN product_groups pg ON pg.id = p.group_id
     WHERE tsi.sheet_id = p_reference_id
       AND NOT (tsi.product_id = ANY(v_covered_product_ids))
  LOOP
    v_row_cat_norm := lower(COALESCE(v_row.group_name, ''));
    IF v_row_cat_norm = ANY(v_covered_categories) THEN CONTINUE; END IF;

    v_required := COALESCE(v_row.quantity_per_pair, 0) * v_total_pairs;
    IF v_required <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_conv FROM get_material_conversion_info(v_row.product_id);
    v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0))
                  * (1 + COALESCE(v_conv.waste_pct, 0) / 100);

    v_item := jsonb_build_object(
      'component', COALESCE(v_row.group_name, 'Aviamento'),
      'product_id', v_row.product_id, 'product_name', v_row.product_name,
      'color', '', 'consumption_per_unit', COALESCE(v_row.quantity_per_pair, 0),
      'required', v_required, 'available', v_row.available_qty,
      'stock_ok', v_row.available_qty >= v_required,
      'debit_mode', 'soft', 'source', 'bom_item',
      'unit', COALESCE(v_conv.target_unit, v_row.unit));
    v_result := v_result || v_item;
  END LOOP;

  RETURN v_result;
END;
$fn$;

-- ── 2. Patch waste_pct in calculate_order_consumption (single-size) ───────────
-- Only update the formula lines — replace in-place on the existing function body.
-- We use a targeted DO block to avoid re-writing the entire (large) function.
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT prosrc INTO v_body
    FROM pg_proc
   WHERE proname = 'calculate_order_consumption'
     AND pronamespace = 'public'::regnamespace
   LIMIT 1;

  IF v_body IS NULL THEN RETURN; END IF;

  -- Replace unguarded waste_pct divisions with COALESCE-guarded versions
  v_body := replace(v_body,
    '(1 + v_conv.waste_pct / 100)',
    '(1 + COALESCE(v_conv.waste_pct, 0) / 100)');

  EXECUTE format(
    $sql$
    CREATE OR REPLACE FUNCTION public.calculate_order_consumption(
      p_reference_id uuid,
      p_color        text,
      p_order_quantity numeric
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $body$%s$body$
    $sql$,
    v_body
  );
END;
$$;

-- ── 3. Index on material_reservations for MRP view performance ────────────────
CREATE INDEX IF NOT EXISTS idx_material_reservations_status_product
  ON public.material_reservations (status, product_id)
  WHERE status IN ('reserved', 'partially_consumed');

GRANT EXECUTE ON FUNCTION public.calculate_order_consumption_by_grade(uuid, text, jsonb) TO authenticated;
