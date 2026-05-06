-- GRUPO B: Consumo por numeração e fluxo de setores (abr/24)

-- ========== 20260424120000_consumption-per-size-single-source.sql ==========
-- ============================================================
-- Single source of truth: consumption_per_size in sheet_materials
--
-- Before this migration, hybrid_debit_stock_for_order used
--   required = quantity_per_unit × total_pairs
-- ignoring the per-size consumption defined in the ficha técnica.
--
-- After this migration:
--   1. A helper function calc_required_for_grade() computes the
--      correct requirement using grade × consumption_per_size,
--      falling back to quantity_per_unit × total when data is absent.
--   2. check_stock_availability is updated to use sheet_materials
--      + consumption_per_size (instead of reference_materials) so the
--      pre-approval check matches what hybrid_debit_stock_for_order debits.
--
-- NOTE: hybrid_debit_stock_for_order is NOT replaced here because the
-- live version (20260419120147) uses freeze_technical_sheet and snapshots
-- which already handle per-size consumption via _calc_required_per_size.
-- ============================================================

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

-- ========== 20260424140000_fix-production-sector-flow.sql ==========
-- ============================================================
-- Fix finalize_production_sector:
--
-- Problems found in the previous version:
-- 1. Hardcoded sector flow (Corte→Aviamento→Solagem→Acabamento) meant
--    any OP with additional sectors (e.g. Costura, Montagem) defined in
--    the ficha técnica would get stuck when finalized.
-- 2. Intermediate status was set to 'EM_SETOR' (e.g. 'EM_AVIAMENTO')
--    breaking all queries that filter on status = 'Em Produção'.
-- 3. actual_time_minutes was already being computed correctly from
--    started_at, but only populated when the trigger set started_at.
--
-- Fixes:
-- 1. Next sector is determined dynamically from order_stages (stage_order).
-- 2. status stays 'Em Produção' throughout production; 'Pronto' on completion.
-- 3. No change to actual_time_minutes logic (already correct).
-- ============================================================

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
  -- Get started_at for duration calculation
  SELECT started_at, stage_order
    INTO v_started_at, v_current_stage_order
  FROM public.order_stages
  WHERE order_id = p_order_id AND stage_name = p_current_sector;

  IF v_started_at IS NOT NULL THEN
    v_actual_minutes := EXTRACT(EPOCH FROM (NOW() - v_started_at)) / 60;
  ELSE
    v_actual_minutes := 0;
  END IF;

  -- Mark current stage as completed
  UPDATE public.order_stages
  SET
    status = 'concluido',
    completed_at = NOW(),
    actual_time_minutes = v_actual_minutes,
    updated_at = NOW()
  WHERE order_id = p_order_id
    AND stage_name = p_current_sector
    AND status != 'concluido';

  -- Find next pending sector dynamically via stage_order
  SELECT stage_name INTO v_next_sector
  FROM public.order_stages
  WHERE order_id = p_order_id
    AND stage_order > COALESCE(v_current_stage_order, -1)
    AND status NOT IN ('concluido', 'cancelado')
  ORDER BY stage_order ASC
  LIMIT 1;

  IF v_next_sector IS NOT NULL THEN
    -- Advance production_step; keep status = 'Em Produção'.
    -- The trigger sync_order_stages_with_kanban will set started_at on the next stage.
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
    -- All sectors done: mark OP as Pronto
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

-- Also fix any existing orders that ended up with stale 'EM_*' status values.
-- Restore them to 'Em Produção' so they show up in standard production queries.
UPDATE public.orders
SET status = 'Em Produção', updated_at = NOW()
WHERE status LIKE 'EM_%'
  AND production_step IS NOT NULL
  AND production_step NOT IN ('Pronto', 'Pendente', 'Finalizado');

-- ========== 20260424180000_fix-packaging-debit-stock-movements.sql ==========
-- ============================================================
-- Fix debit_packaging_for_order: insert stock_movements when
-- debiting box_types so that:
--   1. There is a full audit trail for packaging consumption.
--   2. restore_product_stocks_for_order can reverse the debit
--      when an OP is cancelled (it reads from stock_movements).
-- ============================================================

CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid,
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg          RECORD;
  boxes_needed integer;
  v_result     jsonb := '[]'::jsonb;
  v_types_to_debit text[];
