-- =============================================================================
-- Fix calculate_order_consumption_by_grade:
--   1) Adiciona componente "Fachete" (faltava na função by-grade — só existia
--      na single-size). Solados fachetados em PV com grade NÃO debitavam o
--      forro extra do fachete.
--   2) Marca explicitamente quando o cálculo caiu no FALLBACK ESCALAR
--      (média da ficha) através do campo `source` no resultado:
--        - 'sheet_per_size'     → valor veio de technical_sheets.*_per_size
--        - 'sole_spec_per_size' → valor veio de sole_technical_specs (per size)
--        - 'fallback_average'   → caiu na média escalar (UI deve alertar)
--      Quando QUALQUER tamanho da grade caiu no fallback escalar, anexa
--      `consumption_warning` com a lista de tamanhos faltantes.
--
-- Não muda o pipeline de conversão (dm² → unidade final) nem o waste_pct.
-- Mantém assinatura (uuid, jsonb, text, uuid) introduzida em
-- 20260510170000_consumption-with-material-variant.sql.
-- =============================================================================

DROP FUNCTION IF EXISTS public.calculate_order_consumption_by_grade(uuid, jsonb, text, uuid);

CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(
  p_reference_id        uuid,
  p_grade               jsonb,
  p_color               text,
  p_material_variant_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sheet              RECORD;
  v_sole_product_id    uuid;
  v_sole_color         text;
  v_total_qty          numeric := 0;
  v_size               integer;
  v_pairs              numeric;
  v_spec               RECORD;
  v_upper              numeric;
  v_lining             numeric;
  v_insole             numeric;
  v_fachete            numeric;
  v_resolved           RECORD;
  v_conv               RECORD;
  v_row                RECORD;
  v_item               jsonb;
  v_consumption        numeric;
  v_required           numeric;
  v_group_name         text;
  v_covered_categories text[]   := ARRAY[]::text[];
  v_covered_product_ids uuid[]  := ARRAY[]::uuid[];
  v_row_cat_norm       text;
  v_acc_upper          jsonb    := '{}'::jsonb;
  v_acc_lining         jsonb    := '{}'::jsonb;
  v_acc_insole         jsonb    := '{}'::jsonb;
  v_acc_fachete        jsonb    := '{}'::jsonb;
  v_acc_std            jsonb    := '{}'::jsonb;
  v_result             jsonb    := '[]'::jsonb;
  v_upper_pid          uuid;
  v_lining_pid         uuid;
  v_insole_pid         uuid;
  v_std_item           RECORD;
  v_key                text;
  v_acc_required       numeric;
  v_acc_avail          numeric;
  v_acc_name           text;
  v_palmilha_color     text;
  v_is_fachetado       boolean := false;
  v_upper_source       text;
  v_lining_source      text;
  v_insole_source      text;
  v_warn_upper_sizes   integer[] := ARRAY[]::integer[];
  v_warn_lining_sizes  integer[] := ARRAY[]::integer[];
  v_warn_insole_sizes  integer[] := ARRAY[]::integer[];
  v_warn_fachete_sizes integer[] := ARRAY[]::integer[];
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

  IF v_sole_product_id IS NOT NULL THEN
    SELECT COALESCE(is_fachetado, false) INTO v_is_fachetado
      FROM products WHERE id = v_sole_product_id;
  END IF;

  -- ── Resolve products once ──────────────────────────────────────
  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> '' THEN
    SELECT * INTO v_resolved
      FROM resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, 0);
    v_upper_pid := v_resolved.product_id;
  END IF;

  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND COALESCE(v_sheet.insole_has_lining, true) = true THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    v_lining_pid := v_resolved.product_id;
  END IF;

  v_palmilha_color := p_color;
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '' THEN
    IF COALESCE(v_sheet.insole_has_lining, true) = false THEN
      SELECT palmilha_color INTO v_palmilha_color
      FROM technical_sheet_palmilha_colors
      WHERE sheet_id = p_reference_id
        AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
      ORDER BY (cabedal_color = p_color) DESC
      LIMIT 1;
      v_palmilha_color := COALESCE(v_palmilha_color, p_color);
    END IF;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, v_palmilha_color, 0, false);
    v_insole_pid := v_resolved.product_id;
  END IF;

  -- ── Per-size accumulation loop ─────────────────────────────────
  FOR v_size, v_pairs IN
    SELECT key::integer, value::numeric
      FROM jsonb_each_text(p_grade)
     WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0
  LOOP
    -- ── Cabedal / Forro / Palmilha (per-size, com tracking de fonte) ──
    v_upper := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0);
    IF v_upper IS NOT NULL THEN
      v_upper_source := 'sheet_per_size';
    END IF;

    v_lining := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    IF v_lining IS NOT NULL THEN
      v_lining_source := 'sheet_per_size';
    END IF;

    v_insole := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    IF v_insole IS NOT NULL THEN
      v_insole_source := 'sheet_per_size';
    END IF;

    v_fachete := NULL;

    -- Fallback 1: sole_technical_specs (per-size) ─ aplicado quando
    -- sole_drives_consumption=true OU é fachetado (fachete só fica lá).
    IF v_sole_product_id IS NOT NULL
       AND (COALESCE(v_sheet.sole_drives_consumption, false) OR v_is_fachetado)
    THEN
      SELECT * INTO v_spec FROM sole_technical_specs
       WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_upper  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN
          v_upper := v_spec.upper_consumption_dm2;
          v_upper_source := 'sole_spec_per_size';
        END IF;
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN
          v_lining := v_spec.lining_consumption_dm2;
          v_lining_source := 'sole_spec_per_size';
        END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN
          v_insole := v_spec.insole_consumption_dm2;
          v_insole_source := 'sole_spec_per_size';
        END IF;
        IF v_is_fachetado AND COALESCE(v_spec.fachete_lining_consumption_dm2, 0) > 0 THEN
          v_fachete := v_spec.fachete_lining_consumption_dm2;
        END IF;
      END IF;
    END IF;

    -- Fallback 2: média escalar da ficha (alertar UI)
    IF v_upper IS NULL THEN
      v_upper := COALESCE(v_sheet.upper_consumption,  0);
      IF v_upper > 0 THEN
        v_upper_source := 'fallback_average';
        v_warn_upper_sizes := array_append(v_warn_upper_sizes, v_size);
      END IF;
    END IF;
    IF v_lining IS NULL THEN
      v_lining := COALESCE(v_sheet.lining_consumption, 0);
      IF v_lining > 0 THEN
        v_lining_source := 'fallback_average';
        v_warn_lining_sizes := array_append(v_warn_lining_sizes, v_size);
      END IF;
    END IF;
    IF v_insole IS NULL THEN
      v_insole := COALESCE(v_sheet.insole_consumption, 0);
      IF v_insole > 0 THEN
        v_insole_source := 'fallback_average';
        v_warn_insole_sizes := array_append(v_warn_insole_sizes, v_size);
      END IF;
    END IF;
    -- Fachete não tem fallback escalar (não existe campo médio na ficha).
    -- Se solado é fachetado e o tamanho não tem valor, registramos warning.
    IF v_is_fachetado AND v_fachete IS NULL THEN
      v_warn_fachete_sizes := array_append(v_warn_fachete_sizes, v_size);
    END IF;

    -- Acumular
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
    -- Fachete consome o MESMO grupo de material do forro (sheet.lining_material)
    IF v_is_fachetado AND v_fachete IS NOT NULL AND v_fachete > 0 THEN
      v_acc_fachete := jsonb_set(v_acc_fachete, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_fachete->>'required')::numeric, 0) + v_fachete * v_pairs));
    END IF;

    -- Standard sole items (por tamanho)
    IF v_sole_product_id IS NOT NULL THEN
      FOR v_std_item IN
        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit
          FROM sole_standard_items_consumption ssic
         WHERE ssic.sole_product_id = v_sole_product_id
           AND ssic.size = v_size AND ssic.consumption > 0
      LOOP
        v_key := v_std_item.pid::text;
        v_acc_required := COALESCE((v_acc_std #>> ARRAY[v_key,'required'])::numeric, 0)
                         + v_std_item.cons * v_pairs;
        v_acc_std := jsonb_set(v_acc_std, ARRAY[v_key],
          jsonb_build_object('required', v_acc_required, 'unit', v_std_item.unit));
      END LOOP;
    END IF;
  END LOOP;

  -- ── Emit results ───────────────────────────────────────────────

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_acc_name,
      'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_total_qty,
      'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_total_qty,
      'debit_mode', 'hard', 'source', 'primary_sole');
    v_covered_categories  := array_append(v_covered_categories,  'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  -- Cabedal
  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved
      FROM resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, 0);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_upper_pid);
    v_required := ((v_acc_upper->>'required')::numeric
                  / NULLIF(v_conv.dm2_per_unit, 0))
                  * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_result := v_result || jsonb_build_object(
      'component', 'Cabedal', 'product_id', v_upper_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft',
      'source', COALESCE(v_upper_source, 'fallback_average'),
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'consumption_warning', CASE
        WHEN array_length(v_warn_upper_sizes, 1) > 0
          THEN 'Tamanhos sem consumo per-size, usando média: ' ||
               array_to_string(v_warn_upper_sizes, ', ')
        ELSE NULL
      END);
    v_covered_categories  := array_append(v_covered_categories,  'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

  -- Forro
  IF v_lining_pid IS NOT NULL AND COALESCE((v_acc_lining->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    SELECT * INTO v_conv     FROM get_material_conversion_info(v_lining_pid);
    v_required := ((v_acc_lining->>'required')::numeric
                  / NULLIF(v_conv.dm2_per_unit, 0))
                  * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_result := v_result || jsonb_build_object(
      'component', 'Forro', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft',
      'source', COALESCE(v_lining_source, 'fallback_average'),
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'consumption_warning', CASE
        WHEN array_length(v_warn_lining_sizes, 1) > 0
          THEN 'Tamanhos sem consumo per-size, usando média: ' ||
               array_to_string(v_warn_lining_sizes, ', ')
        ELSE NULL
      END);
    v_covered_categories  := array_append(v_covered_categories,  'forro');
    v_covered_categories  := array_append(v_covered_categories,  'forração');
    v_covered_categories  := array_append(v_covered_categories,  'forracao');
    v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
  END IF;

  -- Palmilha
  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, v_palmilha_color, 0, false);
    SELECT * INTO v_conv     FROM get_material_conversion_info(v_insole_pid);
    v_required := ((v_acc_insole->>'required')::numeric
                  / NULLIF(v_conv.dm2_per_unit, 0))
                  * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_result := v_result || jsonb_build_object(
      'component', 'Palmilha', 'product_id', v_insole_pid, 'product_name', v_resolved.product_name,
      'color', v_palmilha_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft',
      'source', COALESCE(v_insole_source, 'fallback_average'),
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'consumption_warning', CASE
        WHEN array_length(v_warn_insole_sizes, 1) > 0
          THEN 'Tamanhos sem consumo per-size, usando média: ' ||
               array_to_string(v_warn_insole_sizes, ', ')
        ELSE NULL
      END);
    v_covered_categories  := array_append(v_covered_categories,  'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  -- Fachete (mesmo grupo do forro, mas linha separada para auditoria)
  IF v_is_fachetado
     AND v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND COALESCE((v_acc_fachete->>'required')::numeric, 0) > 0
  THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    SELECT * INTO v_conv     FROM get_material_conversion_info(v_resolved.product_id);
    v_required := ((v_acc_fachete->>'required')::numeric
                  / NULLIF(v_conv.dm2_per_unit, 0))
                  * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_result := v_result || jsonb_build_object(
      'component', 'Fachete', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft', 'source', 'sole_fachete',
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'consumption_warning', CASE
        WHEN array_length(v_warn_fachete_sizes, 1) > 0
          THEN 'Tamanhos sem consumo de fachete: ' ||
               array_to_string(v_warn_fachete_sizes, ', ')
        ELSE NULL
      END);
    -- Não incluir em covered_product_ids — o forro principal pode usar
    -- o mesmo product_id. O débito de estoque trata pelo product_id agregado.
  END IF;

  -- Standard sole items
  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    SELECT name, quantity, category INTO v_acc_name, v_acc_avail, v_row_cat_norm
      FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name,
        'color', '', 'consumption_per_unit', ROUND(v_acc_required / NULLIF(v_total_qty, 0), 4),
        'required', v_acc_required, 'available', v_acc_avail,
        'stock_ok', v_acc_avail >= v_acc_required,
        'debit_mode', CASE WHEN LOWER(COALESCE(v_row_cat_norm,'')) IN
          ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
        'source', 'sole_standard_per_size',
        'unit', (v_acc_std #>> ARRAY[v_key,'unit']));
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  -- BOM legado
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color
      FROM sheet_materials sm
      JOIN products p ON p.id = sm.product_id
     WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories)    THEN CONTINUE; END IF;
    v_required := v_row.quantity_per_unit * v_total_qty;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
        ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category);
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  -- Forros alternativos
  IF COALESCE(v_sheet.insole_has_lining, true) = true
     AND v_sheet.lining_accessories IS NOT NULL
     AND jsonb_typeof(v_sheet.lining_accessories) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.lining_accessories) AS value LOOP
      v_group_name  := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * v_total_qty;
      SELECT * INTO v_resolved FROM resolve_material_product(v_group_name, p_color, v_required, false);
      IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_covered_product_ids)) THEN
        v_result := v_result || jsonb_build_object(
          'component', 'Forro (alternativa)', 'product_id', v_resolved.product_id,
          'product_name', v_resolved.product_name, 'color', p_color,
          'consumption_per_unit', v_consumption, 'required', v_required,
          'available', v_resolved.available_qty,
          'stock_ok', v_resolved.available_qty >= v_required,
          'debit_mode', 'soft', 'source', 'lining_accessory', 'matched_by', v_resolved.matched_by);
        v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_consumption_by_grade(uuid, jsonb, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.calculate_order_consumption_by_grade(uuid, jsonb, text, uuid) IS
  'Consumo de materiais para PV com grade. Calcula dm²/par × pares por tamanho, '
  'aplica conversão para unidade final e waste. Inclui Fachete (faltava). '
  'Marca source=fallback_average e adiciona consumption_warning quando tamanho '
  'cai na média escalar (ficha sem per-size para aquele tamanho).';

-- =============================================================================
-- Helper para a UI: lista os tamanhos do solado que NÃO estão preenchidos no
-- sole_technical_specs ou no technical_sheet (usado para validação no Salvar).
-- =============================================================================
DROP FUNCTION IF EXISTS public.list_missing_sole_consumption_sizes(uuid);
CREATE OR REPLACE FUNCTION public.list_missing_sole_consumption_sizes(p_sole_id uuid)
RETURNS TABLE (
  size integer,
  missing_lining boolean,
  missing_insole boolean,
  missing_upper boolean,
  missing_fachete boolean,
  is_fachetado boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    sts.size,
    COALESCE(sts.lining_consumption_dm2, 0) <= 0 AS missing_lining,
    COALESCE(sts.insole_consumption_dm2, 0) <= 0 AS missing_insole,
    COALESCE(sts.upper_consumption_dm2,  0) <= 0 AS missing_upper,
    p.is_fachetado AND COALESCE(sts.fachete_lining_consumption_dm2, 0) <= 0 AS missing_fachete,
    COALESCE(p.is_fachetado, false) AS is_fachetado
  FROM products p
  JOIN sole_technical_specs sts ON sts.sole_id = p.id
  WHERE p.id = p_sole_id
  ORDER BY sts.size;
$$;

GRANT EXECUTE ON FUNCTION public.list_missing_sole_consumption_sizes(uuid) TO authenticated;
