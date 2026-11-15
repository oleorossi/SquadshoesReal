-- ============================================================================
-- Consumo das LINHAS DE MATERIAIS ADICIONAIS da ficha (sheet_materials)
-- ============================================================================
-- Simulação TESTEBOT02 (15/11/2026) mostrou 5 erros silenciosos no motor
-- public.calculate_order_consumption_by_grade (fonte única de consumo, MRP,
-- reserva, snapshot/débito no apontamento) e no loop de BOM de
-- public.check_stock_availability:
--   1. linha inativa / "fora do consumo" (is_active / include_in_consumption
--      = false) continuava sendo consumida e debitada;
--   2. linha 'per_size' usava a média (quantity_per_unit) em vez de somar
--      tamanho a tamanho da grade;
--   3. perda % da linha (wastage_percentage) era ignorada;
--   4. 2ª linha do mesmo produto era descartada (em vez de somar) e linha
--      cujo produto já saía pelo cabeçalho (cabedal/forro/palmilha/componente
--      direto) era descartada em vez de somada;
--   5. qualquer linha com categoria Cabedal/Palmilha/Forro era descartada
--      quando o cabeçalho da ficha já tinha esse componente.
-- Correção: helper único public.sheet_material_lines_required usado pelos dois
-- motores. Continuam fora só as duplicatas VERDADEIRAS do cabeçalho: o solado
-- (vem só do cabeçalho) e o produto que já é ITEM PADRÃO do grupo do solado
-- (colas — a linha legada 0,0018/0,0028 kg da ficha é cópia antiga do item
-- padrão; somar dobraria a cola das fichas publicadas). Esse caso agora gera
-- aviso na linha do item padrão. Regra oficial de embalagem e pontes legadas
-- de embalagem: inalteradas.
-- Snapshots já congelados (technical_sheet_snapshots) não são reescritos.
-- ============================================================================