BEGIN
  -- Determine which packaging types to debit based on mode
  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box, pc.product_id, pc.box_type_id,
           p.name    AS product_name, p.quantity AS current_stock,
           bt.quantity AS box_stock,  bt.nome   AS box_name
    FROM packaging_configs pc
    LEFT JOIN products  p  ON p.id  = pc.product_id  AND p.active  = true
    LEFT JOIN box_types bt ON bt.id = pc.box_type_id AND bt.active = true
    WHERE pc.sheet_id      = p_reference_id
      AND pc.active        = true
      AND pc.packaging_type = ANY(v_types_to_debit)
  LOOP
    boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    -- Primary path: debit box_types (centralised packaging stock)
    IF cfg.box_type_id IS NOT NULL THEN
      IF cfg.box_stock IS NULL OR cfg.box_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.box_name, cfg.nome), COALESCE(cfg.box_stock, 0), boxes_needed;
      END IF;

      UPDATE box_types
      SET quantity = quantity - boxes_needed, updated_at = now()
      WHERE id = cfg.box_type_id;

      -- Audit trail so restore_product_stocks_for_order can reverse this debit
      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.box_type_id, 'out', boxes_needed,
        cfg.box_stock, cfg.box_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.box_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'box_type_id',    cfg.box_type_id,
        'box_name',       COALESCE(cfg.box_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_box_types'
      );

    -- Legacy path: debit from products table (direct product link)
    ELSIF cfg.product_id IS NOT NULL THEN
      IF cfg.current_stock IS NULL OR cfg.current_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.product_name, cfg.nome), COALESCE(cfg.current_stock, 0), boxes_needed;
      END IF;

      UPDATE products
      SET quantity = quantity - boxes_needed, updated_at = now()
      WHERE id = cfg.product_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.product_id, 'out', boxes_needed,
        cfg.current_stock, cfg.current_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'product_id',     cfg.product_id,
        'product_name',   COALESCE(cfg.product_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_products'
      );

    ELSE
      -- No stock linked — log but do not raise (packaging config may be optional)
      v_result := v_result || jsonb_build_object(
        'packaging_type', cfg.packaging_type,
        'nome',           cfg.nome,
        'status',         'skipped',
        'reason',         'no_stock_linked'
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) TO authenticated;

-- GRUPO C: Consumo primário + conjugações de numeração (abr/26)

-- ========== 20260426120000_consumption-per-size-as-primary-source.sql ==========
-- Make technical_sheets.*_consumption_per_size the primary source for all consumption calculations.
-- Priority: sheet per-size → sole_technical_specs (if sole_drives_consumption) → scalar fallback.

