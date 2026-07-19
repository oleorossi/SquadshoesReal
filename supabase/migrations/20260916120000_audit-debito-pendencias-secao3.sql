-- ============================================================================
-- Auditoria débito ficha×grade (2026-07-18/19) — aplicação dos 17 achados
-- CONFIRMADOS pendentes (seção 3 do docs/AUDITORIA_DEBITO_FICHA_GRADE_2026-07-18.md)
--
-- CONS-1  by_grade: reintroduz source='fallback_average' + consumption_warning
-- CONS-4  check_stock_availability: p_material_variant_id (badge do PV com variante)
-- DEB-5   record_order_consumption: ignora movimento cujo product_id não é produto
--         (débito de embalagem grava box_types.id — FK abort na finalização)
-- RES-5   list_orphan_reservations: enxerga partially_consumed + resíduo >0
-- RES-9   restore_product_stocks_for_order: estorna resíduo de produto com grade
-- SQL-1   by_grade: BOM via get_effective_bom (escopo de variante)
-- CONS-5  DROP das sobrecargas 4-arg mortas dos resolvers upper/lining
-- CONS-6  by_grade: fachete resolve por products.fachete_material_group_id (paridade TS)
-- CONS-7  by_grade + check_stock: forro do CABEDAL sem gate de insole_has_lining (paridade TS)
-- CONS-8  guard de consumo implausível em sole_technical_specs
-- RES-6   matriz de status unificada nas 2 triggers de release
-- RES-8   confirm_picking_reservation: is_approved_user + rejeita kind sole_*
--
-- Idempotente: CREATE OR REPLACE / DROP IF EXISTS / re-CREATE de triggers.
-- Base = banco VIVO (pg_get_functiondef em 2026-07-19), não os arquivos antigos.
-- Guards: G11–G22 em run_debit_guard_tests() + CASO 3b em run_consumption_integration_tests().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(p_reference_id uuid, p_grade jsonb, p_color text, p_material_variant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet RECORD; v_sole_product_id uuid; v_sole_color text;
  v_total_qty numeric := 0; v_size integer; v_pairs numeric;
  v_spec RECORD; v_upper numeric; v_lining numeric; v_insole numeric;
  v_resolved RECORD; v_conv RECORD; v_row RECORD; v_item jsonb;
  v_consumption numeric; v_required numeric; v_group_name text;
  v_covered_categories text[] := ARRAY[]::text[];
  v_covered_product_ids uuid[] := ARRAY[]::uuid[];
  v_row_cat_norm text;
  v_acc_upper jsonb := '{}'::jsonb;
  v_acc_lining jsonb := '{}'::jsonb;
  v_acc_insole jsonb := '{}'::jsonb;
  v_acc_std jsonb := '{}'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_upper_pid uuid; v_lining_pid uuid; v_insole_pid uuid;
  v_std_item RECORD; v_key text;
  v_acc_required numeric; v_acc_avail numeric; v_acc_name text;
  v_palmilha_color text;
  v_variant RECORD; v_variant_sole_pid uuid;
  v_is_palmilha_pronta boolean := false;
  v_insole_lining numeric;
  v_acc_insole_lining jsonb := '{}'::jsonb;
  v_pid uuid;
  v_is_fachetado boolean := false;
  v_fachete numeric;
  v_acc_fachete jsonb := '{}'::jsonb;
  v_warn_fachete_sizes integer[] := ARRAY[]::integer[];
  v_prod_unit text; v_std_unit text; v_converted numeric;
  v_has_color_components boolean := false;
  v_lining_group text;
  v_lining_is_alt boolean := false;
  v_lining_alt_group text;
  v_lining_alt_cons numeric;
  v_suppress_cabedal_lining boolean := false;
  v_sole_has_palm_forro boolean;
  v_sole_has_cabedal_forro boolean;
  -- CONS-1: tamanhos que caíram na média escalar da ficha, por componente
  v_fb_upper text[] := ARRAY[]::text[];
  v_fb_lining text[] := ARRAY[]::text[];
  v_fb_insole text[] := ARRAY[]::text[];
  v_fb_insole_lining text[] := ARRAY[]::text[];
  v_ovr_upper numeric; v_ovr_lining numeric; v_ovr_insole numeric;
  -- CONS-6: grupo do fachete (products.fachete_material_group_id do solado)
  v_fachete_group text;
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' THEN
    RAISE EXCEPTION 'Grade invalida (precisa ser JSON object {size: pairs})';
  END IF;
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha tecnica % nao encontrada', p_reference_id; END IF;

  SELECT COALESCE(SUM((value)::numeric), 0) INTO v_total_qty
  FROM jsonb_each_text(p_grade) WHERE key ~ '^[0-9]+(/[0-9]+)?$' AND (value)::numeric > 0;
  IF v_total_qty <= 0 THEN RAISE EXCEPTION 'Grade vazia (sem pares)'; END IF;

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  IF p_material_variant_id IS NOT NULL THEN
    SELECT product_id INTO v_variant_sole_pid FROM public.resolve_sole_for_variant(p_material_variant_id);
    IF v_variant_sole_pid IS NOT NULL THEN v_sole_product_id := v_variant_sole_pid; END IF;
  END IF;

  v_is_palmilha_pronta := COALESCE(v_sheet.insole_ready_made, false)
    OR EXISTS (SELECT 1 FROM products WHERE id = v_sole_product_id AND sole_classification::text = 'palmilha_pronta');

  IF v_sole_product_id IS NOT NULL THEN
    SELECT COALESCE(is_fachetado, false) INTO v_is_fachetado
      FROM products WHERE id = v_sole_product_id;
  END IF;

  IF COALESCE(v_sheet.sole_drives_consumption, false) AND v_sole_product_id IS NOT NULL THEN
    SELECT bool_or(COALESCE(insole_lining_consumption_dm2, 0) > 0),
           bool_or(COALESCE(lining_consumption_dm2, 0) > 0)
      INTO v_sole_has_palm_forro, v_sole_has_cabedal_forro
      FROM sole_technical_specs WHERE sole_id = v_sole_product_id;
    v_suppress_cabedal_lining := COALESCE(v_sole_has_palm_forro, false)
                                 AND NOT COALESCE(v_sole_has_cabedal_forro, false);
  END IF;

  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id);
    v_upper_pid := v_resolved.product_id;
  END IF;

  -- CONS-7: o forro do CABEDAL não depende de insole_has_lining (que descreve a
  -- PALMILHA) — o motor TS canônico (orderConsumption.ts) nunca teve esse gate.
  -- O gate permanece só na emissão de 'Forração Palmilha' (abaixo), como no TS.
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> '' THEN
    IF p_color IS NULL OR btrim(p_color) = ''
       OR public.group_covers_color(v_sheet.lining_material, p_color) THEN
      v_lining_group := v_sheet.lining_material;
    ELSIF jsonb_typeof(v_sheet.lining_accessories) = 'array' THEN
      SELECT t.acc->>'material', (t.acc->>'consumption')::numeric
        INTO v_lining_alt_group, v_lining_alt_cons
        FROM jsonb_array_elements(v_sheet.lining_accessories) WITH ORDINALITY AS t(acc, ord)
       WHERE COALESCE((t.acc->>'consumption')::numeric, 0) > 0
         AND COALESCE(t.acc->>'material', '') <> ''
         AND public.group_covers_color(t.acc->>'material', p_color)
       ORDER BY t.ord LIMIT 1;
      IF v_lining_alt_group IS NOT NULL THEN
        v_lining_is_alt := true; v_lining_group := v_lining_alt_group;
      ELSE
        v_lining_group := v_sheet.lining_material;
      END IF;
    ELSE
      v_lining_group := v_sheet.lining_material;
    END IF;

    IF v_lining_is_alt THEN
      SELECT product_id INTO v_lining_pid FROM resolve_material_product(v_lining_group, p_color, 0, false);
    ELSE
      SELECT * INTO v_resolved FROM resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
      v_lining_pid := v_resolved.product_id;
    END IF;
  ELSIF jsonb_typeof(v_sheet.lining_accessories) = 'array' THEN -- CONS-7
    SELECT t.acc->>'material', (t.acc->>'consumption')::numeric
      INTO v_lining_alt_group, v_lining_alt_cons
      FROM jsonb_array_elements(v_sheet.lining_accessories) WITH ORDINALITY AS t(acc, ord)
     WHERE COALESCE((t.acc->>'consumption')::numeric, 0) > 0
       AND COALESCE(t.acc->>'material', '') <> ''
     ORDER BY public.group_covers_color(t.acc->>'material', p_color) DESC, t.ord
     LIMIT 1;
    IF v_lining_alt_group IS NOT NULL THEN
      v_lining_is_alt := true; v_lining_group := v_lining_alt_group;
      SELECT product_id INTO v_lining_pid FROM resolve_material_product(v_lining_group, p_color, 0, false);
    END IF;
  END IF;

  v_palmilha_color := p_color;
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '' THEN
    IF COALESCE(v_sheet.insole_has_lining, true) = false THEN
      SELECT palmilha_color INTO v_palmilha_color FROM technical_sheet_palmilha_colors
      WHERE sheet_id = p_reference_id AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
      ORDER BY (cabedal_color = p_color) DESC LIMIT 1;
      v_palmilha_color := COALESCE(v_palmilha_color, p_color);
    END IF;
    SELECT * INTO v_resolved FROM resolve_insole_material_for_variant(p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0);
    v_insole_pid := v_resolved.product_id;
  END IF;

  IF p_material_variant_id IS NOT NULL THEN
    SELECT upper_consumption_override, lining_consumption_override, insole_consumption_override
      INTO v_variant FROM public.reference_material_variants WHERE id = p_material_variant_id;
    v_ovr_upper := v_variant.upper_consumption_override;
    v_ovr_lining := v_variant.lining_consumption_override;
    v_ovr_insole := v_variant.insole_consumption_override;
  END IF;

  FOR v_size, v_pairs IN
    SELECT split_part(key, '/', 1)::integer, value::numeric FROM jsonb_each_text(p_grade)
     WHERE key ~ '^[0-9]+(/[0-9]+)?$' AND (value)::numeric > 0
  LOOP
    v_upper  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0);
    v_lining := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole_lining := NULLIF(COALESCE((v_sheet.insole_lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_fachete := NULL;

    IF (v_upper IS NULL OR v_lining IS NULL OR v_insole IS NULL OR v_insole_lining IS NULL OR v_is_fachetado)
       AND (COALESCE(v_sheet.sole_drives_consumption, false) OR v_is_fachetado)
       AND v_sole_product_id IS NOT NULL THEN
      SELECT * INTO v_spec FROM sole_technical_specs WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining := v_spec.lining_consumption_dm2; END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole := v_spec.insole_consumption_dm2; END IF;
        IF v_insole_lining IS NULL AND COALESCE(v_spec.insole_lining_consumption_dm2, 0) > 0 THEN v_insole_lining := v_spec.insole_lining_consumption_dm2; END IF;
        IF v_is_fachetado AND COALESCE(v_spec.fachete_lining_consumption_dm2, 0) > 0 THEN v_fachete := v_spec.fachete_lining_consumption_dm2; END IF;
      END IF;
    END IF;

    -- CONS-1 (contrato da mig 20260518120000, reintroduzido): tamanho SEM valor
    -- por numeração (nem per_size da ficha, nem spec do solado) que cai na média
    -- escalar é marcado — a linha sai com source='fallback_average' +
    -- consumption_warning em vez do rótulo enganoso 'sheet_per_size'.
    -- Override da variante e forro alternativo/suprimido são consumo EXPLÍCITO,
    -- não fallback.
    IF v_upper IS NULL AND COALESCE(v_sheet.upper_consumption, 0) > 0
       AND v_ovr_upper IS NULL THEN
      v_fb_upper := array_append(v_fb_upper, v_size::text);
    END IF;
    IF v_lining IS NULL AND COALESCE(v_sheet.lining_consumption, 0) > 0
       AND v_ovr_lining IS NULL AND NOT v_lining_is_alt AND NOT v_suppress_cabedal_lining THEN
      v_fb_lining := array_append(v_fb_lining, v_size::text);
    END IF;
    IF v_insole IS NULL AND COALESCE(v_sheet.insole_consumption, 0) > 0
       AND v_ovr_insole IS NULL AND NOT v_is_palmilha_pronta THEN
      v_fb_insole := array_append(v_fb_insole, v_size::text);
    END IF;
    IF v_insole_lining IS NULL AND COALESCE(v_sheet.insole_lining_consumption, 0) > 0
       AND NOT v_is_palmilha_pronta THEN
      v_fb_insole_lining := array_append(v_fb_insole_lining, v_size::text);
    END IF;

    v_upper  := COALESCE(v_upper,  v_sheet.upper_consumption,  0);
    v_lining := COALESCE(v_lining, v_sheet.lining_consumption, 0);
    v_insole := COALESCE(v_insole, v_sheet.insole_consumption, 0);
    v_insole_lining := COALESCE(v_insole_lining, v_sheet.insole_lining_consumption, 0);
    IF v_is_fachetado AND v_fachete IS NULL THEN
      v_warn_fachete_sizes := array_append(v_warn_fachete_sizes, v_size);
    END IF;

    IF p_material_variant_id IS NOT NULL THEN
      IF v_variant.upper_consumption_override  IS NOT NULL THEN v_upper  := v_variant.upper_consumption_override;  END IF;
      IF v_variant.lining_consumption_override IS NOT NULL THEN v_lining := v_variant.lining_consumption_override; END IF;
      IF v_variant.insole_consumption_override IS NOT NULL THEN v_insole := v_variant.insole_consumption_override; END IF;
    END IF;

    IF v_lining_is_alt THEN v_lining := COALESCE(v_lining_alt_cons, 0); END IF;

    IF v_suppress_cabedal_lining THEN v_lining := 0; END IF;

    IF v_upper_pid  IS NOT NULL AND v_upper  > 0 THEN
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
    IF NOT v_is_palmilha_pronta AND v_lining_pid IS NOT NULL AND v_insole_lining > 0 THEN
      v_acc_insole_lining := jsonb_set(v_acc_insole_lining, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_insole_lining->>'required')::numeric, 0) + v_insole_lining * v_pairs));
    END IF;
    IF v_is_fachetado AND v_fachete IS NOT NULL AND v_fachete > 0 THEN
      v_acc_fachete := jsonb_set(v_acc_fachete, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_fachete->>'required')::numeric, 0) + v_fachete * v_pairs));
    END IF;

    IF v_sole_product_id IS NOT NULL THEN
      FOR v_std_item IN
        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit
          FROM sole_standard_items_consumption ssic
         WHERE ssic.sole_product_id = v_sole_product_id AND ssic.size = v_size AND ssic.consumption > 0
      LOOP
        v_key := v_std_item.pid::text;
        v_acc_required := COALESCE((v_acc_std #>> ARRAY[v_key,'required'])::numeric, 0) + v_std_item.cons * v_pairs;
        v_acc_std := jsonb_set(v_acc_std, ARRAY[v_key],
          jsonb_build_object('required', v_acc_required, 'unit', v_std_item.unit));
      END LOOP;
    END IF;
  END LOOP;

  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_acc_name,
      'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_total_qty,
      'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_total_qty,
      'debit_mode', 'hard',
      'source', CASE WHEN v_variant_sole_pid IS NOT NULL THEN 'variant_sole' ELSE 'primary_sole' END);
    v_covered_categories  := array_append(v_covered_categories,  'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_upper_pid);
    v_required := ((v_acc_upper->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_result := v_result || jsonb_build_object(
      'component', 'Cabedal', 'product_id', v_upper_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', CASE WHEN v_resolved.matched_by = 'variant' THEN 'variant'
                     WHEN array_length(v_fb_upper, 1) > 0 THEN 'fallback_average'
                     ELSE 'sheet_per_size' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning,
      'consumption_warning', CASE WHEN array_length(v_fb_upper, 1) > 0
        THEN 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_upper, ', ')
        ELSE NULL END);
    v_covered_categories  := array_append(v_covered_categories,  'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

  IF v_lining_pid IS NOT NULL AND COALESCE((v_acc_lining->>'required')::numeric, 0) > 0 THEN
    IF v_lining_is_alt THEN
      SELECT product_id, product_name, available_qty, matched_by
        INTO v_resolved FROM resolve_material_product(v_lining_group, p_color, 0, false);
    ELSE
      SELECT * INTO v_resolved FROM resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
    END IF;
    SELECT * INTO v_conv FROM get_material_conversion_info(v_lining_pid);
    v_required := ((v_acc_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_result := v_result || jsonb_build_object(
      'component', 'Forração', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', CASE WHEN v_lining_is_alt THEN 'lining_alt'
                     WHEN v_resolved.matched_by = 'variant' THEN 'variant'
                     WHEN array_length(v_fb_lining, 1) > 0 THEN 'fallback_average'
                     ELSE 'sheet_per_size' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning,
      'consumption_warning', CASE WHEN NOT v_lining_is_alt AND array_length(v_fb_lining, 1) > 0
        THEN 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_lining, ', ')
        ELSE NULL END);
    v_covered_categories  := array_append(v_covered_categories,  'forro');
    v_covered_categories  := array_append(v_covered_categories,  'forração');
    v_covered_categories  := array_append(v_covered_categories,  'forracao');
    v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
  END IF;

  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0
     AND NOT v_is_palmilha_pronta THEN
    SELECT * INTO v_resolved FROM resolve_insole_material_for_variant(p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_insole_pid);
    v_required := ((v_acc_insole->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_result := v_result || jsonb_build_object(
      'component', 'Palmilha', 'product_id', v_insole_pid, 'product_name', v_resolved.product_name,
      'color', v_palmilha_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', CASE WHEN v_resolved.matched_by = 'variant' THEN 'variant'
                     WHEN array_length(v_fb_insole, 1) > 0 THEN 'fallback_average'
                     ELSE 'sheet_per_size' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning,
      'consumption_warning', CASE WHEN array_length(v_fb_insole, 1) > 0
        THEN 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_insole, ', ')
        ELSE NULL END);
    v_covered_categories  := array_append(v_covered_categories,  'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  IF NOT v_is_palmilha_pronta
     AND v_lining_pid IS NOT NULL
     AND COALESCE(v_sheet.insole_has_lining, true) = true
     AND COALESCE((v_acc_insole_lining->>'required')::numeric, 0) > 0 THEN
    IF v_lining_is_alt THEN
      SELECT product_id, product_name, available_qty, matched_by
        INTO v_resolved FROM resolve_material_product(v_lining_group, p_color, 0, false);
    ELSE
      SELECT * INTO v_resolved FROM resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
    END IF;
    SELECT * INTO v_conv FROM get_material_conversion_info(v_lining_pid);
    v_required := ((v_acc_insole_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_result := v_result || jsonb_build_object(
      'component', 'Forração Palmilha', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', CASE WHEN array_length(v_fb_insole_lining, 1) > 0 THEN 'fallback_average'
                     ELSE 'insole_lining' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning,
      'consumption_warning', CASE WHEN array_length(v_fb_insole_lining, 1) > 0
        THEN 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_insole_lining, ', ')
        ELSE NULL END);
    IF NOT (v_lining_pid = ANY(v_covered_product_ids)) THEN
      v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
    END IF;
  END IF;

  -- CONS-6 (paridade TS): o grupo do fachete vem de
  -- products.fachete_material_group_id do SOLADO (prioridade do motor canônico
  -- orderConsumption.ts); só na falta dele cai no lining_material da ficha.
  v_fachete_group := NULL;
  IF v_is_fachetado AND v_sole_product_id IS NOT NULL THEN
    SELECT pg2.name INTO v_fachete_group
      FROM products p2 JOIN product_groups pg2 ON pg2.id = p2.fachete_material_group_id
     WHERE p2.id = v_sole_product_id;
  END IF;
  v_fachete_group := COALESCE(v_fachete_group, NULLIF(v_sheet.lining_material, ''));

  IF v_is_fachetado
     AND v_fachete_group IS NOT NULL
     AND COALESCE((v_acc_fachete->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_fachete_group, p_color, 0, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := ((v_acc_fachete->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Fachete', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
        'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft', 'source', 'sole_fachete',
        'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
        'consumption_warning', CASE
          WHEN array_length(v_warn_fachete_sizes, 1) > 0
            THEN 'Tamanhos sem consumo de fachete: ' || array_to_string(v_warn_fachete_sizes, ', ')
          ELSE NULL
        END);
    END IF;
  ELSIF v_is_fachetado AND array_length(v_warn_fachete_sizes, 1) > 0 THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Fachete', 'product_id', NULL, 'product_name', COALESCE(v_fachete_group, v_sheet.lining_material, 'forro do fachete'),
      'color', p_color, 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'sole_fachete',
      'consumption_warning', 'Solado fachetado sem fachete_lining_consumption_dm2 nos tamanhos: '
        || array_to_string(v_warn_fachete_sizes, ', '));
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    v_std_unit := (v_acc_std #>> ARRAY[v_key,'unit']);
    SELECT name, quantity, category, unit INTO v_acc_name, v_acc_avail, v_row_cat_norm, v_prod_unit FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_converted := public.convert_to_product_unit(v_acc_required, v_std_unit, v_prod_unit);
      v_result := v_result || jsonb_build_object(
        'component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name,
        'color', '', 'consumption_per_unit', ROUND(COALESCE(v_converted, v_acc_required) / NULLIF(v_total_qty, 0), 4),
        'required', COALESCE(v_converted, v_acc_required), 'available', v_acc_avail,
        'stock_ok', v_acc_avail >= COALESCE(v_converted, v_acc_required),
        'debit_mode', CASE WHEN LOWER(COALESCE(v_row_cat_norm,'')) IN
          ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
        'source', 'sole_standard_per_size',
        'unit', CASE WHEN v_converted IS NOT NULL THEN v_prod_unit ELSE v_std_unit END,
        'conversion_warning', CASE
          WHEN v_converted IS NULL AND v_std_unit IS DISTINCT FROM v_prod_unit
            THEN 'Unidade do item-padrão (' || COALESCE(v_std_unit,'?') || ') incompatível com a unidade do produto (' || COALESCE(v_prod_unit,'?') || ') — quantidade NÃO convertida; cadastre a unidade correta'
          ELSE NULL END);
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  IF COALESCE(v_sheet.component_colors_enabled, false)
     AND p_color IS NOT NULL AND btrim(p_color) <> '' THEN
    FOR v_row IN
      SELECT tcc.product_id AS pid, tcc.quantity_per_unit AS qpu, p.name AS pname,
             GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
             p.category AS category, p.unit AS unit
        FROM technical_sheet_component_colors tcc
        JOIN products p ON p.id = tcc.product_id
       WHERE tcc.sheet_id = p_reference_id
         AND lower(btrim(extensions.unaccent(tcc.cabedal_color))) = lower(btrim(extensions.unaccent(p_color)))
    LOOP
      v_has_color_components := true;
      IF v_row.pid = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
      v_required := COALESCE(v_row.qpu, 0) * v_total_qty;
      IF v_required <= 0 THEN CONTINUE; END IF;
      v_result := v_result || jsonb_build_object(
        'component', 'Componente Direto', 'product_id', v_row.pid, 'product_name', v_row.pname,
        'consumption_per_unit', v_row.qpu, 'required', v_required,
        'available', v_row.available, 'stock_ok', v_row.available >= v_required,
        'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
          ('acessório','embalagem','cola / químico','ferramentas','solado','componente','componentes') THEN 'hard' ELSE 'soft' END,
        'source', 'component_color', 'unit', v_row.unit);
      v_covered_product_ids := array_append(v_covered_product_ids, v_row.pid);
    END LOOP;
  END IF;

  IF NOT v_has_color_components
     AND v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * v_total_qty;
        IF v_required > 0 THEN
          SELECT p.name AS name,
                 GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
                 p.category AS category, p.unit AS unit
            INTO v_row FROM products p WHERE p.id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto', 'product_id', v_pid, 'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric, 'required', v_required,
              'available', v_row.available, 'stock_ok', v_row.available >= v_required,
              'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
                ('acessório','embalagem','cola / químico','ferramentas','solado','componente','componentes') THEN 'hard' ELSE 'soft' END,
              'source', 'direct_components', 'unit', v_row.unit);
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  FOR v_row IN
    -- SQL-1: BOM EFETIVO da variante (get_effective_bom): linha compartilhada
    -- (variant NULL) + override da variante deste item; linha de OUTRA variante
    -- fica fora — paridade com o motor TS e com o débito.
    SELECT sm.product_id, sm.quantity_per_unit, p.name,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
           p.category, p.color AS product_color
      FROM public.get_effective_bom(p_reference_id, p_material_variant_id) sm
      JOIN products p ON p.id = sm.product_id
     WHERE p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories)    THEN CONTINUE; END IF;
    v_required := v_row.quantity_per_unit * v_total_qty;
    SELECT * INTO v_conv FROM get_material_conversion_info(v_row.product_id);
    IF COALESCE(v_conv.dm2_per_unit, 1) > 0 AND COALESCE(v_conv.dm2_per_unit, 1) <> 1 THEN
      v_required := (v_required / v_conv.dm2_per_unit) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    END IF;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color,
      'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
        ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category,
      'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning);
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  IF v_sheet.components_accessories IS NOT NULL AND jsonb_typeof(v_sheet.components_accessories) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.components_accessories) AS value LOOP
      IF COALESCE((v_item ->> 'mandatory')::boolean, false) <> true THEN CONTINUE; END IF;
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * v_total_qty;
      v_pid := NULL;
      BEGIN v_pid := NULLIF(v_item ->> 'product_id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_pid := NULL; END;
      IF v_pid IS NULL THEN
        BEGIN v_pid := NULLIF(v_item ->> 'id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_pid := NULL; END;
      END IF;
      IF v_pid IS NULL AND COALESCE(v_item ->> 'material', '') <> '' THEN
        SELECT product_id INTO v_pid FROM resolve_material_product(v_item ->> 'material', p_color, v_required, false);
      END IF;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        SELECT p.name AS name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))::numeric AS avail
          INTO v_row FROM products p WHERE p.id = v_pid AND p.active = true;
        IF FOUND THEN
          SELECT * INTO v_conv FROM get_material_conversion_info(v_pid);
          v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
          v_result := v_result || jsonb_build_object(
            'component', COALESCE(NULLIF(v_item ->> 'label', ''), 'Componente Extra (cabedal)'),
            'product_id', v_pid, 'product_name', v_row.name, 'color', p_color,
            'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required,
            'available', v_row.avail, 'stock_ok', v_row.avail >= v_required,
            'debit_mode', 'soft', 'source', 'component_accessory', 'unit', v_conv.target_unit,
            'conversion_warning', v_conv.conversion_warning);
          v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$function$;

-- CONS-4: assinatura muda (7º parâmetro) — dropa a sobrecarga antiga pra não
-- criar ambiguidade no PostgREST (duas funções casariam os mesmos args nomeados).
DROP FUNCTION IF EXISTS public.check_stock_availability(uuid, integer, text, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION public.check_stock_availability(p_reference_id uuid, p_order_quantity integer, p_color text DEFAULT ''::text, p_order_grade jsonb DEFAULT NULL::jsonb, p_strap_colors jsonb DEFAULT NULL::jsonb, p_packaging_mode text DEFAULT NULL::text, p_material_variant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_id uuid, product_name text, required numeric, available numeric, sufficient boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conv RECORD;
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
  -- Auditoria 2026-07-01:
  v_sheet RECORD;
  v_grade_valid boolean := false;
  v_cons jsonb;
  v_spec RECORD;
  v_emitted uuid[] := ARRAY[]::uuid[];
  v_caixa_target text;
  v_caixa_types text[];
  v_apply_caixa boolean := false;
  v_resolved RECORD;
  v_sole_pid uuid;
  v_is_palmilha_pronta boolean := false;
  v_palmilha_color text;
  v_lining_total numeric;
  v_strap_label text;
BEGIN
  SELECT * INTO v_sheet FROM public.technical_sheets WHERE id = p_reference_id;

  v_grade_valid := p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object'
    AND EXISTS (
      SELECT 1 FROM jsonb_each_text(p_order_grade) g
      WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND (g.value)::numeric > 0);

  ---------------------------------------------------------------------------
  -- Achado (b): materiais das SPECS da ficha (Cabedal/Forração/Palmilha/
  -- Forração Palmilha/Fachete) entravam só no by_grade/débito, nunca aqui —
  -- NAPA usada em 20 fichas via specs nunca gerava shortage nem auto-OC.
  -- Com grade válida delegamos ao próprio by_grade (paridade por construção:
  -- resolve_*_material_for_variant/resolve_material_product por grupo+cor,
  -- conversão dm²→física, gate de palmilha pronta e waste); somamos por
  -- produto (Forração + Forração Palmilha podem cair no MESMO produto).
  -- Linhas com conversion_warning (largura faltando → valor ~100× em dm²)
  -- NÃO entram — emitir aqui geraria auto-OC 100× inflada; hoje elas já são
  -- invisíveis nesta checagem, então excluí-las não é regressão.
  -- Specs têm PRECEDÊNCIA sobre o BOM (mesma ordem do by_grade): o loop de
  -- BOM abaixo pula produtos já emitidos (anti-join por produto).
  ---------------------------------------------------------------------------
  IF v_sheet.id IS NOT NULL THEN
    IF v_grade_valid THEN
      BEGIN
        -- CONS-4: a variante do item do PV entra na explosão — antes NULL fixo
        -- fazia o badge avaliar o material da FICHA, não o da variante escolhida.
        v_cons := public.calculate_order_consumption_by_grade(
          p_reference_id, p_order_grade, COALESCE(p_color, ''), p_material_variant_id);
      EXCEPTION WHEN OTHERS THEN
        v_cons := NULL;
        RAISE WARNING 'check_stock_availability: by_grade falhou p/ ficha %: %', p_reference_id, SQLERRM;
      END;
      IF v_cons IS NOT NULL AND jsonb_typeof(v_cons) = 'array' THEN
        FOR v_spec IN
          SELECT (l ->> 'product_id')::uuid       AS pid,
                 MAX(l ->> 'product_name')        AS pname,
                 SUM((l ->> 'required')::numeric) AS req
            FROM jsonb_array_elements(v_cons) AS l
           WHERE (l ->> 'component') IN ('Cabedal','Forração','Palmilha','Forração Palmilha','Fachete')
             AND (l ->> 'product_id') IS NOT NULL
             AND (l ->> 'conversion_warning') IS NULL
             AND COALESCE((l ->> 'required')::numeric, 0) > 0
           GROUP BY (l ->> 'product_id')::uuid
        LOOP
          SELECT GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
            INTO v_target_qty FROM public.products p WHERE p.id = v_spec.pid;
          product_id := v_spec.pid; product_name := v_spec.pname;
          required := v_spec.req; available := COALESCE(v_target_qty, 0);
          sufficient := (COALESCE(v_target_qty, 0) >= v_spec.req);
          v_emitted := array_append(v_emitted, v_spec.pid);
          RETURN NEXT;
        END LOOP;
      END IF;
    ELSIF p_order_quantity > 0 THEN
      -- Fallback ESCALAR (sem grade — ex.: badge inline de disponibilidade):
      -- mesmos gates/resolvers do by_grade, consumo escalar da ficha × qty.
      SELECT rsc.sole_product_id INTO v_sole_pid
        FROM public.resolve_sole_color(p_reference_id, COALESCE(p_color, '')) rsc;
      v_is_palmilha_pronta := COALESCE(v_sheet.insole_ready_made, false)
        OR EXISTS (SELECT 1 FROM public.products
                    WHERE id = v_sole_pid AND sole_classification::text = 'palmilha_pronta');

      -- Cabedal
      IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> ''
         AND COALESCE(v_sheet.upper_consumption, 0) > 0 THEN
        SELECT * INTO v_resolved FROM public.resolve_upper_material_for_variant(
          p_material_variant_id, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id);
        IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
          SELECT * INTO v_conv FROM public.get_material_conversion_info(v_resolved.product_id);
          IF v_conv.conversion_warning IS NULL THEN
            v_required := (v_sheet.upper_consumption * p_order_quantity / NULLIF(v_conv.dm2_per_unit, 0))
                          * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
            IF COALESCE(v_required, 0) > 0 THEN
              SELECT GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
                INTO v_target_qty FROM public.products p WHERE p.id = v_resolved.product_id;
              product_id := v_resolved.product_id; product_name := v_resolved.product_name;
              required := v_required; available := COALESCE(v_target_qty, 0);
              sufficient := (COALESCE(v_target_qty, 0) >= v_required);
              v_emitted := array_append(v_emitted, v_resolved.product_id);
              RETURN NEXT;
            END IF;
          END IF;
        END IF;
      END IF;

      -- Forração (+ Forração Palmilha: mesmo produto de forro → SOMA, não
      -- duas linhas comparadas cada uma contra o estoque cheio)
      -- CONS-7: forro do CABEDAL sem gate de insole_has_lining (paridade com o
      -- motor TS); o gate segue valendo só pra parcela da FORRAÇÃO DA PALMILHA.
      IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> '' THEN
        SELECT * INTO v_resolved FROM public.resolve_lining_material_for_variant(
          p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
        IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
          v_lining_total := COALESCE(v_sheet.lining_consumption, 0);
          IF NOT v_is_palmilha_pronta AND COALESCE(v_sheet.insole_has_lining, true) = true THEN
            v_lining_total := v_lining_total + COALESCE(v_sheet.insole_lining_consumption, 0);
          END IF;
          IF v_lining_total > 0 THEN
            SELECT * INTO v_conv FROM public.get_material_conversion_info(v_resolved.product_id);
            IF v_conv.conversion_warning IS NULL THEN
              v_required := (v_lining_total * p_order_quantity / NULLIF(v_conv.dm2_per_unit, 0))
                            * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
              IF COALESCE(v_required, 0) > 0 THEN
                SELECT GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
                  INTO v_target_qty FROM public.products p WHERE p.id = v_resolved.product_id;
                product_id := v_resolved.product_id; product_name := v_resolved.product_name;
                required := v_required; available := COALESCE(v_target_qty, 0);
                sufficient := (COALESCE(v_target_qty, 0) >= v_required);
                v_emitted := array_append(v_emitted, v_resolved.product_id);
                RETURN NEXT;
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;

      -- Palmilha (gate de palmilha pronta, cor via technical_sheet_palmilha_colors)
      IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
         AND NOT v_is_palmilha_pronta AND COALESCE(v_sheet.insole_consumption, 0) > 0 THEN
        v_palmilha_color := p_color;
        IF COALESCE(v_sheet.insole_has_lining, true) = false THEN
          SELECT palmilha_color INTO v_palmilha_color FROM public.technical_sheet_palmilha_colors
           WHERE sheet_id = p_reference_id AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
           ORDER BY (cabedal_color = p_color) DESC LIMIT 1;
          v_palmilha_color := COALESCE(v_palmilha_color, p_color);
        END IF;
        SELECT * INTO v_resolved FROM public.resolve_insole_material_for_variant(
          p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0);
        IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
          SELECT * INTO v_conv FROM public.get_material_conversion_info(v_resolved.product_id);
          IF v_conv.conversion_warning IS NULL THEN
            v_required := (v_sheet.insole_consumption * p_order_quantity / NULLIF(v_conv.dm2_per_unit, 0))
                          * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
            IF COALESCE(v_required, 0) > 0 THEN
              SELECT GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
                INTO v_target_qty FROM public.products p WHERE p.id = v_resolved.product_id;
              product_id := v_resolved.product_id; product_name := v_resolved.product_name;
              required := v_required; available := COALESCE(v_target_qty, 0);
              sufficient := (COALESCE(v_target_qty, 0) >= v_required);
              v_emitted := array_append(v_emitted, v_resolved.product_id);
              RETURN NEXT;
            END IF;
          END IF;
        END IF;
      END IF;
      -- Fachete: consumo só existe por numeração (sole_technical_specs);
      -- sem grade não há como computar — coberto apenas no caminho graduado.
    END IF;
  END IF;

  ---------------------------------------------------------------------------
  -- Achado (c): filtro de caixa por packaging_mode — mesma regra de
  -- filter_caixa_by_packaging_mode (padrão do custeio): só filtra quando o
  -- BOM tem os DOIS tipos de caixa e o alvo do modo está entre eles.
  ---------------------------------------------------------------------------
  IF p_packaging_mode IS NOT NULL THEN
    v_caixa_target := public.packaging_mode_collective_type(p_packaging_mode);
    IF v_caixa_target IS NOT NULL THEN
      SELECT array_agg(DISTINCT s.t) INTO v_caixa_types
      FROM (SELECT public.caixa_collective_type(p.name) AS t
              FROM public.get_effective_bom(p_reference_id, p_material_variant_id) sm
              JOIN public.products p ON p.id = sm.product_id) s
      WHERE s.t IS NOT NULL;
      v_apply_caixa := v_caixa_types IS NOT NULL
        AND array_length(v_caixa_types, 1) >= 2
        AND v_caixa_target = ANY(v_caixa_types);
    END IF;
  END IF;

  FOR mat IN
    -- SQL-1 (paridade): BOM EFETIVO da variante, mesma semântica do by_grade.
    SELECT sm.product_id, sm.quantity_per_unit,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.get_effective_bom(p_reference_id, p_material_variant_id) sm
    JOIN public.products p ON p.id = sm.product_id
  LOOP
    -- Achado (b): anti-join — specs (emitidas acima) têm precedência,
    -- mesma ordem do by_grade (BOM pula produto já coberto).
    IF mat.product_id = ANY(v_emitted) THEN CONTINUE; END IF;

    -- Achado (c): caixa do modo errado sai da checagem (padrão do custeio).
    IF v_apply_caixa AND public.caixa_collective_type(mat.name) IS NOT NULL
       AND public.caixa_collective_type(mat.name) <> v_caixa_target THEN
      CONTINUE;
    END IF;

    -- Achado (a): ESCALAR quantity_per_unit × qty — mesma fórmula do
    -- by_grade/modal/débito. O per-size do sheet_materials (via
    -- calc_required_for_grade) tinha dados em kg/cluster → 5000× (DS12) e
    -- alimentava a OC automática da aprovação do PV.
    v_required := COALESCE(mat.quantity_per_unit, 0) * p_order_quantity;
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

    IF v_target_id = ANY(v_emitted) THEN CONTINUE; END IF;

    -- conv-d1 (auditoria 2026-06-10): material de área em dm²/par → unidade
    -- física do produto-alvo pela largura da ficha de componente (+ perda%).
    SELECT * INTO v_conv FROM public.get_material_conversion_info(v_target_id);
    IF COALESCE(v_conv.dm2_per_unit, 1) > 0 AND COALESCE(v_conv.dm2_per_unit, 1) <> 1 THEN
      v_required := (v_required / v_conv.dm2_per_unit) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    END IF;

    product_id := v_target_id; product_name := v_target_name; required := v_required;
    available := v_target_qty; sufficient := (v_target_qty >= v_required);
    v_emitted := array_append(v_emitted, v_target_id);
    RETURN NEXT;
  END LOOP;

  IF p_strap_colors IS NOT NULL AND jsonb_typeof(p_strap_colors) = 'array'
     AND jsonb_array_length(p_strap_colors) > 0 THEN
    v_effective_straps := p_strap_colors;
  ELSE
    SELECT ts.strap_colors INTO v_sheet_straps
      FROM public.technical_sheets ts WHERE ts.id = p_reference_id;

    IF v_sheet_straps IS NULL OR jsonb_typeof(v_sheet_straps) <> 'array' OR jsonb_array_length(v_sheet_straps) = 0 THEN
      RETURN;
    END IF;

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
    -- Sem grupo não há material rastreável (registro legado/quebrado) → skip.
    IF v_group_id IS NULL THEN CONTINUE; END IF;

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
        v_fichas := (p_order_quantity::numeric / v_grade_total);
      ELSE v_fichas := 1; END IF;
      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      -- Não-graduado: consumption em cm/par → ÷100 p/ metros (unidade do produto-tira).
      v_required := (v_consumption * p_order_quantity) / 100;
    END IF;
    IF v_required <= 0 THEN CONTINUE; END IF;

    -- Achado (d): cor VAZIA era skip silencioso — a tira sumia da checagem
    -- (nem shortage, nem MRP). Agora emite linha de warning no padrão do
    -- 'tira não cadastrada' abaixo (product_id NULL ⇒ o caller mostra a
    -- falta mas NÃO gera auto-OC — quem resolve é o dialog de tiras).
    -- Paridade com order_strap_needs (migration 20260902130000).
    IF v_color IS NULL OR v_color = '' THEN
      v_strap_label := COALESCE(NULLIF(trim(v_strap ->> 'label'), ''), 'Tira');
      product_id := NULL;
      product_name := v_strap_label || ' (sem cor definida no PV)';
      required := v_required; available := 0; sufficient := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_color_norm := lower(trim(extensions.unaccent(v_color)));

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

GRANT EXECUTE ON FUNCTION public.check_stock_availability(uuid, integer, text, jsonb, jsonb, text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_order_consumption(p_order_id uuid, p_reason text DEFAULT 'finalizacao'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_o record;
  v_variant uuid;
  v_strap_colors jsonb;
  v_grade_efetiva jsonb;
  v_cons jsonb;
  v_rows integer := 0;
  v_std_total numeric := 0;
  v_act_total numeric := 0;
  v_reservas_pendentes integer := 0;
  v_avisos text[] := ARRAY[]::text[];
BEGIN
  SELECT id, reference_id, quantity, color, grade, status, sale_order_item_id
    INTO v_o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('record_consumption:' || p_order_id::text));

  UPDATE public.production_consumptions
     SET superseded_at = now(), superseded_reason = p_reason
   WHERE order_id = p_order_id AND superseded_at IS NULL;

  SELECT i.material_variant_id, i.strap_colors INTO v_variant, v_strap_colors
    FROM public.sale_order_items i WHERE i.id = v_o.sale_order_item_id;

  -- Grade EFETIVA: escala grade BASE legada (soma ≈ 12 com quantity real) pro
  -- total da OP — paridade com debit_sole/try_reserve (scale_grade_to_total).
  -- Antes: grade crua ⇒ std ~30-50× subestimado (auditoria 2026-07-19, DEB-3).
  v_grade_efetiva := public.resolve_effective_op_grade(v_o.grade, COALESCE(v_o.quantity, 0)::numeric);

  IF v_o.reference_id IS NOT NULL THEN
    IF v_grade_efetiva IS NOT NULL THEN
      v_cons := public.calculate_order_consumption_by_grade(
        v_o.reference_id, v_grade_efetiva, COALESCE(v_o.color, ''), v_variant);
    ELSE
      v_cons := public.calculate_order_consumption(
        v_o.reference_id, COALESCE(v_o.quantity, 0), COALESCE(v_o.color, ''), NULL::integer, v_variant);
    END IF;
  END IF;
  v_cons := COALESCE(v_cons, '[]'::jsonb);

  WITH std_raw AS (
    SELECT (e->>'product_id')::uuid AS product_id,
           COALESCE(e->>'component', '?') AS component,
           e->>'product_name' AS product_name,
           (e->>'required')::numeric AS required,
           e->>'unit' AS unit
      FROM jsonb_array_elements(v_cons) e
     WHERE (e->>'product_id') IS NOT NULL
       AND COALESCE((e->>'required')::numeric, 0) > 0
  ),
  std_conv AS (
    SELECT s.product_id, s.component, s.product_name,
           COALESCE(
             public.convert_to_product_unit(s.required, s.unit, COALESCE(p.unit, '')),
             CASE WHEN conv.dm2_per_unit IS NOT NULL AND conv.dm2_per_unit > 0
                   AND public.convert_to_product_unit(s.required, s.unit, 'dm²') IS NOT NULL
                  THEN public.convert_to_product_unit(s.required, s.unit, 'dm²') / conv.dm2_per_unit
             END,
             s.required) AS required_prod_unit,
           p.unit_price
      FROM std_raw s
      LEFT JOIN public.products p ON p.id = s.product_id
      LEFT JOIN LATERAL public.get_material_conversion_info(s.product_id) conv ON true
  ),
  std AS (
    SELECT product_id,
           string_agg(DISTINCT component, ' + ') AS component_name,
           max(product_name) AS product_name,
           sum(required_prod_unit) AS std_qty,
           max(unit_price) AS unit_price
      FROM std_conv
     GROUP BY product_id
  ),
  straps AS (
    SELECT sn.product_id, 'Tira'::text AS component_name, sn.product_name,
           sn.required_m AS std_qty, p.unit_price
      FROM public.order_strap_needs(v_strap_colors, COALESCE(v_o.quantity, 0),
             COALESCE(v_grade_efetiva, v_o.grade)) sn
      LEFT JOIN public.products p ON p.id = sn.product_id
     WHERE sn.product_id IS NOT NULL AND sn.required_m > 0
       AND NOT EXISTS (SELECT 1 FROM std WHERE std.product_id = sn.product_id)
  ),
  std_all AS (
    SELECT * FROM std UNION ALL SELECT * FROM straps
  ),
  act AS (
    SELECT sm.product_id,
           sum(sm.quantity) AS act_qty,
           sum(sm.quantity * COALESCE(sm.unit_price_at_movement, p.unit_price, 0)) AS act_cost
      FROM public.stock_movements sm
      LEFT JOIN public.products p ON p.id = sm.product_id
     WHERE sm.order_id = p_order_id AND sm.movement_type = 'out'
       -- DEB-5: débito de embalagem grava stock_movements.product_id = box_types.id
       -- (não é produto). Sem este filtro, o INSERT em production_consumptions
       -- estoura a FK production_consumptions_product_id_fkey e ABORTA a finalização.
       AND EXISTS (SELECT 1 FROM public.products pp WHERE pp.id = sm.product_id)
     GROUP BY sm.product_id
  ),
  merged AS (
    SELECT COALESCE(s.product_id, a.product_id) AS product_id,
           s.component_name,
           COALESCE(s.product_name, pr.name) AS product_name,
           COALESCE(s.std_qty, 0) AS std_qty,
           COALESCE(a.act_qty, 0) AS act_qty,
           COALESCE(s.std_qty, 0) * COALESCE(s.unit_price, pr.unit_price, 0) AS std_cost,
           COALESCE(a.act_cost, 0) AS act_cost
      FROM std_all s
      FULL OUTER JOIN act a ON a.product_id = s.product_id
      LEFT JOIN public.products pr ON pr.id = COALESCE(s.product_id, a.product_id)
  ),
  ins AS (
    INSERT INTO public.production_consumptions
      (order_id, product_id, component_type, component_name,
       standard_quantity, actual_quantity, standard_cost, actual_cost, notes)
    SELECT p_order_id, m.product_id,
           CASE
             WHEN m.component_name = 'Tira' THEN 'strap'
             WHEN m.component_name ~* '(cabedal|forr|palmilha|fachete|solado)' THEN 'spec'
             ELSE 'bom'
           END,
           COALESCE(NULLIF(m.component_name, '?'), m.product_name, 'Movimento sem par no motor'),
           round(m.std_qty, 4), round(m.act_qty, 4),
           round(m.std_cost, 4), round(m.act_cost, 4),
           CASE
             WHEN m.std_qty = 0 THEN 'só movimento (débito sem par no motor de consumo) — ' || p_reason
             WHEN m.act_qty = 0 THEN 'sem débito registrado (possível furo de baixa) — ' || p_reason
             ELSE p_reason
           END
      FROM merged m
     WHERE m.std_qty > 0 OR m.act_qty > 0
    RETURNING standard_cost, actual_cost
  )
  SELECT count(*), COALESCE(sum(standard_cost), 0), COALESCE(sum(actual_cost), 0)
    INTO v_rows, v_std_total, v_act_total FROM ins;

  SELECT count(*) INTO v_reservas_pendentes
    FROM public.material_reservations
   WHERE order_id = p_order_id AND status = 'reserved';
  IF v_reservas_pendentes > 0 THEN
    v_avisos := array_append(v_avisos,
      v_reservas_pendentes || ' reserva(s) ainda em aberto — consumo real pode estar incompleto');
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'linhas', v_rows,
    'standard_total', v_std_total,
    'actual_total', v_act_total,
    'reservas_pendentes', v_reservas_pendentes,
    'avisos', to_jsonb(v_avisos));
END;
$function$;

-- RES-5: reserva órfã = QUALQUER reserva ativa com resíduo em OP terminal —
-- antes só status='reserved' com consumo 0 (perdia partially_consumed e
-- 'reserved' com quantity_consumed > 0). Matriz de status terminal unificada
-- com as triggers de release (RES-6).
CREATE OR REPLACE FUNCTION public.list_orphan_reservations()
 RETURNS TABLE(reservation_id uuid, order_id uuid, order_number text, order_status text, product_id uuid, product_name text, residual numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT mr.id, mr.order_id, o.order_number, o.status, mr.product_id, p.name,
         mr.quantity_reserved - COALESCE(mr.quantity_consumed, 0)
    FROM material_reservations mr
    JOIN orders o ON o.id = mr.order_id
    LEFT JOIN products p ON p.id = mr.product_id
   WHERE mr.status IN ('reserved', 'partially_consumed')
     AND (mr.quantity_reserved - COALESCE(mr.quantity_consumed, 0)) > 0
     AND o.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Cancelado', 'Cancelada', 'Concluído', 'Concluido');
$function$;

CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec RECORD;
  v_current_qty numeric;
  v_stock_grade jsonb;
  v_grade_nonempty boolean;
  v_net_credit numeric;
  v_updated boolean;
  v_pending_sole numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOR v_rec IN
    SELECT
      product_id,
      COALESCE(SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN movement_type = 'in'  THEN quantity ELSE 0 END), 0) AS net_debit
    FROM public.stock_movements
    WHERE order_id = p_order_id
    GROUP BY product_id
  LOOP
    v_net_credit := v_rec.net_debit;
    IF v_net_credit <= 0 THEN CONTINUE; END IF;
    v_updated := false;

    SELECT quantity, stock_grade INTO v_current_qty, v_stock_grade
      FROM public.products WHERE id = v_rec.product_id FOR UPDATE;
    IF FOUND THEN
      v_grade_nonempty := false;
      IF v_stock_grade IS NOT NULL AND jsonb_typeof(v_stock_grade) = 'object' THEN
        SELECT EXISTS (
          SELECT 1 FROM jsonb_each_text(v_stock_grade)
           WHERE left(key, 1) <> '_'
        ) INTO v_grade_nonempty;
      END IF;

      IF v_grade_nonempty THEN
        -- RES-9: produto COM grade não é mais pulado em silêncio. A parte
        -- rastreada por numeração é do restore_sole_grade_for_order (reservas
        -- kind='sole_grade' com effective_grade); aqui estorna só o RESÍDUO
        -- escalar (débitos sem grade, ex.: conversão de componente sobre
        -- produto graduado), sem tocar stock_grade — a numeração fica intacta.
        -- Subtrai o que o restore por grade ainda vai devolver (pendente =
        -- sem marcador sole_restored_at), então funciona chamado antes OU
        -- depois dele; o movimento 'in' gravado re-zera o net em re-runs.
        SELECT COALESCE(SUM(gsum.val), 0) INTO v_pending_sole
          FROM public.material_reservations mr
          CROSS JOIN LATERAL (
            SELECT COALESCE(SUM((e.value)::numeric), 0) AS val
              FROM jsonb_each_text(COALESCE(mr.metadata -> 'effective_grade', '{}'::jsonb)) e
             WHERE e.value ~ '^[0-9]+(\.[0-9]+)?$'
          ) gsum
         WHERE mr.order_id = p_order_id
           AND mr.product_id = v_rec.product_id
           AND (mr.metadata ->> 'kind') = 'sole_grade'
           AND mr.status IN ('consumed', 'converted')
           AND NOT (mr.metadata ? 'sole_restored_at');
        v_net_credit := v_net_credit - COALESCE(v_pending_sole, 0);
        IF v_net_credit > 0 THEN
          UPDATE public.products
             SET quantity = v_current_qty + v_net_credit, updated_at = now()
           WHERE id = v_rec.product_id;
          INSERT INTO public.stock_movements (
            product_id, movement_type, quantity, previous_stock, new_stock,
            description, order_id
          ) VALUES (
            v_rec.product_id, 'in', v_net_credit, v_current_qty,
            v_current_qty + v_net_credit,
            'Estorno de débitos da OP (restore — resíduo escalar de produto com grade; numeração intacta)', p_order_id
          );
        END IF;
        v_updated := true;
      ELSE
        UPDATE public.products
           SET quantity = v_current_qty + v_net_credit, updated_at = now()
         WHERE id = v_rec.product_id;
        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, order_id
        ) VALUES (
          v_rec.product_id, 'in', v_net_credit, v_current_qty,
          v_current_qty + v_net_credit,
          'Estorno de débitos da OP (restore)', p_order_id
        );
        v_updated := true;
      END IF;
    END IF;

    IF NOT v_updated THEN
      SELECT quantity INTO v_current_qty
        FROM public.box_types WHERE id = v_rec.product_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.box_types
           SET quantity = v_current_qty + v_net_credit, updated_at = now()
         WHERE id = v_rec.product_id;
        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, order_id
        ) VALUES (
          v_rec.product_id, 'in', v_net_credit, v_current_qty,
          v_current_qty + v_net_credit,
          'Estorno de débitos da OP (restore — caixa)', p_order_id
        );
        v_updated := true;
      END IF;
    END IF;
  END LOOP;
END;
$function$;

-- CONS-5: sobrecargas 4-arg MORTAS e divergentes (não conhecem o pin da ficha,
-- 5º argumento) — nenhum caller em funções SQL, views ou src/. Dropar evita que
-- um caller futuro resolva silenciosamente pra versão sem pin.
DROP FUNCTION IF EXISTS public.resolve_upper_material_for_variant(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.resolve_upper_material_for_variant(uuid, text, text, numeric);
DROP FUNCTION IF EXISTS public.resolve_lining_material_for_variant(uuid, text, text, numeric);

-- CONS-8: tg_guard_implausible_consumption só cobria technical_sheets;
-- sole_technical_specs (fonte do forro/palmilha/fachete por numeração) entrava
-- sem teto. Mesmo teto de 50 dm²/par (dado vivo 2026-07-19: máximo real 6,85).
CREATE OR REPLACE FUNCTION public.tg_guard_implausible_sole_spec()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_max   constant numeric := 50;
  v_field text := NULL;
  v_val   numeric := NULL;
BEGIN
  IF    COALESCE(NEW.lining_consumption_dm2, 0)         > v_max THEN v_field := 'lining_consumption_dm2';         v_val := NEW.lining_consumption_dm2;
  ELSIF COALESCE(NEW.insole_consumption_dm2, 0)         > v_max THEN v_field := 'insole_consumption_dm2';         v_val := NEW.insole_consumption_dm2;
  ELSIF COALESCE(NEW.insole_lining_consumption_dm2, 0)  > v_max THEN v_field := 'insole_lining_consumption_dm2';  v_val := NEW.insole_lining_consumption_dm2;
  ELSIF COALESCE(NEW.fachete_lining_consumption_dm2, 0) > v_max THEN v_field := 'fachete_lining_consumption_dm2'; v_val := NEW.fachete_lining_consumption_dm2;
  END IF;

  IF v_field IS NOT NULL THEN
    RAISE EXCEPTION
      'Consumo implausível: sole_technical_specs.% = % dm2/par (size %) excede o teto de % dm2/par. Consumo real por numeração fica ~2 a 10 dm2/par - confira unidade e digitação.',
      v_field, v_val, NEW.size, v_max
      USING ERRCODE = 'check_violation',
            HINT = 'Se for realmente intencional, ajuste o teto em tg_guard_implausible_sole_spec.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_guard_implausible_sole_spec ON public.sole_technical_specs;
CREATE TRIGGER tg_guard_implausible_sole_spec
  BEFORE INSERT OR UPDATE ON public.sole_technical_specs
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_implausible_sole_spec();

-- RES-6: as duas triggers de release divergiam — 'Faturado'/'FINALIZADO' (só na
-- 1ª) não liberavam partially_consumed nem 'reserved' com consumo parcial; a 2ª
-- (zz) não conhecia 'Faturado'/'FINALIZADO'. Matriz ÚNICA nas duas:
-- terminal = {Finalizado, FINALIZADO, Faturado, Cancelado, Cancelada, Concluído,
-- Concluido}; libera resíduo de status IN (reserved, partially_consumed).
CREATE OR REPLACE FUNCTION public.tg_release_reservations_on_order_terminal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r RECORD;
BEGIN
  IF NEW.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Cancelado', 'Cancelada', 'Concluído', 'Concluido')
     AND COALESCE(OLD.status, '') IS DISTINCT FROM NEW.status THEN
    FOR r IN
      UPDATE public.material_reservations
         SET status = 'cancelled',
             notes = COALESCE(NULLIF(notes, ''), '')
                     || ' [auto-liberada: OP -> ' || NEW.status || ']',
             updated_at = now()
       WHERE order_id = NEW.id
         AND status IN ('reserved', 'partially_consumed')
      RETURNING product_id
    LOOP
      PERFORM public.sync_product_reserved_stock(r.product_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_release_reservations_on_op_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r RECORD;
BEGIN
  -- Matriz unificada com tg_release_reservations_on_order_terminal (RES-6) —
  -- inclui 'Faturado'/'FINALIZADO', que antes só a outra trigger conhecia.
  IF NEW.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Cancelado', 'Cancelada', 'Concluído', 'Concluido')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    FOR r IN
      UPDATE public.material_reservations
         SET status     = 'cancelled',
             notes      = COALESCE(NULLIF(notes, ''), '')
                          || ' [auto-liberada: OP -> ' || NEW.status || ']',
             updated_at = now()
       WHERE order_id = NEW.id
         AND status IN ('reserved', 'partially_consumed')
      RETURNING product_id
    LOOP
      PERFORM public.sync_product_reserved_stock(r.product_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_zz_release_reservations_on_op_cancel ON public.orders;
CREATE TRIGGER trg_zz_release_reservations_on_op_cancel
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (new.status = ANY (ARRAY['Finalizado'::text, 'FINALIZADO'::text, 'Faturado'::text, 'Cancelado'::text, 'Cancelada'::text, 'Concluído'::text, 'Concluido'::text])
        AND new.status IS DISTINCT FROM old.status)
  EXECUTE FUNCTION public.auto_release_reservations_on_op_cancel();

CREATE OR REPLACE FUNCTION public.confirm_picking_reservation(p_reservation_id uuid, p_picked_by text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res RECORD;
  v_current_qty numeric;
BEGIN
  -- RES-8: era o ÚNICO RPC do ciclo de reserva sem gate de usuário aprovado.
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Lock pessimista na reserva ANTES de validar status. Sem isso, duas
  -- requisições simultâneas podem ambas ler 'reserved' e debitar duas vezes.
  SELECT * INTO v_res
    FROM material_reservations
   WHERE id = p_reservation_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva não encontrada';
  END IF;

  IF v_res.status <> 'reserved' THEN
    RAISE EXCEPTION 'Reserva já consumida ou cancelada (status atual: %)', v_res.status;
  END IF;

  -- RES-8: reserva de SOLADO por numeração não pode ser confirmada pelo picking
  -- escalar — debitaria products.quantity sem baixar o stock_grade (numeração
  -- ficaria inflada). O caminho certo é o débito por grade
  -- (convert_reservation_to_out / debit_sole_stock_by_grade).
  IF COALESCE(v_res.metadata ->> 'kind', '') IN ('sole_grade', 'sole_pending_grade') THEN
    RAISE EXCEPTION 'Reserva de solado por numeração (kind=%) — use o débito por grade, não o picking escalar', v_res.metadata ->> 'kind';
  END IF;

  SELECT quantity INTO v_current_qty
    FROM products
   WHERE id = v_res.product_id
     FOR UPDATE;

  IF v_current_qty < v_res.quantity_reserved THEN
    RAISE EXCEPTION 'Estoque insuficiente para confirmar picking: disponivel %, necessario %', v_current_qty, v_res.quantity_reserved;
  END IF;

  UPDATE products
     SET quantity = quantity - v_res.quantity_reserved,
         updated_at = now()
   WHERE id = v_res.product_id;

  INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
  VALUES (v_res.product_id, 'out', v_res.quantity_reserved, v_current_qty, v_current_qty - v_res.quantity_reserved,
          'Debito Picking Confirmado', v_res.order_id);

  UPDATE material_reservations
     SET status = 'consumed',
         quantity_consumed = quantity_reserved,
         consumed_at = now(),
         reservation_type = 'hard',
         updated_at = now()
   WHERE id = p_reservation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_debit_guard_tests()
 RETURNS TABLE(case_name text, ok boolean, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_def text;
  v_grade jsonb;
  v_sum numeric;
BEGIN
  v_grade := public.resolve_effective_op_grade('{"35":6,"36":6}'::jsonb, 360);
  SELECT COALESCE(sum(value::numeric), 0) INTO v_sum FROM jsonb_each_text(v_grade);
  RETURN QUERY SELECT 'G1 resolve_effective_op_grade escala grade base pro total'::text,
    (v_sum = 360), 'soma=' || v_sum::text;

  RETURN QUERY SELECT 'G2 resolve_effective_op_grade rejeita grade vazia/inválida'::text,
    (public.resolve_effective_op_grade('{}'::jsonb, 360) IS NULL
     AND public.resolve_effective_op_grade(NULL, 360) IS NULL
     AND public.resolve_effective_op_grade('{"x":"1"}'::jsonb, 360) IS NULL), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_order_consumption';
  RETURN QUERY SELECT 'G3 record_order_consumption escala grade base (DEB-3)'::text,
    (v_def LIKE '%resolve_effective_op_grade%'), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'convert_reservation_to_out';
  RETURN QUERY SELECT 'G4 convert_reservation_to_out: consumed = debitado real (DEB-1)'::text,
    (v_def NOT LIKE '%quantity_consumed = COALESCE(quantity_reserved%'
     AND v_def LIKE '%Componente sem estoque na conversão%'), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'hybrid_debit_stock_for_order';
  RETURN QUERY SELECT 'G5 hybrid_debit adia variant_sole pro débito por grade (DEB-2)'::text,
    (v_def LIKE '%variant_sole%'), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'debit_sole_stock_by_grade';
  RETURN QUERY SELECT 'G6 debit_sole: advisory lock + idempotência de retry (RES-7)'::text,
    (v_def LIKE '%debit_sole:%' AND v_def LIKE '%Debito Solado por grade!%%' ESCAPE '!'), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'tg_sync_orders_from_sale_order_item';
  RETURN QUERY SELECT 'G7 tg_sync_item: falha de reserva vira erro_reserva visível (AUD-1)'::text,
    (v_def LIKE '%erro_reserva%'), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'tg_debit_service_order_base';
  RETURN QUERY SELECT 'G8 tg_debit_service_order_base: débito clampado + [os:id] (DEB-6)'::text,
    (v_def LIKE '%[os:%'), NULL::text;

  RETURN QUERY SELECT 'G9 release de reservas roda após record_order_consumption (RES-3)'::text,
    (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_zz_release_reservations_on_op_cancel' AND tgrelid = 'public.orders'::regclass)
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auto_release_reservations_on_op_cancel' AND tgrelid = 'public.orders'::regclass)), NULL::text;

  RETURN QUERY SELECT 'G10 debit_consistency_report() existe (R8 da spec)'::text,
    (EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'debit_consistency_report')), NULL::text;

  -- ==== Pendências aplicadas em 2026-07-19 (seção 3 da auditoria) ====

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_order_consumption_by_grade';
  RETURN QUERY SELECT 'G11 by_grade marca fallback_average + consumption_warning (CONS-1)'::text,
    (v_def LIKE '%fallback_average%' AND v_def LIKE '%consumption_warning%'), NULL::text;

  RETURN QUERY SELECT 'G12 check_stock_availability recebe variante (CONS-4)'::text,
    (EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'check_stock_availability'
                AND pg_get_function_identity_arguments(p.oid) LIKE '%p_material_variant_id%')
     AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'check_stock_availability') = 1), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_order_consumption';
  RETURN QUERY SELECT 'G13 record_order_consumption ignora movimento de box_types (DEB-5)'::text,
    (v_def LIKE '%pp.id = sm.product_id%'), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'list_orphan_reservations';
  RETURN QUERY SELECT 'G14 list_orphan_reservations enxerga partially_consumed/resíduo (RES-5)'::text,
    (v_def LIKE '%partially_consumed%' AND v_def LIKE '%> 0%'), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'restore_product_stocks_for_order';
  RETURN QUERY SELECT 'G15 restore estorna resíduo de produto com grade (RES-9)'::text,
    (v_def LIKE '%sole_restored_at%' AND v_def LIKE '%resíduo escalar%'), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_order_consumption_by_grade';
  RETURN QUERY SELECT 'G16 by_grade usa get_effective_bom (SQL-1)'::text,
    (v_def LIKE '%get_effective_bom%'), NULL::text;

  RETURN QUERY SELECT 'G17 sobrecargas 4-arg dos resolvers dropadas (CONS-5)'::text,
    (NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public'
                    AND p.proname IN ('resolve_upper_material_for_variant', 'resolve_lining_material_for_variant')
                    AND p.pronargs = 4)), NULL::text;

  RETURN QUERY SELECT 'G18 fachete resolve por fachete_material_group_id (CONS-6)'::text,
    (v_def LIKE '%fachete_material_group_id%'), NULL::text;

  RETURN QUERY SELECT 'G19 forro do cabedal sem gate de insole_has_lining (CONS-7)'::text,
    (v_def LIKE '%CONS-7%'
     AND (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'check_stock_availability') LIKE '%CONS-7%'), NULL::text;

  RETURN QUERY SELECT 'G20 guard implausível cobre sole_technical_specs (CONS-8)'::text,
    (EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname = 'tg_guard_implausible_sole_spec'
                AND tgrelid = 'public.sole_technical_specs'::regclass)), NULL::text;

  RETURN QUERY SELECT 'G21 matriz de release unificada nas 2 triggers (RES-6)'::text,
    ((SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'tg_release_reservations_on_order_terminal') LIKE '%partially_consumed%'
     AND (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'auto_release_reservations_on_op_cancel') LIKE '%Faturado%'), NULL::text;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'confirm_picking_reservation';
  RETURN QUERY SELECT 'G22 confirm_picking: is_approved_user + rejeita sole_grade (RES-8)'::text,
    (v_def LIKE '%is_approved_user%' AND v_def LIKE '%sole_pending_grade%'), NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_consumption_integration_tests()
 RETURNS TABLE(case_name text, ok boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet_id   uuid := '11111111-1111-1111-1111-111111111111';
  v_sole_id    uuid := '22222222-2222-2222-2222-222222222222';
  v_napa_id    uuid := '33333333-3333-3333-3333-333333333333';
  v_forro_id   uuid := '44444444-4444-4444-4444-444444444444';
  v_palm_id    uuid := '55555555-5555-5555-5555-555555555555';
  v_grp_napa   uuid := '66666666-6666-6666-6666-666666666661';
  v_grp_forro  uuid := '66666666-6666-6666-6666-666666666662';
  v_grp_palm   uuid := '66666666-6666-6666-6666-666666666663';
  v_grp_sole   uuid := '66666666-6666-6666-6666-666666666664';
  v_result     jsonb;
  v_src        text;
  v_val        numeric;
  v_warn       text;
BEGIN
  DELETE FROM sheet_materials       WHERE sheet_id = v_sheet_id;
  DELETE FROM sole_technical_specs  WHERE sole_id  = v_sole_id;
  DELETE FROM technical_sheets      WHERE id       = v_sheet_id;
  DELETE FROM products              WHERE id IN (v_sole_id, v_napa_id, v_forro_id, v_palm_id);
  DELETE FROM product_groups        WHERE id IN (v_grp_napa, v_grp_forro, v_grp_palm, v_grp_sole);

  INSERT INTO product_groups (id, name, sector) VALUES
    (v_grp_sole,  'TEST_SOLADO_X',  'Solado'),
    (v_grp_napa,  'TEST_NAPA',      'Cabedal'),
    (v_grp_forro, 'TEST_FORRO',     'Forração da Palmilha'),
    (v_grp_palm,  'TEST_PALMILHA',  'Palmilha');

  INSERT INTO products (id, sku, name, category, color, quantity, active, unit, group_id) VALUES
    (v_sole_id,  'TEST-SOLADO-X', 'TEST_SOLADO_X', 'solado',   'Caramelo', 1000, true, 'PAR', v_grp_sole),
    (v_napa_id,  'TEST-NAPA',     'TEST_NAPA',     'cabedal',  'Caramelo', 5000, true, 'DM2', v_grp_napa),
    (v_forro_id, 'TEST-FORRO',    'TEST_FORRO',    'forro',    'Caramelo', 5000, true, 'DM2', v_grp_forro),
    (v_palm_id,  'TEST-PALMILHA', 'TEST_PALMILHA', 'palmilha', 'Caramelo', 5000, true, 'DM2', v_grp_palm);

  INSERT INTO technical_sheets (
    id, name, status, reference_size,
    upper_material,  upper_consumption,  upper_consumption_per_size,
    lining_material, lining_consumption, lining_consumption_per_size,
    insole_material, insole_consumption, insole_consumption_per_size,
    sole_drives_consumption, primary_sole_id
  ) VALUES (
    v_sheet_id, 'TEST_FICHA_HIERARQUIA', 'ativo', 37,
    'TEST_NAPA',     9.00, '{"37": 9.29}'::jsonb,
    'TEST_FORRO',    5.50, '{"37": 5.70}'::jsonb,
    'TEST_PALMILHA', 4.00, '{"37": 4.16}'::jsonb,
    true, v_sole_id
  );

  INSERT INTO sole_technical_specs (sole_id, size, lining_consumption_dm2, insole_consumption_dm2)
  VALUES (v_sole_id, 38, 6.10, 4.50);

  -- CASO 1 — size=37 → per-size; valor por par esperado = consumo × 1.08 (waste padrão)
  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', 37);
  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Cabedal' LIMIT 1;
  RETURN QUERY SELECT 'CASO 1 (size=37) Cabedal source'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forração' LIMIT 1;
  RETURN QUERY SELECT 'CASO 1 (size=37) Forro source'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Palmilha' LIMIT 1;
  RETURN QUERY SELECT 'CASO 1 (size=37) Palmilha source'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  -- CASO 1b — valida valor numérico do per-size (9.29 cru; waste default = 0,
  -- paridade com o motor TS — só ficha de componente com waste_pct aplica perda)
  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Cabedal' LIMIT 1;
  RETURN QUERY SELECT 'CASO 1b Cabedal valor ≈ 9.29 (sem waste default)'::text,
    v_val BETWEEN 9.25 AND 9.33, format('valor=%s', v_val);

  -- CASO 2 — size=38 → forro/palmilha de sole_spec (valores crus; waste default 0)
  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', 38);
  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forração' LIMIT 1;
  RETURN QUERY SELECT 'CASO 2 (size=38) Forro ≈ sole_spec(6.10)'::text,
    v_val BETWEEN 6.05 AND 6.15, format('valor=%s', v_val);

  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Palmilha' LIMIT 1;
  RETURN QUERY SELECT 'CASO 2 (size=38) Palmilha ≈ sole_spec(4.50)'::text,
    v_val BETWEEN 4.45 AND 4.55, format('valor=%s', v_val);

  -- CASO 3 — size=99 → escalar cru (5.50; waste default 0)
  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', 99);
  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forração' LIMIT 1;
  RETURN QUERY SELECT 'CASO 3 (size=99) Forro ≈ escalar(5.50)'::text,
    v_val BETWEEN 5.45 AND 5.55, format('valor=%s', v_val);

  -- CASO 3b (CONS-1) — size=99 cai na média escalar → source='fallback_average'
  -- + consumption_warning presente (contrato da mig 20260518120000, reintroduzido)
  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forração' LIMIT 1;
  RETURN QUERY SELECT 'CASO 3b (size=99) Forro source=fallback_average'::text,
    v_src = 'fallback_average', format('source=%s', v_src);

  SELECT (e->>'consumption_warning') INTO v_warn FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forração' LIMIT 1;
  RETURN QUERY SELECT 'CASO 3c (size=99) Forro consumption_warning presente'::text,
    v_warn IS NOT NULL AND v_warn LIKE '%99%', format('warning=%s', v_warn);

  -- CASO 2c (CONS-1) — size=38 vem do sole_spec (per-size) → NÃO é fallback
  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', 38);
  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forração' LIMIT 1;
  RETURN QUERY SELECT 'CASO 2c (size=38) Forro do sole_spec NÃO é fallback'::text,
    v_src = 'sheet_per_size', format('source=%s', v_src);

  -- CASO 4 — size=NULL → reference_size=37
  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', NULL);
  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Cabedal' LIMIT 1;
  RETURN QUERY SELECT 'CASO 4 (size=NULL) usa reference_size=37'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  -- CASO 5 — color=""
  v_result := calculate_order_consumption(v_sheet_id, 10, '', 37);
  RETURN QUERY SELECT 'CASO 5 (color="") retorna array JSONB'::text,
    v_result IS NOT NULL AND jsonb_typeof(v_result) = 'array', format('typeof=%s', jsonb_typeof(v_result));

  -- CASO 6 — qty=100 escala linearmente (9.29 × 100 = 929; waste default 0)
  v_result := calculate_order_consumption(v_sheet_id, 100, 'Caramelo', 37);
  SELECT (e->>'required')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Cabedal' LIMIT 1;
  RETURN QUERY SELECT 'CASO 6 (qty=100) required ≈ 9.29 × 100'::text,
    v_val BETWEEN 925 AND 935, format('required=%s', v_val);

  DELETE FROM sheet_materials       WHERE sheet_id = v_sheet_id;
  DELETE FROM sole_technical_specs  WHERE sole_id  = v_sole_id;
  DELETE FROM technical_sheets      WHERE id       = v_sheet_id;
  DELETE FROM products              WHERE id IN (v_sole_id, v_napa_id, v_forro_id, v_palm_id);
  DELETE FROM product_groups        WHERE id IN (v_grp_napa, v_grp_forro, v_grp_palm, v_grp_sole);

EXCEPTION WHEN OTHERS THEN
  DELETE FROM sheet_materials       WHERE sheet_id = v_sheet_id;
  DELETE FROM sole_technical_specs  WHERE sole_id  = v_sole_id;
  DELETE FROM technical_sheets      WHERE id       = v_sheet_id;
  DELETE FROM products              WHERE id IN (v_sole_id, v_napa_id, v_forro_id, v_palm_id);
  DELETE FROM product_groups        WHERE id IN (v_grp_napa, v_grp_forro, v_grp_palm, v_grp_sole);
  RAISE;
END;
$function$;

-- ============================================================================
-- Verificação final embutida: os guards novos precisam passar já na aplicação.
DO $$
DECLARE v_fail integer;
BEGIN
  SELECT count(*) INTO v_fail FROM public.run_debit_guard_tests() t WHERE NOT t.ok;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'run_debit_guard_tests: % guard(s) falharam após a migration', v_fail;
  END IF;
END $$;