-- ─── 1. Helper canônico: consumo das linhas de materiais adicionais ──────────
-- Uma linha conta quando está ATIVA e INCLUÍDA no consumo. Linha 'per_size'
-- soma tamanho a tamanho da grade (sheet_material_grading > consumption_per_size
-- > média da linha como fallback, reportado em fallback_sizes). Perda % da
-- linha multiplica o consumo. Linhas do mesmo produto são SOMADAS.
-- Sem grade (p_grade NULL/vazia): quantity_per_unit × p_quantity.
-- Quantidade na unidade da ficha (dm² para material de área) — a conversão
-- física continua com get_material_conversion_info no chamador.
CREATE OR REPLACE FUNCTION public.sheet_material_lines_required(
  p_sheet_id uuid,
  p_variant_id uuid DEFAULT NULL,
  p_grade jsonb DEFAULT NULL,
  p_quantity numeric DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid,
  required_raw numeric,
  line_count integer,
  fallback_sizes text[],
  first_created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH g AS (
    SELECT kv.key AS size_key,
           NULLIF(split_part(kv.key, '/', 1), '')::integer AS size_num,
           kv.value::numeric AS pairs
      FROM jsonb_each_text(
             CASE WHEN jsonb_typeof(p_grade) = 'object' THEN p_grade ELSE '{}'::jsonb END
           ) kv
     WHERE kv.key ~ '^[0-9]+(/[0-9]+)?$'
       AND kv.value ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
       AND kv.value::numeric > 0
  ),
  has_grade AS (
    SELECT EXISTS (SELECT 1 FROM g) AS ok
  ),
  lines AS (
    SELECT sm.id, sm.product_id, sm.created_at,
           COALESCE(sm.quantity_per_unit, 0) AS qpu,
           COALESCE(sm.consumption_type, 'fixed') = 'per_size' AS is_per_size,
           sm.consumption_per_size AS per_size,
           GREATEST(COALESCE(sm.wastage_percentage, 0), 0) AS waste_pct
      FROM public.get_effective_bom(p_sheet_id, p_variant_id) e
      JOIN public.sheet_materials sm ON sm.id = e.id
     WHERE sm.product_id IS NOT NULL
       AND COALESCE(sm.is_active, true)
       AND COALESCE(sm.include_in_consumption, true)
  ),
  sized AS (
    SELECT l.id, g.size_key, g.pairs,
           CASE WHEN l.is_per_size THEN COALESCE(
             (SELECT smg.specific_consumption
                FROM public.sheet_material_grading smg
               WHERE smg.sheet_material_id = l.id
                 AND smg.size_number = g.size_num
                 AND smg.specific_consumption IS NOT NULL
               ORDER BY smg.created_at DESC NULLS LAST
               LIMIT 1),
             public.pick_consumption_for_size(l.per_size, g.size_key)
           ) END AS size_cons
      FROM lines l CROSS JOIN g
  ),
  per_line AS (
    SELECT l.id, l.product_id, l.created_at,
           (CASE WHEN (SELECT ok FROM has_grade) THEN
              (SELECT COALESCE(SUM(s.pairs * COALESCE(s.size_cons, l.qpu)), 0)
                 FROM sized s WHERE s.id = l.id)
            ELSE l.qpu * COALESCE(p_quantity, 0)
            END) * (1 + l.waste_pct / 100.0) AS req
      FROM lines l
  ),
  fb AS (
    SELECT l.product_id, s.size_key
      FROM lines l JOIN sized s ON s.id = l.id
     WHERE l.is_per_size AND s.size_cons IS NULL
  )
  SELECT pl.product_id,
         SUM(pl.req) AS required_raw,
         COUNT(*)::integer AS line_count,
         (SELECT array_agg(DISTINCT fb.size_key ORDER BY fb.size_key)
            FROM fb WHERE fb.product_id = pl.product_id) AS fallback_sizes,
         MIN(pl.created_at) AS first_created_at
    FROM per_line pl
   GROUP BY pl.product_id;
$function$;

REVOKE ALL ON FUNCTION public.sheet_material_lines_required(uuid, uuid, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sheet_material_lines_required(uuid, uuid, jsonb, numeric) TO authenticated, service_role;

-- ─── 2. Helper: acrescenta aviso à 1ª linha de um produto ────────────────────
CREATE OR REPLACE FUNCTION public.append_consumption_warning_by_product(
  p_lines jsonb, p_product_id uuid, p_warning text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_index integer;
  v_old text;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR p_product_id IS NULL OR COALESCE(btrim(p_warning), '') = '' THEN
    RETURN p_lines;
  END IF;
  SELECT (line.ordinality - 1)::integer, line.value ->> 'consumption_warning'
    INTO v_index, v_old
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS line(value, ordinality)
   WHERE line.value ->> 'product_id' = p_product_id::text
   ORDER BY line.ordinality
   LIMIT 1;
  IF v_index IS NULL THEN
    RETURN p_lines;
  END IF;
  RETURN jsonb_set(p_lines, ARRAY[v_index::text, 'consumption_warning'],
    to_jsonb(COALESCE(NULLIF(v_old, '') || ' | ', '') || p_warning), true);
END;
$function$;

-- ─── 3. Motor por grade ──────────────────────────────────────────────────────
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
  v_extra_upper_match text;
  v_is_fachetado boolean := false;
  v_fachete numeric;
  v_acc_fachete jsonb := '{}'::jsonb;
  v_warn_fachete_sizes integer[] := ARRAY[]::integer[];
  v_prod_unit text; v_std_unit text; v_converted numeric; v_std_color text;
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
  -- CONS-8 (2026-09-25): tamanhos que contribuíram ZERO (sem valor por
  -- numeração E escalar da ficha = 0) — antes sumiam sem aviso nenhum.
  v_zs_upper text[] := ARRAY[]::text[];
  v_zs_lining text[] := ARRAY[]::text[];
  v_zs_insole text[] := ARRAY[]::text[];
  v_zs_insole_lining text[] := ARRAY[]::text[];
  -- CONS-8: consumo acumulado de componente que NÃO resolveu produto — vira
  -- linha de diagnóstico (product_id NULL) no fim, em vez de sumir.
  v_nopid_upper numeric := 0;
  v_nopid_lining numeric := 0;
  v_nopid_insole numeric := 0;
  v_nopid_insole_lining numeric := 0;
  v_warn text;
  v_dc_name text;
  -- Padrões globais por cor (component_color_defaults, mig 20260928120000)
  v_rule_pid uuid;
  v_dc_qty numeric;
  v_dc_key text;
  v_dc_orig text;
  v_dc_warn text;
  v_dc_agg jsonb := '{}'::jsonb;
  v_dc_seen uuid[] := ARRAY[]::uuid[];
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
    SELECT product_id INTO v_variant_sole_pid FROM public.resolve_sole_for_variant_color(p_material_variant_id, p_color);
    v_sole_product_id := COALESCE(v_variant_sole_pid, v_sole_product_id);
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
    v_sole_has_palm_forro := COALESCE(v_sole_has_palm_forro, false)
      OR EXISTS (
        SELECT 1
        FROM jsonb_each_text(public.get_sole_consumption_per_size(
          v_sole_product_id, 'insole_lining_consumption_per_size'
        )) kv
        WHERE (kv.value)::numeric > 0
      );
    v_sole_has_cabedal_forro := COALESCE(v_sole_has_cabedal_forro, false)
      OR EXISTS (
        SELECT 1
        FROM jsonb_each_text(public.get_sole_consumption_per_size(
          v_sole_product_id, 'lining_consumption_per_size'
        )) kv
        WHERE (kv.value)::numeric > 0
      );
    v_suppress_cabedal_lining := v_sole_has_palm_forro
                                 AND NOT v_sole_has_cabedal_forro;
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
  IF COALESCE(btrim(v_sheet.insole_material), '') <> '' OR v_sheet.sole_group_id IS NOT NULL OR v_sheet.primary_sole_id IS NOT NULL THEN
    IF COALESCE(v_sheet.insole_has_lining, true) = false THEN
      SELECT palmilha_color INTO v_palmilha_color FROM technical_sheet_palmilha_colors
      WHERE sheet_id = p_reference_id AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
      ORDER BY (cabedal_color = p_color) DESC LIMIT 1;
      v_palmilha_color := COALESCE(v_palmilha_color, p_color);
    END IF;
    SELECT * INTO v_resolved FROM resolve_insole_material_for_variant(p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0, COALESCE(v_sheet.sole_group_id, (SELECT group_id FROM public.products WHERE id = v_sheet.primary_sole_id)));
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
    v_upper  := public.pick_consumption_for_size(v_sheet.upper_consumption_per_size, v_size::text);
    v_lining := public.pick_consumption_for_size(v_sheet.lining_consumption_per_size, v_size::text);
    v_insole := public.pick_consumption_for_size(v_sheet.insole_consumption_per_size, v_size::text);
    v_insole_lining := public.pick_consumption_for_size(v_sheet.insole_lining_consumption_per_size, v_size::text);
    v_fachete := NULL;

    IF (v_lining IS NULL OR v_insole IS NULL OR v_insole_lining IS NULL OR v_is_fachetado)
       AND v_sole_product_id IS NOT NULL THEN
      IF v_lining IS NULL THEN
        v_lining := public.pick_consumption_for_size(public.get_sole_consumption_per_size(
          v_sole_product_id, 'lining_consumption_per_size'
        ), v_size::text);
      END IF;
      IF v_insole IS NULL THEN
        v_insole := public.pick_consumption_for_size(public.get_sole_consumption_per_size(
          v_sole_product_id, 'insole_consumption_per_size'
        ), v_size::text);
      END IF;
      IF v_insole_lining IS NULL THEN
        v_insole_lining := public.pick_consumption_for_size(public.get_sole_consumption_per_size(
          v_sole_product_id, 'insole_lining_consumption_per_size'
        ), v_size::text);
      END IF;
      IF v_is_fachetado THEN
        v_fachete := public.pick_consumption_for_size(public.get_sole_consumption_per_size(
          v_sole_product_id, 'fachete_lining_consumption_per_size'
        ), v_size::text);
      END IF;

      SELECT * INTO v_spec FROM sole_technical_specs WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining := v_spec.lining_consumption_dm2; END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole := v_spec.insole_consumption_dm2; END IF;
        IF v_insole_lining IS NULL AND COALESCE(v_spec.insole_lining_consumption_dm2, 0) > 0 THEN v_insole_lining := v_spec.insole_lining_consumption_dm2; END IF;
        IF v_is_fachetado AND v_fachete IS NULL AND COALESCE(v_spec.fachete_lining_consumption_dm2, 0) > 0 THEN v_fachete := v_spec.fachete_lining_consumption_dm2; END IF;
      END IF;
    END IF;

    -- CONS-1 (contrato da mig 20260518120000, reintroduzido): tamanho SEM valor
    -- por numeração (nem per_size da ficha, nem spec do solado) que cai na média
    -- escalar é marcado — a linha sai com source='fallback_average' +
    -- consumption_warning em vez do rótulo enganoso 'sheet_per_size'.
    -- Override da variante e forro alternativo/suprimido são consumo EXPLÍCITO,
    -- não fallback.
    -- CONS-8: quando o escalar TAMBÉM é 0, o tamanho contribui ZERO — antes
    -- ficava fora dos dois avisos (o gate exigia escalar > 0) e o consumo saía
    -- silenciosamente menor. Agora entra em v_zs_* (mesmos guards).
    IF v_upper IS NULL AND v_ovr_upper IS NULL THEN
      IF COALESCE(v_sheet.upper_consumption, 0) > 0 THEN
        v_fb_upper := array_append(v_fb_upper, v_size::text);
      ELSE
        v_zs_upper := array_append(v_zs_upper, v_size::text);
      END IF;
    END IF;
    IF v_lining IS NULL AND v_ovr_lining IS NULL
       AND NOT v_lining_is_alt AND NOT v_suppress_cabedal_lining THEN
      IF COALESCE(v_sheet.lining_consumption, 0) > 0 THEN
        v_fb_lining := array_append(v_fb_lining, v_size::text);
      ELSE
        v_zs_lining := array_append(v_zs_lining, v_size::text);
      END IF;
    END IF;
    IF v_insole IS NULL AND v_ovr_insole IS NULL AND NOT v_is_palmilha_pronta THEN
      IF COALESCE(v_sheet.insole_consumption, 0) > 0 THEN
        v_fb_insole := array_append(v_fb_insole, v_size::text);
      ELSE
        v_zs_insole := array_append(v_zs_insole, v_size::text);
      END IF;
    END IF;
    IF v_insole_lining IS NULL AND NOT v_is_palmilha_pronta THEN
      IF COALESCE(v_sheet.insole_lining_consumption, 0) > 0 THEN
        v_fb_insole_lining := array_append(v_fb_insole_lining, v_size::text);
      ELSE
        v_zs_insole_lining := array_append(v_zs_insole_lining, v_size::text);
      END IF;
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
    ELSIF v_upper_pid IS NULL AND v_upper > 0 THEN
      v_nopid_upper := v_nopid_upper + v_upper * v_pairs;   -- CONS-8
    END IF;
    IF v_lining_pid IS NOT NULL AND v_lining > 0 THEN
      v_acc_lining := jsonb_set(v_acc_lining, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_lining->>'required')::numeric, 0) + v_lining * v_pairs));
    ELSIF v_lining_pid IS NULL AND v_lining > 0 THEN
      v_nopid_lining := v_nopid_lining + v_lining * v_pairs; -- CONS-8
    END IF;
    IF v_insole_pid IS NOT NULL AND v_insole > 0 THEN
      v_acc_insole := jsonb_set(v_acc_insole, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_insole->>'required')::numeric, 0) + v_insole * v_pairs));
    ELSIF v_insole_pid IS NULL AND v_insole > 0 AND NOT v_is_palmilha_pronta THEN
      v_nopid_insole := v_nopid_insole + v_insole * v_pairs; -- CONS-8 (caso b)
    END IF;
    IF NOT v_is_palmilha_pronta AND v_lining_pid IS NOT NULL AND v_insole_lining > 0 THEN
      v_acc_insole_lining := jsonb_set(v_acc_insole_lining, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_insole_lining->>'required')::numeric, 0) + v_insole_lining * v_pairs));
    ELSIF NOT v_is_palmilha_pronta AND v_lining_pid IS NULL AND v_insole_lining > 0 THEN
      v_nopid_insole_lining := v_nopid_insole_lining + v_insole_lining * v_pairs; -- CONS-8
    END IF;
    IF v_is_fachetado AND v_fachete IS NOT NULL AND v_fachete > 0 THEN
      v_acc_fachete := jsonb_set(v_acc_fachete, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_fachete->>'required')::numeric, 0) + v_fachete * v_pairs));
    END IF;

    IF v_sole_product_id IS NOT NULL THEN
      FOR v_std_item IN
        SELECT sgsi.material_product_id AS pid,
               COALESCE(public.pick_consumption_for_size(sgsi.consumption_per_size, v_size::text), sgsi.consumption_per_pair) AS cons,
               COALESCE(sgsi.unit, pstd.unit) AS unit
          FROM sole_group_standard_items sgsi
          JOIN products psole ON psole.id = v_sole_product_id
          JOIN products pstd  ON pstd.id  = sgsi.material_product_id
         WHERE sgsi.sole_group_id = psole.group_id
           AND sgsi.role IS NULL
           AND COALESCE(public.pick_consumption_for_size(sgsi.consumption_per_size, v_size::text), sgsi.consumption_per_pair) > 0

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
    v_required := ((v_acc_upper->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0));
    v_warn := NULL;
    IF array_length(v_fb_upper, 1) > 0 THEN
      v_warn := 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_upper, ', ');
    END IF;
    IF array_length(v_zs_upper, 1) > 0 THEN
      v_warn := COALESCE(v_warn || ' | ', '')
        || 'Tamanhos SEM consumo cadastrado — contribuíram ZERO ao cálculo: ' || array_to_string(v_zs_upper, ', ');
    END IF;
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
      'consumption_warning', v_warn);
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
    v_required := ((v_acc_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0));
    v_warn := NULL;
    IF NOT v_lining_is_alt AND array_length(v_fb_lining, 1) > 0 THEN
      v_warn := 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_lining, ', ');
    END IF;
    IF NOT v_lining_is_alt AND array_length(v_zs_lining, 1) > 0 THEN
      v_warn := COALESCE(v_warn || ' | ', '')
        || 'Tamanhos SEM consumo cadastrado — contribuíram ZERO ao cálculo: ' || array_to_string(v_zs_lining, ', ');
    END IF;
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
      'consumption_warning', v_warn);
    v_covered_categories  := array_append(v_covered_categories,  'forro');
    v_covered_categories  := array_append(v_covered_categories,  'forração');
    v_covered_categories  := array_append(v_covered_categories,  'forracao');
    v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
  END IF;

  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0
     AND NOT v_is_palmilha_pronta THEN
    SELECT * INTO v_resolved FROM resolve_insole_material_for_variant(p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0, COALESCE(v_sheet.sole_group_id, (SELECT group_id FROM public.products WHERE id = v_sheet.primary_sole_id)));
    SELECT * INTO v_conv FROM get_material_conversion_info(v_insole_pid);
    v_required := ((v_acc_insole->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0));
    v_warn := NULL;
    IF array_length(v_fb_insole, 1) > 0 THEN
      v_warn := 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_insole, ', ');
    END IF;
    IF array_length(v_zs_insole, 1) > 0 THEN
      v_warn := COALESCE(v_warn || ' | ', '')
        || 'Tamanhos SEM consumo cadastrado — contribuíram ZERO ao cálculo: ' || array_to_string(v_zs_insole, ', ');
    END IF;
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
      'consumption_warning', v_warn);
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
    v_required := ((v_acc_insole_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0));
    v_warn := NULL;
    IF array_length(v_fb_insole_lining, 1) > 0 THEN
      v_warn := 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_insole_lining, ', ');
    END IF;
    IF array_length(v_zs_insole_lining, 1) > 0 THEN
      v_warn := COALESCE(v_warn || ' | ', '')
        || 'Tamanhos SEM consumo cadastrado — contribuíram ZERO ao cálculo: ' || array_to_string(v_zs_insole_lining, ', ');
    END IF;
    v_result := v_result || jsonb_build_object(
      'component', 'Forração Palmilha', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', CASE WHEN array_length(v_fb_insole_lining, 1) > 0 THEN 'fallback_average'
                     ELSE 'insole_lining' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning,
      'consumption_warning', v_warn);
    IF NOT (v_lining_pid = ANY(v_covered_product_ids)) THEN
      v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
    END IF;
  END IF;

  -- CONS-6 (paridade TS): o grupo do fachete vem de
  -- products.fachete_material_group_id do SOLADO (prioridade do motor canônico
  -- orderConsumption.ts); só na falta dele cai no lining_material da ficha.
  v_fachete_group := NULL;
  -- fachete_material_por_referencia_20270101035400: a escolha da FICHA vence o grupo do solado.
  IF v_is_fachetado THEN
    v_fachete_group := NULLIF(btrim(COALESCE(v_sheet.fachete_material, '')), '');
  END IF;
  IF v_is_fachetado AND v_fachete_group IS NULL AND v_sole_product_id IS NOT NULL THEN
    SELECT pg2.name INTO v_fachete_group
      FROM products p2 JOIN product_groups pg2 ON pg2.id = p2.fachete_material_group_id
     WHERE p2.id = v_sole_product_id;
  END IF;
  v_fachete_group := COALESCE(v_fachete_group, NULLIF(v_sheet.lining_material, ''));

  IF v_is_fachetado
     AND v_fachete_group IS NOT NULL
     AND COALESCE((v_acc_fachete->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_fachete_material_for_variant(p_material_variant_id, v_fachete_group, p_color, 0);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := ((v_acc_fachete->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0));
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
    ELSE
      -- CONS-8: grupo do fachete cadastrado mas SEM produto resolvível (grupo
      -- vazio / cor inexistente) — antes a linha inteira sumia.
      v_result := v_result || jsonb_build_object(
        'component', 'Fachete', 'product_id', NULL, 'product_name', v_fachete_group,
        'color', COALESCE(p_color, ''), 'consumption_per_unit', 0, 'required', 0,
        'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
        'consumption_warning', 'Fachete: o grupo "' || v_fachete_group
          || '" não resolve nenhum produto ativo no estoque — a forração do salto NÃO será reservada nem debitada. Cadastre um produto no grupo (ou corrija o grupo do fachete no solado).');
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
    SELECT name, quantity, category, unit, color INTO v_acc_name, v_acc_avail, v_row_cat_norm, v_prod_unit, v_std_color FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_converted := public.convert_to_product_unit(v_acc_required, v_std_unit, v_prod_unit);
      v_result := v_result || jsonb_build_object(
        'component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name,
        'color', COALESCE(v_std_color, ''), 'consumption_per_unit', ROUND(COALESCE(v_converted, v_acc_required) / NULLIF(v_total_qty, 0), 4),
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

  -- direct-components-sku-obrigatorio: component_colors morto; pin em direct_components.
  IF false
     AND COALESCE(v_sheet.component_colors_enabled, false)
     AND p_color IS NOT NULL AND btrim(p_color) <> '' THEN
    FOR v_row IN
      SELECT tcc.product_id AS pid, tcc.quantity_per_unit AS qpu, p.name AS pname,
             GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
             p.category AS category, p.unit AS unit, p.color AS color
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
        'color', COALESCE(v_row.color, ''),
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
    -- Padrões globais por cor (component_color_defaults): 1º passe resolve a
    -- regra do GRUPO do componente pra cor do PV (exata > default) e agrega
    -- por SKU RESOLVIDO, SOMANDO colapsos. 2º passe emite (shape idêntico ao
    -- branch original). Regra só com cor não-vazia e produto-alvo ativo.
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NULL OR v_pid = ANY(v_covered_product_ids) OR v_pid = ANY(v_dc_seen) THEN
        CONTINUE;
      END IF;
      v_dc_qty := COALESCE((v_item ->> 'quantity')::numeric, 0);
      IF v_dc_qty <= 0 THEN CONTINUE; END IF;
      -- marca DEPOIS do check de qty: entrada zerada não esconde duplicata
      -- válida (paridade com o comportamento antigo, que só marcava ao emitir)
      v_dc_seen := array_append(v_dc_seen, v_pid);

      -- direct-components-sku-obrigatorio: pin vence; sem swap por cor.
      v_rule_pid := NULL; v_dc_warn := NULL;

      v_dc_key := COALESCE(v_rule_pid, v_pid)::text;
      v_dc_agg := jsonb_set(v_dc_agg, ARRAY[v_dc_key], jsonb_build_object(
        'qty', COALESCE((v_dc_agg #>> ARRAY[v_dc_key,'qty'])::numeric, 0) + v_dc_qty,
        'via_rule', COALESCE((v_dc_agg #>> ARRAY[v_dc_key,'via_rule'])::boolean, false) OR (v_rule_pid IS NOT NULL),
        'warn', COALESCE(v_dc_agg #>> ARRAY[v_dc_key,'warn'], v_dc_warn),
        'orig_name', COALESCE(v_dc_agg #>> ARRAY[v_dc_key,'orig_name'], NULLIF(btrim(v_item ->> 'product_name'), '')),
        -- pids ORIGINAIS que caíram nesta chave: entram no v_covered_product_ids
        -- na emissão, senão o loop de BOM re-emitiria o produto original que o
        -- dedup dc↔BOM sempre suprimiu.
        'orig_pids', COALESCE(v_dc_agg #> ARRAY[v_dc_key,'orig_pids'], '[]'::jsonb) || to_jsonb(v_pid::text)));
    END LOOP;

    FOR v_dc_key IN SELECT jsonb_object_keys(v_dc_agg) LOOP
      v_pid := v_dc_key::uuid;
      IF v_pid = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
      v_dc_qty := (v_dc_agg #>> ARRAY[v_dc_key,'qty'])::numeric;
      v_required := v_dc_qty * v_total_qty;
      IF v_required <= 0 THEN CONTINUE; END IF;
      SELECT p.name AS name,
             GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
             p.category AS category, p.unit AS unit, p.color AS color
        INTO v_row FROM products p WHERE p.id = v_pid;
      IF FOUND THEN
        v_result := v_result || jsonb_build_object(
          'component', 'Componente Direto', 'product_id', v_pid, 'product_name', v_row.name,
          'color', COALESCE(v_row.color, ''),
          'consumption_per_unit', v_dc_qty, 'required', v_required,
          'available', v_row.available, 'stock_ok', v_row.available >= v_required,
          'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
            ('acessório','embalagem','cola / químico','ferramentas','solado','componente','componentes') THEN 'hard' ELSE 'soft' END,
          'source', CASE WHEN COALESCE((v_dc_agg #>> ARRAY[v_dc_key,'via_rule'])::boolean, false)
                         THEN 'component_color_default' ELSE 'direct_components' END,
          'unit', v_row.unit,
          'consumption_warning', v_dc_agg #>> ARRAY[v_dc_key,'warn']);
        v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
        FOR v_dc_orig IN SELECT jsonb_array_elements_text(COALESCE(v_dc_agg #> ARRAY[v_dc_key,'orig_pids'], '[]'::jsonb)) LOOP
          v_covered_product_ids := array_append(v_covered_product_ids, v_dc_orig::uuid);
        END LOOP;
      ELSE
        -- CONS-8 (caso a): o product_id do componente direto não existe mais
        -- em products (cadastro apagado). A regra global NUNCA cai aqui (o
        -- lookup exige produto ativo) — só o pid original da ficha.
        v_dc_name := COALESCE(v_dc_agg #>> ARRAY[v_dc_key,'orig_name'], 'Componente sem cadastro');
        v_result := v_result || jsonb_build_object(
          'component', 'Componente Direto', 'product_id', NULL, 'product_name', v_dc_name,
          'color', '', 'consumption_per_unit', 0, 'required', 0,
          'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
          -- sem 'unit': o Zod do frontend aceita unit ausente (optional),
          -- mas NÃO aceita null — e aqui não há produto pra dar a unidade.
          'consumption_warning', 'Componente direto "' || v_dc_name || '" ('
            || trim(to_char(v_dc_qty, 'FM999999990.####'))
            || '/par) não resolve produto no estoque — cadastro apagado. NÃO será reservado nem debitado. Recadastre o produto e refaça o vínculo em Ficha Técnica → Componentes.');
      END IF;
    END LOOP;
  END IF;

  -- FIX-BOM-LINES-20270101045900: linhas de MATERIAIS ADICIONAIS da ficha.
  -- Antes: (1) contava linha inativa/fora do consumo; (2) usava a média
  -- (quantity_per_unit) mesmo em linha 'per_size'; (3) ignorava a perda %;
  -- (4) descartava a 2ª linha do mesmo produto e o produto já usado no
  -- cabeçalho (palmilha/cabedal/forro/componente direto) em vez de SOMAR;
  -- (5) descartava QUALQUER linha cuja categoria fosse Cabedal/Palmilha/Forro
  -- quando o cabeçalho já tinha esse componente.
  -- Agora: public.sheet_material_lines_required agrega por produto (ativas e
  -- incluídas no consumo, por numeração da grade, com perda). Só ficam fora as
  -- duplicatas VERDADEIRAS do cabeçalho: o próprio solado (só vem do
  -- cabeçalho) e o produto que já é ITEM PADRÃO do grupo do solado (fonte
  -- oficial das colas — a linha legada da ficha é cópia antiga dele); nesse
  -- caso a linha do item padrão ganha um aviso. Regra de embalagem intacta.
  -- SQL-1 preservado: o helper lê o BOM EFETIVO via public.get_effective_bom
  -- (linha compartilhada + override da variante deste item).
  FOR v_row IN
    SELECT b.product_id, b.required_raw, b.line_count, b.fallback_sizes,
           p.name,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
           p.category, p.color AS product_color
      FROM public.sheet_material_lines_required(
             p_reference_id, p_material_variant_id, p_grade, NULL
           ) b
      JOIN products p ON p.id = b.product_id
     WHERE p.active = true
     ORDER BY b.first_created_at, b.product_id
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));

    -- AUDIT-PACKAGING-CANONICAL-20260825: BOM legado excluído.
    IF EXISTS (
      SELECT 1
        FROM public.legacy_packaging_product_bridges packaging_bridge
       WHERE packaging_bridge.product_id = v_row.product_id
    ) THEN
      CONTINUE;
    END IF;

    -- Duplicata verdadeira: solado vem só do cabeçalho.
    IF v_row.product_id IS NOT DISTINCT FROM v_sole_product_id
       OR btrim(v_row_cat_norm) = 'solado' THEN
      CONTINUE;
    END IF;

    -- Duplicata verdadeira: item padrão do solado (colas etc.).
    IF v_acc_std ? v_row.product_id::text THEN
      v_result := public.append_consumption_warning_by_product(
        v_result, v_row.product_id,
        'A ficha também lista este material nas linhas de materiais adicionais ('
          || trim(to_char(round(v_row.required_raw, 6), 'FM999999990.999999'))
          || ' no total); ela foi IGNORADA porque o item padrão do solado já é a fonte oficial deste consumo.');
      CONTINUE;
    END IF;

    v_required := v_row.required_raw;
    IF COALESCE(v_required, 0) <= 0 THEN CONTINUE; END IF;
    SELECT * INTO v_conv FROM get_material_conversion_info(v_row.product_id);
    IF COALESCE(v_conv.dm2_per_unit, 1) > 0 AND COALESCE(v_conv.dm2_per_unit, 1) <> 1 THEN
      v_required := (v_required / v_conv.dm2_per_unit);
    END IF;

    v_warn := NULL;
    IF array_length(v_row.fallback_sizes, 1) > 0 THEN
      v_warn := 'Linha de material adicional por numeração sem consumo nos tamanhos '
        || array_to_string(v_row.fallback_sizes, ', ')
        || ' — usada a média da linha nesses tamanhos.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result) AS emitted(line)
       WHERE emitted.line ->> 'product_id' = v_row.product_id::text
    ) THEN
      -- Mesmo produto já emitido pelo cabeçalho (cabedal/forro/palmilha/
      -- componente direto): SOMA a quantidade física.
      v_result := public.merge_consumption_required_by_product(
        v_result, v_row.product_id, v_required, v_total_qty,
        CASE WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_result) AS emitted(line)
           WHERE emitted.line ->> 'product_id' = v_row.product_id::text
             AND emitted.line ->> 'matched_by' = 'color_mismatch'
        ) THEN 0 ELSE v_row.available END
      );
      IF v_warn IS NOT NULL THEN
        v_result := public.append_consumption_warning_by_product(v_result, v_row.product_id, v_warn);
      END IF;
      CONTINUE;
    END IF;

    -- AUDIT-CONSUMPTION-PARITY-20260825: embalagem-discreta-por-item.
    IF btrim(v_row_cat_norm) = 'embalagem'
       AND lower(btrim(COALESCE(v_conv.target_unit, ''))) = ANY (
         ARRAY['un', 'par', 'placa']::text[]
       )
       AND v_required > 0 THEN
      v_required := CEIL(v_required);
    END IF;

    v_result := v_result || (jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color,
      'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
        ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category,
      'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning)
      || CASE WHEN v_warn IS NOT NULL
              THEN jsonb_build_object('consumption_warning', v_warn)
              ELSE '{}'::jsonb END);
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  IF v_sheet.components_accessories IS NOT NULL AND jsonb_typeof(v_sheet.components_accessories) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.components_accessories) AS value LOOP
      IF COALESCE((v_item ->> 'mandatory')::boolean, false) <> true THEN CONTINUE; END IF;
      -- components_accessories_grade_additive_20270101014675
      v_required := public.calculate_component_accessory_required_by_grade(
        v_item, p_grade
      );
      IF v_required <= 0 THEN CONTINUE; END IF;
      v_pid := NULL;
      BEGIN v_pid := NULLIF(v_item ->> 'product_id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_pid := NULL; END;
      IF v_pid IS NULL THEN
        BEGIN v_pid := NULLIF(v_item ->> 'id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_pid := NULL; END;
      END IF;
      -- extra_upper_variant_identity_165
      v_extra_upper_match := NULL;
      IF v_pid IS NULL AND COALESCE(v_item ->> 'material', '') <> '' THEN
        IF NULLIF(btrim(v_item ->> 'product_id'), '') IS NULL
           AND NULLIF(btrim(v_item ->> 'id'), '') IS NULL
           AND COALESCE((v_item ->> 'leftover')::boolean, false) = false
           AND lower(btrim(v_item ->> 'material')) = lower(btrim(v_sheet.upper_material)) THEN
          -- É outra peça do mesmo material principal, não uma camada fixa.
          -- Reutiliza a precedência e a proteção de cor do Cabedal composto.
          SELECT resolved.product_id, resolved.matched_by
            INTO v_pid, v_extra_upper_match
            FROM public.resolve_upper_material_for_variant(
              p_material_variant_id, v_sheet.upper_material, p_color,
              v_required, v_sheet.upper_material_product_id
            ) resolved;
        ELSE
          SELECT product_id INTO v_pid FROM resolve_material_product(v_item ->> 'material', p_color, v_required, false);
        END IF;
      END IF;
      IF v_pid IS NOT NULL THEN
        SELECT p.name AS name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))::numeric AS avail
          INTO v_row FROM products p WHERE p.id = v_pid AND p.active = true;
        IF FOUND THEN
          SELECT * INTO v_conv FROM get_material_conversion_info(v_pid);
          v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0));
          IF EXISTS (
            SELECT 1
              FROM jsonb_array_elements(v_result) AS emitted(line)
             WHERE emitted.line ->> 'product_id' = v_pid::text
          ) THEN
            -- O principal e o adicional foram calculados e convertidos
            -- separadamente; aqui unificamos apenas a quantidade fisica.
            v_result := public.merge_consumption_required_by_product(
              v_result, v_pid, v_required, v_total_qty,
              CASE WHEN v_extra_upper_match = 'color_mismatch' THEN 0 ELSE v_row.avail END
            );
          ELSE
            v_result := v_result || jsonb_build_object(
              'component', COALESCE(NULLIF(v_item ->> 'label', ''), 'Componente Extra (cabedal)'),
              'product_id', v_pid, 'product_name', v_row.name, 'color', p_color,
              'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required,
              'available', v_row.avail,
              'stock_ok', v_extra_upper_match IS DISTINCT FROM 'color_mismatch' AND v_row.avail >= v_required,
              'debit_mode', 'soft', 'source', 'component_accessory', 'unit', v_conv.target_unit,
              'matched_by', v_extra_upper_match,
              'conversion_warning', v_conv.conversion_warning);
            IF NOT (v_pid = ANY(v_covered_product_ids)) THEN
              v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
            END IF;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── CONS-8: DIAGNÓSTICO — componentes que NÃO resolveram produto ──────────
  -- Linhas com product_id NULL e required 0. filter_caixa_by_packaging_mode as
  -- remove antes de reserva/débito/custeio/snapshot; a UI que chama a RPC
  -- direto (modal, precificação, wizard de compras) exibe o aviso.

  -- (c) Solado: a ficha aponta solado (texto livre, grupo ou primary) mas a
  -- cascata resolve_sole_color não chegou a produto nenhum.
  IF v_sole_product_id IS NULL
     AND (COALESCE(btrim(v_sheet.sole_material), '') <> ''
          OR v_sheet.sole_group_id IS NOT NULL
          OR v_sheet.primary_sole_id IS NOT NULL) THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', NULL,
      'product_name', COALESCE(NULLIF(btrim(v_sheet.sole_material), ''), 'Solado da ficha'),
      'color', COALESCE(p_color, ''), 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
      'consumption_warning', 'Solado "'
        || COALESCE(NULLIF(btrim(v_sheet.sole_material), ''), '(sem nome)')
        || '" não resolve produto no estoque (texto livre, sem grupo de solado, sem solado principal e sem mapeamento por cor) — '
        || trim(to_char(v_total_qty, 'FM999999990.##'))
        || ' pares ficam SEM solado no consumo, e ele não será reservado nem debitado. Vincule o solado em Ficha Técnica → Solado.');
  END IF;

  -- (b) Palmilha: há consumo de palmilha mas o material não resolve produto
  -- (insole_material vazio — NL01–NL04 — ou grupo sem produto ativo).
  IF NOT v_is_palmilha_pronta AND v_insole_pid IS NULL AND v_nopid_insole > 0 THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Palmilha', 'product_id', NULL,
      'product_name', COALESCE(NULLIF(btrim(v_sheet.insole_material), ''), 'Palmilha sem material'),
      'color', COALESCE(v_palmilha_color, p_color, ''), 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
      'consumption_warning', CASE
        WHEN COALESCE(btrim(v_sheet.insole_material), '') = ''
          THEN 'A ficha tem consumo de palmilha ('
               || trim(to_char(v_nopid_insole, 'FM999999990.##'))
               || ' dm² no total) mas NÃO tem Material da Palmilha cadastrado — a linha inteira fica fora do consumo, da reserva e do débito. Cadastre em Ficha Técnica → Palmilha.'
        ELSE 'Material da palmilha "' || btrim(v_sheet.insole_material)
             || '" não resolve produto ativo no estoque — '
             || trim(to_char(v_nopid_insole, 'FM999999990.##'))
             || ' dm² ficam fora do consumo, da reserva e do débito.'
        END);
  END IF;

  -- Cabedal / Forração / Forração Palmilha sem produto resolvido.
  IF v_upper_pid IS NULL AND v_nopid_upper > 0 THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Cabedal', 'product_id', NULL,
      'product_name', COALESCE(NULLIF(btrim(v_sheet.upper_material), ''), 'Cabedal sem material'),
      'color', COALESCE(p_color, ''), 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
      'consumption_warning', 'Cabedal: '
        || CASE WHEN COALESCE(btrim(v_sheet.upper_material), '') = ''
                THEN 'a ficha tem consumo mas NÃO tem material cadastrado'
                ELSE 'o material "' || btrim(v_sheet.upper_material) || '" não resolve produto ativo no estoque' END
        || ' — ' || trim(to_char(v_nopid_upper, 'FM999999990.##'))
        || ' dm² ficam fora do consumo, da reserva e do débito.');
  END IF;

  IF v_lining_pid IS NULL AND v_nopid_lining > 0 THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Forração', 'product_id', NULL,
      'product_name', COALESCE(NULLIF(btrim(COALESCE(v_lining_group, v_sheet.lining_material)), ''), 'Forração sem material'),
      'color', COALESCE(p_color, ''), 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
      'consumption_warning', 'Forração: '
        || CASE WHEN COALESCE(btrim(COALESCE(v_lining_group, v_sheet.lining_material)), '') = ''
                THEN 'a ficha tem consumo mas NÃO tem material de forro cadastrado'
                ELSE 'o material "' || btrim(COALESCE(v_lining_group, v_sheet.lining_material)) || '" não resolve produto ativo no estoque' END
        || ' — ' || trim(to_char(v_nopid_lining, 'FM999999990.##'))
        || ' dm² ficam fora do consumo, da reserva e do débito.');
  END IF;

  IF NOT v_is_palmilha_pronta
     AND COALESCE(v_sheet.insole_has_lining, true) = true
     AND v_lining_pid IS NULL AND v_nopid_insole_lining > 0 THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Forração Palmilha', 'product_id', NULL,
      'product_name', COALESCE(NULLIF(btrim(COALESCE(v_lining_group, v_sheet.lining_material)), ''), 'Forração sem material'),
      'color', COALESCE(p_color, ''), 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
      'consumption_warning', 'Forração da palmilha: o material de forro da ficha não resolve produto ativo no estoque — '
        || trim(to_char(v_nopid_insole_lining, 'FM999999990.##'))
        || ' dm² ficam fora do consumo, da reserva e do débito.');
  END IF;

  -- consumption_sector_context_20270101015500
  RETURN private.attach_consumption_sector_context(
    p_reference_id, p_material_variant_id, v_result
  );
END;
$function$
;

-- ─── 4. Checagem de disponibilidade (badge / auto-OC) ─────────────────────────
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
          SELECT
                 coalesce(nullif(line.value ->> 'component', ''), 'Material') AS component,
                 coalesce(nullif(line.value ->> 'color', ''), nullif(p_color, ''), '?') AS requested_color,
                 pg_catalog.array_remove(
                   pg_catalog.array_agg(DISTINCT public.try_parse_uuid(line.value ->> 'product_id')),
                   NULL
                 ) AS fallback_pids
            FROM jsonb_array_elements(v_cons) AS line(value)
           WHERE coalesce(line.value ->> 'matched_by', '') = 'color_mismatch'
             AND (line.value ->> 'component') IN (
               'Cabedal', 'Forração', 'Palmilha', 'Forração Palmilha', 'Fachete'
             )
           GROUP BY
                 coalesce(nullif(line.value ->> 'component', ''), 'Material'),
                 coalesce(nullif(line.value ->> 'color', ''), nullif(p_color, ''), '?')
        LOOP
          v_emitted := v_emitted || coalesce(v_spec.fallback_pids, ARRAY[]::uuid[]);
          product_id := NULL;
          product_name := v_spec.component || ' sem SKU para ' || v_spec.requested_color;
          required := 0;
          available := 0;
          sufficient := false;
          RETURN NEXT;
        END LOOP;

        FOR v_spec IN
          SELECT (l ->> 'product_id')::uuid       AS pid,
                 MAX(l ->> 'product_name')        AS pname,
                 SUM((l ->> 'required')::numeric) AS req
            FROM jsonb_array_elements(v_cons) AS l
           WHERE (l ->> 'component') IN ('Cabedal','Forração','Palmilha','Forração Palmilha','Fachete','Item padrão (solado)')
             AND (l ->> 'product_id') IS NOT NULL
             AND (l ->> 'conversion_warning') IS NULL
             AND coalesce(l ->> 'matched_by', '') <> 'color_mismatch'
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
        IF coalesce(v_resolved.matched_by, '') = 'color_mismatch' THEN
          IF v_resolved.product_id IS NOT NULL
             AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
            v_emitted := array_append(v_emitted, v_resolved.product_id);
          END IF;
          product_id := NULL;
          product_name := 'Cabedal sem SKU para ' || coalesce(nullif(p_color, ''), 'cor solicitada');
          required := 0;
          available := 0;
          sufficient := false;
          RETURN NEXT;
        ELSIF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
          SELECT * INTO v_conv FROM public.get_material_conversion_info(v_resolved.product_id);
          IF v_conv.conversion_warning IS NULL THEN
            v_required := (v_sheet.upper_consumption * p_order_quantity / NULLIF(v_conv.dm2_per_unit, 0));
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
        IF coalesce(v_resolved.matched_by, '') = 'color_mismatch' THEN
          IF v_resolved.product_id IS NOT NULL
             AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
            v_emitted := array_append(v_emitted, v_resolved.product_id);
          END IF;
          product_id := NULL;
          product_name := 'Forração sem SKU para ' || coalesce(nullif(p_color, ''), 'cor solicitada');
          required := 0;
          available := 0;
          sufficient := false;
          RETURN NEXT;
        ELSIF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
          v_lining_total := COALESCE(v_sheet.lining_consumption, 0);
          IF NOT v_is_palmilha_pronta AND COALESCE(v_sheet.insole_has_lining, true) = true THEN
            v_lining_total := v_lining_total + COALESCE(v_sheet.insole_lining_consumption, 0);
          END IF;
          IF v_lining_total > 0 THEN
            SELECT * INTO v_conv FROM public.get_material_conversion_info(v_resolved.product_id);
            IF v_conv.conversion_warning IS NULL THEN
              v_required := (v_lining_total * p_order_quantity / NULLIF(v_conv.dm2_per_unit, 0));
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
      IF NOT v_is_palmilha_pronta
         AND (
           COALESCE(v_sheet.insole_consumption, 0) > 0
           OR COALESCE(v_sheet.sole_drives_consumption, false)
         )
         AND (
           COALESCE(btrim(v_sheet.insole_material), '') <> ''
           OR v_sheet.sole_group_id IS NOT NULL
           OR v_sheet.primary_sole_id IS NOT NULL
         ) THEN
        v_palmilha_color := p_color;
        IF COALESCE(v_sheet.insole_has_lining, true) = false THEN
          SELECT palmilha_color INTO v_palmilha_color FROM public.technical_sheet_palmilha_colors
           WHERE sheet_id = p_reference_id AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
           ORDER BY (cabedal_color = p_color) DESC LIMIT 1;
          v_palmilha_color := COALESCE(v_palmilha_color, p_color);
        END IF;
        SELECT * INTO v_resolved FROM public.resolve_insole_material_for_variant(p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0, COALESCE(v_sheet.sole_group_id, (SELECT group_id FROM public.products WHERE id = v_sheet.primary_sole_id)));
        IF coalesce(v_resolved.matched_by, '') = 'color_mismatch' THEN
          IF v_resolved.product_id IS NOT NULL
             AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
            v_emitted := array_append(v_emitted, v_resolved.product_id);
          END IF;
          product_id := NULL;
          product_name := 'Palmilha sem SKU para ' || coalesce(nullif(v_palmilha_color, ''), 'cor solicitada');
          required := 0;
          available := 0;
          sufficient := false;
          RETURN NEXT;
        ELSIF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
          SELECT * INTO v_conv FROM public.get_material_conversion_info(v_resolved.product_id);
          IF v_conv.conversion_warning IS NULL THEN
            v_required := (v_sheet.insole_consumption * p_order_quantity / NULLIF(v_conv.dm2_per_unit, 0));
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
    -- FIX-BOM-LINES-20270101045900: mesmo helper do by_grade (linhas ativas e
    -- incluídas, por numeração, com perda, somadas por produto). Com grade,
    -- o total é escalado para p_order_quantity (linha fixa = qpu × qty, igual
    -- ao comportamento anterior).
    SELECT b.product_id,
           CASE WHEN v_grade_valid THEN
             b.required_raw * COALESCE(p_order_quantity, 0)::numeric / NULLIF((
               SELECT SUM(gk.value::numeric) FROM jsonb_each_text(p_order_grade) gk
                WHERE gk.key ~ '^[0-9]+(/[0-9]+)?$' AND (gk.value)::numeric > 0), 0)
           ELSE b.required_raw END AS required_raw,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.sheet_material_lines_required(
           p_reference_id, p_material_variant_id,
           CASE WHEN v_grade_valid THEN p_order_grade END,
           p_order_quantity::numeric) b
    JOIN public.products p ON p.id = b.product_id
    ORDER BY b.first_created_at, b.product_id
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
    v_required := COALESCE(mat.required_raw, 0);
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
      v_required := (v_required / v_conv.dm2_per_unit);
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
    -- F4-4 (auditoria 2026-07-21): SEM piso inventado de 1 cm/par — paridade
    -- com public.deprecated_strap_stock_noop (Achado (b)) e com o modal TS (strapConsumption.ts):
    -- consumo ausente/<=0 é 0, inclusive como fallback per-size.
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 0);
    IF v_consumption < 0 THEN v_consumption := 0; END IF;

    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0; v_grade_total := 0;
      FOR v_size, v_pairs IN
        SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE(public.pick_consumption_for_size(v_per_size, v_size), v_consumption);
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

    -- F4-4: consumo NÃO configurado → o débito (public.deprecated_strap_stock_noop) PULA esta
    -- tira com warning na OP; o badge espelha com linha de AVISO (product_id
    -- NULL ⇒ o caller mostra a pendência mas NÃO gera auto-OC), em vez do
    -- required fictício "verde" que o piso de 1 cm/par inventava.
    IF v_required <= 0 THEN
      IF p_order_quantity > 0 THEN
        v_strap_label := COALESCE(NULLIF(trim(v_strap ->> 'label'), ''), 'Tira');
        product_id := NULL;
        product_name := v_strap_label || ' (sem consumo configurado)';
        required := 0; available := 0; sufficient := false;
        RETURN NEXT;
      END IF;
      CONTINUE;
    END IF;

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

    -- Prioridade 0: padrão global grupo+cor (component_color_defaults, mig
    -- 20260928120000) — exata > default; produto da regra ativo e do grupo.
    SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
      INTO v_target_id, v_target_name, v_target_qty
      FROM public.component_color_defaults d
      JOIN public.products p ON p.id = d.product_id
     WHERE d.active = true AND d.group_id = v_group_id
       AND p.active = true AND p.group_id = v_group_id
       AND (d.is_default OR lower(trim(extensions.unaccent(d.cabedal_color))) = v_color_norm)
     ORDER BY d.is_default ASC, d.id
     LIMIT 1;
    IF v_target_id IS NULL THEN
      SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
        INTO v_target_id, v_target_name, v_target_qty
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_group_id
         AND lower(trim(extensions.unaccent(p.color))) = v_color_norm
       LIMIT 1;
    END IF;
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
$function$
;