CREATE OR REPLACE FUNCTION public.calculate_order_consumption(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_size integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet RECORD;
  v_sole_product_id uuid;
  v_sole_color text;
  v_spec RECORD;
  v_result jsonb := '[]'::jsonb;
  v_row RECORD;
  v_item jsonb;
  v_pid uuid;
  v_consumption numeric;
  v_required numeric;
  v_resolved RECORD;
  v_group_name text;
  v_effective_size integer;
  v_lining_consumption numeric;
  v_insole_consumption numeric;
  v_upper_consumption numeric;
  v_covered_categories text[] := ARRAY[]::text[];
  v_covered_product_ids uuid[] := ARRAY[]::uuid[];
  v_row_cat_norm text;
  v_conv RECORD;
BEGIN
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  v_effective_size := COALESCE(p_size, v_sheet.reference_size, 37);

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  -- 1. Read per-size consumption from the sheet (primary source)
  v_upper_consumption  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_effective_size::text))::numeric, 0), 0);
  v_lining_consumption := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);
  v_insole_consumption := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);

  -- 2. Fallback: sole_technical_specs (when sole_drives_consumption and sheet has no per-size)
  IF (v_upper_consumption IS NULL OR v_lining_consumption IS NULL OR v_insole_consumption IS NULL)
     AND v_sheet.sole_drives_consumption AND v_sole_product_id IS NOT NULL THEN
    SELECT * INTO v_spec FROM sole_technical_specs
    WHERE sole_id = v_sole_product_id AND size = v_effective_size;
    IF FOUND THEN
      IF v_upper_consumption  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper_consumption  := v_spec.upper_consumption_dm2;  END IF;
      IF v_lining_consumption IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining_consumption := v_spec.lining_consumption_dm2; END IF;
      IF v_insole_consumption IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole_consumption := v_spec.insole_consumption_dm2; END IF;
    END IF;
  END IF;

  -- 3. Final fallback: scalar average from sheet
  v_upper_consumption  := COALESCE(v_upper_consumption,  v_sheet.upper_consumption,  0);
  v_lining_consumption := COALESCE(v_lining_consumption, v_sheet.lining_consumption, 0);
  v_insole_consumption := COALESCE(v_insole_consumption, v_sheet.insole_consumption, 0);

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    v_required := p_order_quantity;
    SELECT p.name, p.quantity INTO v_row FROM products p WHERE p.id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado',
      'product_id', v_sole_product_id,
      'product_name', v_row.name,
      'color', v_sole_color,
      'consumption_per_unit', 1,
      'required', v_required,
      'available', v_row.quantity,
      'stock_ok', v_row.quantity >= v_required,
      'debit_mode', 'hard',
      'source', 'primary_sole'
    );
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  -- Cabedal
  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> ''
     AND v_upper_consumption > 0 THEN
    v_required := v_upper_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Cabedal',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by,
        'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'cabedal');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Forração
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND v_lining_consumption > 0 THEN
    v_required := v_lining_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Forro',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by,
        'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'forro');
      v_covered_categories := array_append(v_covered_categories, 'forração');
      v_covered_categories := array_append(v_covered_categories, 'forracao');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Palmilha
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
     AND v_insole_consumption > 0 THEN
    v_required := v_insole_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Palmilha',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by,
        'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'palmilha');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Direct Components from technical_sheets.direct_components (JSONB array)
  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * p_order_quantity;
        IF v_required > 0 THEN
          SELECT name, quantity, category INTO v_row FROM products WHERE id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto',
              'product_id', v_pid,
              'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric,
              'required', v_required,
              'available', v_row.quantity,
              'stock_ok', v_row.quantity >= v_required,
              'debit_mode', CASE
                WHEN LOWER(COALESCE(v_row.category, '')) IN
                  ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
                ELSE 'soft'
              END,
              'source', 'direct_components'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- BOM legacy
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color, p.group_id
    FROM sheet_materials sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories) THEN CONTINUE; END IF;

    v_required := v_row.quantity_per_unit * p_order_quantity;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM',
      'product_id', v_row.product_id,
      'product_name', v_row.name,
      'color', v_row.product_color,
      'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required,
      'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE
        WHEN LOWER(COALESCE(v_row.category, '')) IN
          ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
        ELSE 'soft'
      END,
      'source', 'sheet_materials',
      'category', v_row.category
    );
  END LOOP;

  RETURN v_result;
END;
$function$;

-- Grade-based version: reads technical_sheets.*_consumption_per_size per size (primary),
-- falls back to sole_technical_specs, then to sheet scalar.
CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(
  p_reference_id uuid,
  p_grade jsonb,
  p_color text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet RECORD;
  v_sole_product_id uuid;
  v_sole_color text;
  v_total_qty numeric := 0;
  v_size integer;
  v_pairs numeric;
  v_spec RECORD;
  v_upper numeric;
  v_lining numeric;
  v_insole numeric;
  v_resolved RECORD;
  v_row RECORD;
  v_item jsonb;
  v_pid uuid;
  v_consumption numeric;
  v_required numeric;
  v_group_name text;
  v_covered_categories text[] := ARRAY[]::text[];
  v_covered_product_ids uuid[] := ARRAY[]::uuid[];
  v_row_cat_norm text;
  v_acc_upper jsonb := '{}'::jsonb;
  v_acc_lining jsonb := '{}'::jsonb;
  v_acc_insole jsonb := '{}'::jsonb;
  v_acc_std jsonb := '{}'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_upper_pid uuid;
  v_lining_pid uuid;
  v_insole_pid uuid;
  v_std_item RECORD;
  v_key text;
  v_acc_required numeric;
  v_acc_avail numeric;
  v_acc_name text;
  v_conv RECORD;
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' THEN
    RAISE EXCEPTION 'Grade inválida (precisa ser JSON object {size: pairs})';
  END IF;

  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  SELECT COALESCE(SUM((value)::numeric), 0) INTO v_total_qty
  FROM jsonb_each_text(p_grade)
  WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0;

  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Grade vazia (sem pares)';
  END IF;

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    v_upper_pid := v_resolved.product_id;
  END IF;
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    v_lining_pid := v_resolved.product_id;
  END IF;
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, 0, false);
    v_insole_pid := v_resolved.product_id;
  END IF;

  FOR v_size, v_pairs IN
    SELECT key::integer, value::numeric
      FROM jsonb_each_text(p_grade)
     WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0
  LOOP
    -- 1. Per-size from ficha técnica (primary source)
    v_upper  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0);
    v_lining := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0);

    -- 2. Fallback: sole_technical_specs for any missing value
    IF (v_upper IS NULL OR v_lining IS NULL OR v_insole IS NULL)
       AND v_sheet.sole_drives_consumption AND v_sole_product_id IS NOT NULL THEN
      SELECT * INTO v_spec FROM sole_technical_specs
       WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_upper  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper  := v_spec.upper_consumption_dm2;  END IF;
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining := v_spec.lining_consumption_dm2; END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole := v_spec.insole_consumption_dm2; END IF;
      END IF;
    END IF;

    -- 3. Last fallback: scalar from sheet
    v_upper  := COALESCE(v_upper,  v_sheet.upper_consumption,  0);
    v_lining := COALESCE(v_lining, v_sheet.lining_consumption, 0);
    v_insole := COALESCE(v_insole, v_sheet.insole_consumption, 0);

    IF v_upper_pid IS NOT NULL AND v_upper > 0 THEN
      v_acc_upper := jsonb_set(v_acc_upper, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_upper->>'required')::numeric, 0) + v_upper * v_pairs));
    END IF;
    IF v_lining_pid IS NOT NULL AND v_lining > 0 THEN
      v_acc_lining := jsonb_set(v_acc_lining, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_lining->>'required')::numeric, 0) + v_lining * v_pairs));
    END IF;
    IF v_insole_pid IS NOT NULL AND v_insole > 0 THEN
      v_acc_insole := jsonb_set(v_acc_insole, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_insole->>'required')::numeric, 0) + v_insole * v_pairs));
    END IF;

    -- Standard items per sole (unchanged)
    IF v_sole_product_id IS NOT NULL THEN
      FOR v_std_item IN
        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit
          FROM sole_standard_items_consumption ssic
         WHERE ssic.sole_product_id = v_sole_product_id AND ssic.size = v_size AND ssic.consumption > 0
      LOOP
        v_key := v_std_item.pid::text;
        v_acc_required := COALESCE((v_acc_std #>> ARRAY[v_key,'required'])::numeric, 0) + v_std_item.cons * v_pairs;
        v_acc_std := jsonb_set(v_acc_std, ARRAY[v_key], jsonb_build_object('required', v_acc_required, 'unit', v_std_item.unit));
      END LOOP;
    END IF;
  END LOOP;

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object('component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_acc_name, 'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_total_qty, 'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_total_qty, 'debit_mode', 'hard', 'source', 'primary_sole');
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  -- Cabedal
  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_upper_pid);
    v_required := ((v_acc_upper->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Cabedal', 'product_id', v_upper_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

  -- Forro
  IF v_lining_pid IS NOT NULL AND COALESCE((v_acc_lining->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_lining_pid);
    v_required := ((v_acc_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Forro', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'forro');
    v_covered_categories := array_append(v_covered_categories, 'forração');
    v_covered_categories := array_append(v_covered_categories, 'forracao');
    v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
  END IF;

  -- Palmilha
  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_insole_pid);
    v_required := ((v_acc_insole->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Palmilha', 'product_id', v_insole_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  -- Items padrão (solado) acumulados
  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    SELECT name, quantity, category INTO v_acc_name, v_acc_avail, v_row_cat_norm
      FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name, 'color', '', 'consumption_per_unit', ROUND(v_acc_required / NULLIF(v_total_qty, 0), 4), 'required', v_acc_required, 'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_acc_required, 'debit_mode', CASE WHEN LOWER(COALESCE(v_row_cat_norm, '')) IN ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard' ELSE 'soft' END, 'source', 'sole_standard_per_size', 'unit', (v_acc_std #>> ARRAY[v_key,'unit']));
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  -- Direct Components
  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * v_total_qty;
        IF v_required > 0 THEN
          SELECT name, quantity, category INTO v_row FROM products WHERE id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto',
              'product_id', v_pid,
              'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric,
              'required', v_required,
              'available', v_row.quantity,
              'stock_ok', v_row.quantity >= v_required,
              'debit_mode', CASE
                WHEN LOWER(COALESCE(v_row.category, '')) IN
                  ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
                ELSE 'soft'
              END,
              'source', 'direct_components'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- BOM Legado
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color
      FROM sheet_materials sm
      JOIN products p ON p.id = sm.product_id
     WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories) THEN CONTINUE; END IF;

    v_required := v_row.quantity_per_unit * v_total_qty;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM',
      'product_id', v_row.product_id,
      'product_name', v_row.name,
      'color', v_row.product_color,
      'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required,
      'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE
        WHEN LOWER(COALESCE(v_row.category, '')) IN
          ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
        ELSE 'soft' END,
      'source', 'sheet_materials',
      'category', v_row.category
    );
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  RETURN v_result;
END;
$function$;

-- ========== 20260426130000_sole-size-conjugations.sql ==========
-- New table to store conjugation config per sole group
CREATE TABLE IF NOT EXISTS public.sole_size_conjugations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sole_group_id uuid NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
  size_key text NOT NULL,          -- display key: "23/24", "25/26", "35"
  sizes integer[] NOT NULL,        -- e.g. [23,24] or [35]
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(sole_group_id, size_key)
);

-- Helper: for a sole group + shoe size, return the conjugated key (or NULL if not configured)
CREATE OR REPLACE FUNCTION public.get_sole_size_key(p_sole_group_id uuid, p_shoe_size integer)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT size_key
  FROM sole_size_conjugations
  WHERE sole_group_id = p_sole_group_id
    AND p_shoe_size = ANY(sizes)
  LIMIT 1;
$$;

-- Helper: return group_id for a given product_id
CREATE OR REPLACE FUNCTION public.get_sole_group_id_for_product(p_product_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT group_id FROM public.products WHERE id = p_product_id LIMIT 1;
$$;

-- Updated debit_sole_stock_by_grade with conjugation support
CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id uuid,
  p_color text,
  p_order_grade jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id uuid;
  v_sole_material text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id uuid;
  target_product_id uuid;
  target_name text;
  v_stock_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_new_grade jsonb;
  v_total_debited numeric := 0;
  v_prev_total numeric;
  v_product_group_id uuid;
  v_conj_grade jsonb;
  v_conj_key text;
  v_existing_qty numeric;
BEGIN
  SELECT ts.sole_group_id, ts.sole_material
  INTO v_sole_group_id, v_sole_material
  FROM public.technical_sheets ts
  WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN
    RETURN;
  END IF;

  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  SELECT tsc.sole_product_id, tsc.sole_group_id
  INTO v_mapped_sole_product_id, v_mapped_sole_group_id
  FROM public.technical_sheet_sole_colors tsc
  WHERE tsc.sheet_id = p_reference_id
    AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
  LIMIT 1;

  target_product_id := NULL;

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade
    INTO target_product_id, target_name, v_stock_grade
    FROM public.products p
    WHERE p.active = true
      AND p.id = v_mapped_sole_product_id
    LIMIT 1;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_mapped_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_mapped_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = v_sole_material
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = v_sole_material
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN
    RETURN;
  END IF;

  IF v_stock_grade IS NULL THEN
    v_stock_grade := '{}'::jsonb;
  END IF;

  -- Get the group_id for the resolved target product
  SELECT p.group_id INTO v_product_group_id
  FROM public.products p
  WHERE p.id = target_product_id;

  -- Build conjugated grade from p_order_grade
  -- For each size in p_order_grade, check if it maps to a conjugated key
  v_conj_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(p_order_grade)
    WHERE value::numeric > 0
  LOOP
    IF v_product_group_id IS NOT NULL THEN
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
    ELSE
      v_conj_key := NULL;
    END IF;

    -- Use conjugated key if available, else original size string
    IF v_conj_key IS NULL THEN
      v_conj_key := v_size;
    END IF;

    -- Accumulate quantities under the conjugated key
    v_existing_qty := COALESCE((v_conj_grade ->> v_conj_key)::numeric, 0);
    v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
  END LOOP;

  v_new_grade := v_stock_grade;
  v_prev_total := 0;

  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade)
  LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- Validate stock availability using conjugated grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponivel %, necessario %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- Debit stock using conjugated grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
    SET stock_grade = v_new_grade,
        quantity = GREATEST(0, quantity - v_total_debited),
        updated_at = now()
    WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id,
      movement_type,
      quantity,
      previous_stock,
      new_stock,
      description,
      order_id
    )
    VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Debito Solado por grade (' || target_name || ')' || CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor do produto: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;

-- ========== 20260426140000_fix-conjugation-debit-legacy-fallback.sql ==========
-- Fix: debit_sole_stock_by_grade with conjugation only applies conjugated key
-- when that key actually exists in stock_grade. If stock was recorded with individual
-- keys ("23", "24") before conjugation was configured, fall back to individual keys.
-- This makes conjugation backwards-compatible with existing stock data.

CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id uuid,
  p_color text,
  p_order_grade jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id uuid;
  v_sole_material text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id uuid;
  target_product_id uuid;
  target_name text;
  v_stock_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_new_grade jsonb;
  v_total_debited numeric := 0;
  v_prev_total numeric;
  v_product_group_id uuid;
  v_conj_grade jsonb;
  v_conj_key text;
  v_existing_qty numeric;
BEGIN
  SELECT ts.sole_group_id, ts.sole_material
  INTO v_sole_group_id, v_sole_material
  FROM public.technical_sheets ts
  WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN
    RETURN;
  END IF;

  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  SELECT tsc.sole_product_id, tsc.sole_group_id
  INTO v_mapped_sole_product_id, v_mapped_sole_group_id
  FROM public.technical_sheet_sole_colors tsc
  WHERE tsc.sheet_id = p_reference_id
    AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
  LIMIT 1;

  target_product_id := NULL;

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade
    INTO target_product_id, target_name, v_stock_grade
    FROM public.products p
    WHERE p.active = true AND p.id = v_mapped_sole_product_id
    LIMIT 1;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN RETURN; END IF;

  IF v_stock_grade IS NULL THEN
    v_stock_grade := '{}'::jsonb;
  END IF;

  SELECT p.group_id INTO v_product_group_id FROM public.products p WHERE p.id = target_product_id;

  -- Build effective debit grade:
  -- For each order size, look up its conjugated key.
  -- Use the conjugated key ONLY if it already exists in stock_grade (new stock format).
  -- Otherwise fall back to the individual size key (legacy stock format).
  -- This makes conjugation backwards-compatible with existing per-size stock data.
  v_conj_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(p_order_grade)
    WHERE value::numeric > 0
  LOOP
    v_conj_key := NULL;

    IF v_product_group_id IS NOT NULL THEN
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
    END IF;

    -- Only use conjugated key if it actually exists in stock_grade
    IF v_conj_key IS NOT NULL AND (v_stock_grade ->> v_conj_key) IS NOT NULL THEN
      v_existing_qty := COALESCE((v_conj_grade ->> v_conj_key)::numeric, 0);
      v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
    ELSE
      -- Fallback: use original size string (legacy individual keys or no conjugation)
      v_existing_qty := COALESCE((v_conj_grade ->> v_size)::numeric, 0);
      v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_size], to_jsonb(v_existing_qty + v_size_qty));
    END IF;
  END LOOP;

  v_new_grade := v_stock_grade;
  v_prev_total := 0;

  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade) LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- Validate stock availability using effective grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponivel %, necessario %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- Debit stock using effective grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
    SET stock_grade = v_new_grade,
        quantity = GREATEST(0, quantity - v_total_debited),
        updated_at = now()
    WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Debito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor do produto: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;

-- ========== 20260426160000_fix-restore-box-types-stock.sql ==========
-- Fix: restore_product_stocks_for_order was only restoring to `products` table,
-- but packaging debited via box_type_id updates `box_types` (a separate table).
-- This caused box_types stock to be permanently lost when an OP was cancelled.
-- Fix: attempt restore in `products` first; if not found, restore in `box_types`.

CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      RECORD;
  v_prev_qty numeric;
  v_new_qty  numeric;
BEGIN
  FOR v_row IN
    SELECT product_id, SUM(quantity) AS total_qty
    FROM stock_movements
    WHERE order_id = p_order_id
      AND movement_type = 'out'
    GROUP BY product_id
  LOOP
    -- Try products table first
    UPDATE products
    SET quantity = quantity + v_row.total_qty
    WHERE id = v_row.product_id
    RETURNING quantity - v_row.total_qty, quantity
    INTO v_prev_qty, v_new_qty;

    IF FOUND THEN
      INSERT INTO stock_movements(
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        v_row.product_id, 'in', v_row.total_qty,
        v_prev_qty, v_new_qty,
        'Estorno automático - Exclusão de OP',
        p_order_id
      );
    ELSE
      -- Not a product — try box_types (packaging stock)
      UPDATE box_types
      SET quantity = quantity + v_row.total_qty
      WHERE id = v_row.product_id
      RETURNING quantity - v_row.total_qty, quantity
      INTO v_prev_qty, v_new_qty;

      IF FOUND THEN
        INSERT INTO stock_movements(
          product_id, movement_type, quantity,
          previous_stock, new_stock, description, order_id
        ) VALUES (
          v_row.product_id, 'in', v_row.total_qty,
          v_prev_qty, v_new_qty,
          'Estorno automático embalagem - Exclusão de OP',
          p_order_id
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_product_stocks_for_order(uuid) TO authenticated;

-- ========== 20260426170000_fix-strap-flat-consumption-unit.sql ==========
-- Fix: debit_strap_stock flat path unit mismatch
--
-- When consumption_per_size exists, the UI stores strap.consumption as the
-- average of the per-size values (in cm). But the flat fallback path used
-- v_consumption * p_order_quantity treating it as meters, causing 100x over-debit
-- on grade-less orders when per-size data is present.
--
-- Fix: when v_per_size is non-empty (consumption was set from per-size cm values),
-- divide by 100 to convert cm → meters before multiplying by order quantity.
-- Legacy data (no v_per_size) keeps the original meters-direct behaviour.

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
  v_per_size_has_data boolean;
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

    -- Check whether per-size data actually contains values
    v_per_size_has_data := v_per_size IS NOT NULL
      AND jsonb_typeof(v_per_size) = 'object'
      AND v_per_size <> '{}'::jsonb;

    IF v_per_size_has_data
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      -- Grade-based: sum(pairs × cm_per_size) then convert to meters
      v_total_cm := 0;
      v_grade_total := 0;

      FOR v_size, v_pairs IN
        SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        -- v_consumption fallback is also in cm (set from per-size average in UI)
        v_cm_per_pair := COALESCE(NULLIF((v_per_size ->> v_size)::numeric, 0), v_consumption);
        v_total_cm    := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;

      IF v_grade_total > 0 THEN
        v_fichas := GREATEST(1, round(p_order_quantity::numeric / v_grade_total));
      ELSE
        v_fichas := 1;
      END IF;

      v_required := (v_total_cm * v_fichas) / 100; -- cm → meters

    ELSIF v_per_size_has_data THEN
      -- Per-size data exists but no grade (flat order):
      -- v_consumption was saved as cm average → divide by 100 to get meters
      v_required := (v_consumption / 100.0) * p_order_quantity;

    ELSE
      -- Legacy: no per-size data; v_consumption is already in meters per pair
      v_required := v_consumption * p_order_quantity;
    END IF;

    IF v_required <= 0 THEN CONTINUE; END IF;

    -- Find matching product: same group + same color
    SELECT p.id, p.name, p.quantity
    INTO v_product_id, v_product_name, v_current_qty
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND p.color = v_color
    LIMIT 1;

    IF v_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity
      INTO v_product_id, v_product_name, v_current_qty
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_group_id
        AND (p.color IS NULL OR trim(p.color) = '')
      LIMIT 1;
    END IF;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Material da tira nao encontrado no estoque (grupo: %)', v_group_id;
    END IF;

    IF v_current_qty < v_required THEN
      RAISE EXCEPTION 'Estoque insuficiente para tira "%" (cor: %): disponivel %, necessario %',
        v_product_name, v_color, v_current_qty, v_required;
    END IF;

    UPDATE public.products
    SET quantity = quantity - v_required, updated_at = now()
    WHERE id = v_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_product_id, 'out', v_required,
      v_current_qty, v_current_qty - v_required,
      'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color
        || ' - ' || round(v_required, 4) || 'm x ' || p_order_quantity || ' pares',
      p_order_id
    );
  END LOOP;
END;
$function$;
