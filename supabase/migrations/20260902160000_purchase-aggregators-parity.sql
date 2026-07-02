-- ============================================================================
-- Paridade dos agregadores de compras com o motor by_grade (auditoria 2026-07-01)
-- ============================================================================
-- Achados CONFIRMADOS no banco vivo (ssvxfoybzmjlypnipqzn, 2026-07-02). Base de
-- TODAS as edições: pg_get_functiondef das funções VIVAS — NÃO os arquivos de
-- migration antigos do repo (o banco divergiu deles).
--
-- (a) ALTA  — check_stock_availability usava consumption_per_size do
--     sheet_materials (via calc_required_for_grade) enquanto by_grade/modal/
--     débito usam o ESCALAR quantity_per_unit. Per-size da cola está em
--     kg/cluster → 5000× (DS12: 168 kg vs 0,0336 kg). Essa checagem alimenta a
--     OC AUTOMÁTICA na aprovação do PV. FIX: escalar (quantity_per_unit × qty),
--     com conversão dm²→física via get_material_conversion_info (fórmula do
--     by_grade).
-- (b) MÉDIA — check_stock_availability só olhava BOM+tiras: cabedal/forro/
--     palmilha/fachete das SPECS da ficha ficavam FORA (NAPA SOFT: 20 fichas
--     via specs, 0 via BOM) → nem shortage nem auto-OC. FIX: com grade válida,
--     delega ao próprio calculate_order_consumption_by_grade (paridade por
--     construção) e soma por produto os componentes Cabedal/Forração/Palmilha/
--     Forração Palmilha/Fachete; sem grade, fallback escalar com os MESMOS
--     resolvers do by_grade. Linhas com conversion_warning (largura faltando =
--     valor ~100× em dm²) NÃO entram — senão a auto-OC compraria 100×; hoje
--     essas linhas já são invisíveis aqui, então não é regressão. Anti-join por
--     produto contra o loop de BOM (specs têm precedência, igual ao by_grade).
-- (c) —     check_stock_availability ganha p_packaging_mode (DEFAULT NULL) e
--     aplica a regra de filter_caixa_by_packaging_mode no loop de BOM (mesmos
--     helpers packaging_mode_collective_type/caixa_collective_type do custeio).
--     Sem o parâmetro, comportamento idêntico ao atual (conta as duas caixas).
--     ⚠ assinatura mudou (6º parâmetro) → DROP da versão de 5 args pra não
--     criar overload ambíguo no PostgREST.
-- (d) —     tira com cor VAZIA era skip silencioso no loop de tiras. FIX:
--     emite linha de warning (product_id NULL, sufficient=false) no padrão do
--     'tira não cadastrada' já existente — mesma paridade aplicada em
--     order_strap_needs pela migration 20260902130000.
-- (e) MÉDIA — fn_projected_demand (→ v_mrp_needs) não enxergava TIRAS. FIX:
--     agrega demanda via order_strap_needs por PV aberto (produto resolvido,
--     metros), como compute_materials_per_pv já faz. ⚠ A DISPONIBILIDADE do
--     v_mrp_needs continua BRUTA de propósito — só a demanda muda.
-- (f) MÉDIA — os 3 agregadores (fn_projected_demand, compute_materials_per_pv,
--     get_wave_material_needs) somavam linhas do by_grade com
--     conversion_warning como se fossem unidade física (largura faltando =
--     ~100×). FIX: essas linhas saem da qty comprável e o warning é propagado
--     numa coluna nova `conversion_warning` (o campo já existia no JSON do
--     by_grade). Linhas 100% warned continuam visíveis (needed 0 + warning).
-- (g) MÉDIA — compute_materials_per_pv netava demanda BRUTA contra estoque
--     LÍQUIDO das reservas do PRÓPRIO pedido (déficit inflado ao recomprar pra
--     um PV que já reservou). FIX: stock_qty = GREATEST(0, quantity −
--     reserved_stock + reservas_ativas_dos_próprios_PVs(product)).
-- (h) BAIXA — by_grade, bloco direct_components: usava estoque BRUTO no
--     stock_ok e não emitia 'unit' no JSON (sem 'unit', os agregadores dividiam
--     a linha por dm2_per_unit como se fosse dm²). FIX: available líquido
--     (quantity − reserved_stock) + 'unit' = unidade do produto.
-- (i) —     fn_projected_demand/compute_materials_per_pv/get_wave_material_needs
--     agora repassam sale_order_items.material_variant_id ao by_grade (que já
--     aceitava o 4º parâmetro e resolvia NULL como sem-variante).
-- (j) REPAIR — NULLa sheet_materials.consumption_per_size APENAS das 2 linhas
--     de cola confirmadas com per-size >100× o escalar (dados em kg/cluster):
--     ficha DS12 × COLA FORTE (0,25 vs 0,0018 = 139×) e DS12 × COLA PVC
--     (14 vs 0,0028 = 5000×). WHERE estrito por sheet_id/product_id + re-checa
--     a condição >100× (idempotente e no-op se alguém já corrigiu).
--
-- Assinaturas alteradas (DROP + CREATE): check_stock_availability (+1 arg),
-- fn_projected_demand / compute_materials_per_pv / get_wave_material_needs
-- (+1 coluna no fim do RETURNS TABLE). v_mrp_needs é recriada idêntica + coluna
-- `conversion_warning` (callers plpgsql — generate_purchase_orders_from_mrp,
-- suggest_pv_deadline — resolvem em runtime; coluna extra no fim é inócua).
-- ACLs re-aplicadas espelhando o banco vivo (anon SEM acesso, lockdown P0).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. calculate_order_consumption_by_grade — achado (h): direct_components com
--    estoque LÍQUIDO + 'unit' no JSON. Resto do corpo idêntico ao def vivo.
-- ────────────────────────────────────────────────────────────────────────────
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

  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id);
    v_upper_pid := v_resolved.product_id;
  END IF;

  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND COALESCE(v_sheet.insole_has_lining, true) = true THEN
    SELECT * INTO v_resolved FROM resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
    v_lining_pid := v_resolved.product_id;
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
      'source', CASE WHEN v_resolved.matched_by = 'variant' THEN 'variant' ELSE 'sheet_per_size' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning);
    v_covered_categories  := array_append(v_covered_categories,  'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

  IF v_lining_pid IS NOT NULL AND COALESCE((v_acc_lining->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_lining_pid);
    v_required := ((v_acc_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_result := v_result || jsonb_build_object(
      'component', 'Forração', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', CASE WHEN v_resolved.matched_by = 'variant' THEN 'variant' ELSE 'sheet_per_size' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning);
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
      'source', CASE WHEN v_resolved.matched_by = 'variant' THEN 'variant' ELSE 'sheet_per_size' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning);
    v_covered_categories  := array_append(v_covered_categories,  'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  IF NOT v_is_palmilha_pronta
     AND v_lining_pid IS NOT NULL
     AND COALESCE(v_sheet.insole_has_lining, true) = true
     AND COALESCE((v_acc_insole_lining->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_lining_pid);
    v_required := ((v_acc_insole_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_result := v_result || jsonb_build_object(
      'component', 'Forração Palmilha', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', 'insole_lining', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning);
    IF NOT (v_lining_pid = ANY(v_covered_product_ids)) THEN
      v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
    END IF;
  END IF;

  IF v_is_fachetado
     AND v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND COALESCE((v_acc_fachete->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
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
      'component', 'Fachete', 'product_id', NULL, 'product_name', COALESCE(v_sheet.lining_material, 'forro do fachete'),
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

  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * v_total_qty;
        IF v_required > 0 THEN
          -- Achado (h) auditoria 2026-07-01: disponível LÍQUIDO (quantity −
          -- reserved_stock, como as demais linhas) + 'unit' no JSON (sem ela
          -- os agregadores tratavam a linha como dm² e dividiam por
          -- dm2_per_unit — componente direto já está na unidade nativa).
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
    SELECT sm.product_id, sm.quantity_per_unit, p.name,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
           p.category, p.color AS product_color
      FROM sheet_materials sm JOIN products p ON p.id = sm.product_id
     WHERE sm.sheet_id = p_reference_id AND p.active = true
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

  IF COALESCE(v_sheet.insole_has_lining, true) = true
     AND v_sheet.lining_accessories IS NOT NULL AND jsonb_typeof(v_sheet.lining_accessories) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.lining_accessories) AS value LOOP
      v_group_name  := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * v_total_qty;
      SELECT * INTO v_resolved FROM resolve_material_product(v_group_name, p_color, v_required, false);
      IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_covered_product_ids)) THEN
        SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
        v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
        v_result := v_result || jsonb_build_object(
          'component', 'Forração (alternativa)', 'product_id', v_resolved.product_id,
          'product_name', v_resolved.product_name, 'color', p_color,
          'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required,
          'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required,
          'debit_mode', 'soft', 'source', 'lining_accessory', 'matched_by', v_resolved.matched_by,
          'unit', v_conv.target_unit, 'conversion_warning', v_conv.conversion_warning);
        v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
      END IF;
    END LOOP;
  END IF;

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


-- ────────────────────────────────────────────────────────────────────────────
-- 2. check_stock_availability — achados (a) escalar, (b) specs da ficha,
--    (c) filtro de caixa por packaging_mode, (d) warning de tira sem cor.
--    Assinatura ganha p_packaging_mode → DROP da versão antiga (evita overload
--    ambíguo no PostgREST).
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.check_stock_availability(uuid, integer, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.check_stock_availability(
  p_reference_id uuid,
  p_order_quantity integer,
  p_color text DEFAULT ''::text,
  p_order_grade jsonb DEFAULT NULL::jsonb,
  p_strap_colors jsonb DEFAULT NULL::jsonb,
  p_packaging_mode text DEFAULT NULL::text
)
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
        v_cons := public.calculate_order_consumption_by_grade(
          p_reference_id, p_order_grade, COALESCE(p_color, ''), NULL);
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
          NULL::uuid, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id);
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
      IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
         AND COALESCE(v_sheet.insole_has_lining, true) = true THEN
        SELECT * INTO v_resolved FROM public.resolve_lining_material_for_variant(
          NULL::uuid, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
        IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
          v_lining_total := COALESCE(v_sheet.lining_consumption, 0);
          IF NOT v_is_palmilha_pronta THEN
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
          NULL::uuid, v_sheet.insole_material, v_palmilha_color, 0);
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
              FROM public.sheet_materials sm
              JOIN public.products p ON p.id = sm.product_id
             WHERE sm.sheet_id = p_reference_id) s
      WHERE s.t IS NOT NULL;
      v_apply_caixa := v_caixa_types IS NOT NULL
        AND array_length(v_caixa_types, 1) >= 2
        AND v_caixa_target = ANY(v_caixa_types);
    END IF;
  END IF;

  FOR mat IN
    SELECT sm.product_id, sm.quantity_per_unit,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
   WHERE sm.sheet_id = p_reference_id
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

-- ACL espelhando o banco vivo (lockdown P0: anon sem EXECUTE)
REVOKE ALL ON FUNCTION public.check_stock_availability(uuid, integer, text, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_stock_availability(uuid, integer, text, jsonb, jsonb, text) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. fn_projected_demand — achados (e) tiras, (f) conversion_warning fora da
--    soma, (i) material_variant_id. RETURNS TABLE ganha coluna no fim →
--    DROP da view dependente + DROP FUNCTION + recreate de ambas.
--    ⚠ v_mrp_needs continua com disponibilidade BRUTA de propósito (memória
--    project_v_mrp_needs_gross_is_correct) — NADA muda na disponibilidade.
-- ────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_mrp_needs;
DROP FUNCTION IF EXISTS public.fn_projected_demand();

CREATE FUNCTION public.fn_projected_demand()
 RETURNS TABLE(product_id uuid, product_name text, total_required numeric, earliest_deadline date, orders_count integer, order_ids uuid[], conversion_warning text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT so.id AS sale_order_id, so.delivery_deadline, soi.id AS sale_order_item_id,
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption_by_grade(
          soi.reference_id,
          public.scale_grade_to_total(soi.grade, soi.quantity),
          COALESCE(soi.color, ''),
          soi.material_variant_id            -- achado (i): variante do PV
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE so.status NOT IN ('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado','Expedido','Concluído')
      AND soi.reference_id IS NOT NULL
      AND soi.grade IS NOT NULL
      AND jsonb_typeof(soi.grade) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(soi.grade) g
        WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND (g.value)::numeric > 0
      )
  ),
  exploded AS (
    SELECT sale_order_id, delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name') AS product_name,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit') AS unit,
      (line ->> 'conversion_warning') AS conversion_warning
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  ),
  -- Achado (e): TIRAS não apareciam na demanda projetada (→ v_mrp_needs) —
  -- mesma agregação de compute_materials_per_pv: order_strap_needs por PV
  -- aberto, produto resolvido, metros já na unidade física.
  strap_exploded AS (
    SELECT so.id AS sale_order_id, so.delivery_deadline,
      sn.product_id, sn.product_name,
      sn.required_m AS required,
      'm'::text AS unit,
      NULL::text AS conversion_warning
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    CROSS JOIN LATERAL public.order_strap_needs(soi.strap_colors, soi.quantity::numeric, soi.grade) sn
    WHERE so.status NOT IN ('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado','Expedido','Concluído')
      AND sn.product_id IS NOT NULL
      AND sn.required_m > 0
  ),
  all_exploded AS (
    SELECT * FROM exploded
    UNION ALL
    SELECT * FROM strap_exploded
  )
  SELECT
    e.product_id,
    MAX(e.product_name) AS product_name,
    -- Achado (f): linhas com conversion_warning (largura faltando = valor
    -- ~100× em dm²) NÃO entram na qty comprável; o warning vai na coluna nova.
    COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL AND e.conversion_warning IS NULL), 0)
      / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(e.product_id) conv LIMIT 1), 1), 1)
    + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL AND e.conversion_warning IS NULL), 0) AS total_required,
    MIN(e.delivery_deadline) AS earliest_deadline,
    COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
    array_agg(DISTINCT e.sale_order_id) AS order_ids,
    MAX(e.conversion_warning) AS conversion_warning
  FROM all_exploded e
  WHERE e.product_id IS NOT NULL
  GROUP BY e.product_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projected_demand() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projected_demand() TO authenticated, service_role;

-- v_mrp_needs recriada IDÊNTICA ao def vivo + coluna conversion_warning no fim.
-- Disponibilidade continua BRUTA (on_hand = p.quantity) DE PROPÓSITO.
-- `OR d.conversion_warning IS NOT NULL` mantém visível o material cuja demanda
-- ficou 100% warned (total_required 0) — senão o aviso sumiria da tela de MRP.
CREATE VIEW public.v_mrp_needs AS
WITH demand AS (
  SELECT d.product_id, d.product_name, d.total_required, d.earliest_deadline,
         d.orders_count, d.order_ids, d.conversion_warning
  FROM public.fn_projected_demand() d
), po_open AS (
  SELECT poi.product_id, sum(poi.quantity) AS qty_in_pipeline
  FROM public.purchase_order_items poi
  JOIN public.purchase_orders po_1 ON po_1.id = poi.purchase_order_id
  WHERE po_1.status <> ALL (ARRAY['cancelled'::text, 'received'::text, 'suggested'::text])
  GROUP BY poi.product_id
), reserved AS (
  SELECT mr.product_id, sum(mr.quantity_reserved - mr.quantity_consumed) AS qty_reserved
  FROM public.material_reservations mr
  WHERE mr.status = ANY (ARRAY['reserved'::text, 'partially_consumed'::text])
  GROUP BY mr.product_id
), wave_deadline AS (
  SELECT sm.product_id, min(pw.purchase_deadline) AS wave_purchase_deadline
  FROM public.production_waves pw
  JOIN public.production_wave_items pwi ON pwi.wave_id = pw.id
  JOIN public.production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
  JOIN public.sale_order_items soi ON soi.id = pwis.sale_order_item_id
  JOIN public.sheet_materials sm ON sm.sheet_id = soi.reference_id
  WHERE (pw.status::text <> ALL (ARRAY['finished'::text, 'cancelled'::text]))
    AND pw.purchase_deadline IS NOT NULL
  GROUP BY sm.product_id
)
SELECT p.id AS product_id,
       p.name AS product_name,
       p.sku,
       p.category,
       p.unit,
       p.unit_price,
       p.purchase_order_unit,
       COALESCE(p.conversion_rate, 1::numeric) AS conversion_rate,
       p.min_order_quantity,
       p.lead_time_days,
       p.preferred_supplier_id,
       s.name AS supplier_name,
       p.min_stock,
       p.quantity AS on_hand,
       COALESCE(r.qty_reserved, 0::numeric) AS reserved,
       GREATEST(p.quantity - COALESCE(r.qty_reserved, 0::numeric), 0::numeric) AS available_now,
       COALESCE(po.qty_in_pipeline, 0::numeric) AS qty_in_po,
       COALESCE(d.total_required, 0::numeric) AS projected_demand,
       d.earliest_deadline,
       d.orders_count,
       GREATEST(COALESCE(d.total_required, 0::numeric) + p.min_stock - p.quantity - COALESCE(po.qty_in_pipeline, 0::numeric), 0::numeric) AS suggested_qty,
       COALESCE(wd.wave_purchase_deadline, public.add_business_days(d.earliest_deadline, - COALESCE(p.lead_time_days, 0))) AS order_by_date,
       d.conversion_warning
FROM public.products p
LEFT JOIN demand d ON d.product_id = p.id
LEFT JOIN po_open po ON po.product_id = p.id
LEFT JOIN reserved r ON r.product_id = p.id
LEFT JOIN wave_deadline wd ON wd.product_id = p.id
LEFT JOIN public.suppliers s ON s.id = p.preferred_supplier_id
WHERE COALESCE(d.total_required, 0::numeric) > 0::numeric
   OR p.quantity < p.min_stock
   OR d.conversion_warning IS NOT NULL;

-- ACL da view espelhando o banco vivo (anon ficou SEM SELECT no lockdown P0)
GRANT ALL ON public.v_mrp_needs TO authenticated, service_role;
REVOKE SELECT ON public.v_mrp_needs FROM anon;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. compute_materials_per_pv — achados (f) conversion_warning fora da soma,
--    (g) reservas do próprio pedido de volta no stock_qty, (i) variante.
--    RETURNS TABLE ganha coluna no fim → DROP + CREATE.
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.compute_materials_per_pv(uuid[]);

CREATE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
 RETURNS TABLE(material_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, last_unit_price numeric, is_artisanal boolean, grade jsonb, color_mismatch boolean, conversion_warning text)
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH item_cons AS (
    SELECT soi.grade AS item_grade,
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption_by_grade(
          soi.reference_id,
          public.scale_grade_to_total(soi.grade, soi.quantity),
          COALESCE(soi.color, ''),
          soi.material_variant_id            -- achado (i): variante do PV
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND soi.reference_id IS NOT NULL
      AND soi.grade IS NOT NULL
      AND jsonb_typeof(soi.grade) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(soi.grade) g
        WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND (g.value)::numeric > 0
      )
  ),
  exploded AS (
    SELECT
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')     AS product_name,
      CASE WHEN (line ->> 'matched_by') = 'group_generic' THEN ''
           ELSE COALESCE(line ->> 'color', '') END AS color,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit')             AS unit,
      (line ->> 'component')        AS component,
      (line ->> 'matched_by')       AS matched_by,
      (line ->> 'conversion_warning') AS conversion_warning,
      ic.item_grade
    FROM item_cons ic, jsonb_array_elements(ic.cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    SELECT sn.product_id, sn.product_name, COALESCE(sn.color, '') AS color,
           sn.required_m AS required, 'm'::text AS unit,
           NULL::text AS conversion_warning
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    CROSS JOIN LATERAL public.order_strap_needs(soi.strap_colors, soi.quantity::numeric, soi.grade) sn
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND sn.product_id IS NOT NULL
  ),
  all_exploded AS (
    SELECT product_id, product_name, color, required, unit, conversion_warning FROM exploded
    UNION ALL
    SELECT product_id, product_name, color, required, unit, conversion_warning FROM strap_exploded
  ),
  agg AS (
    SELECT e.product_id, e.color, MAX(e.product_name) AS product_name,
      -- Achado (f): linhas com conversion_warning NÃO entram na qty comprável
      COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL AND e.conversion_warning IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit
                               FROM public.get_material_conversion_info(e.product_id) conv
                              LIMIT 1), 1), 1)
      + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL AND e.conversion_warning IS NULL), 0) AS needed_qty,
      MAX(e.conversion_warning) AS conversion_warning
    FROM all_exploded e
    GROUP BY e.product_id, e.color
  ),
  resolved AS (
    SELECT
      COALESCE(bp.id, a.product_id) AS product_id,
      a.color,
      CASE WHEN bp.id IS NOT NULL AND ar.yield_per_meter > 0
           THEN a.needed_qty / ar.yield_per_meter
           ELSE a.needed_qty END AS needed_qty,
      a.conversion_warning
    FROM agg a
    LEFT JOIN public.products ap ON ap.id = a.product_id
    LEFT JOIN public.product_groups apg ON apg.id = ap.group_id
    LEFT JOIN public.artisanal_recipes ar
           ON COALESCE(ap.is_artisanal, false) = true AND ar.active = true
          AND apg.id IS NOT NULL
          AND lower(trim(unaccent(ar.artisanal_product_name))) = lower(trim(unaccent(apg.name)))
    LEFT JOIN public.product_groups bpg
           ON ar.id IS NOT NULL
          AND lower(trim(unaccent(bpg.name))) = lower(trim(unaccent(ar.base_product_name)))
    LEFT JOIN LATERAL (
      SELECT bp2.id
        FROM public.products bp2
       WHERE ar.id IS NOT NULL AND bp2.active = true
         AND (bp2.group_id = bpg.id
              OR lower(trim(unaccent(bp2.name))) = lower(trim(unaccent(ar.base_product_name))))
         AND (a.color = ''
              OR lower(unaccent(COALESCE(bp2.color, ''))) = lower(unaccent(a.color)))
       ORDER BY (bp2.group_id = bpg.id) DESC NULLS LAST, bp2.quantity DESC NULLS LAST
       LIMIT 1
    ) bp ON true
  ),
  rolled AS (
    SELECT product_id, color, SUM(needed_qty) AS needed_qty,
           MAX(conversion_warning) AS conversion_warning
    FROM resolved
    GROUP BY product_id, color
  ),
  -- Achado (g): reservas ATIVAS dos PRÓPRIOS PVs consultados voltam pro
  -- estoque disponível — a demanda aqui é BRUTA (consumo total do PV), então
  -- netar contra estoque já descontado das reservas DESSES MESMOS PVs
  -- inflava o déficit (mandava recomprar o que o próprio pedido já reservou).
  own_res AS (
    SELECT mr.product_id,
           SUM(GREATEST(0, COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0))) AS own_reserved
    FROM public.material_reservations mr
    JOIN public.orders o ON o.id = mr.order_id
    WHERE o.sale_order_id = ANY(p_pv_ids)
      AND mr.status IN ('reserved', 'partially_consumed')
    GROUP BY mr.product_id
  ),
  mism AS (
    SELECT product_id, color, bool_or(matched_by = 'color_mismatch') AS color_mismatch
    FROM exploded GROUP BY product_id, color
  ),
  solado_grade AS (
    SELECT product_id, color, jsonb_object_agg(k, v) AS grade FROM (
      SELECT e.product_id, e.color, kv.key AS k,
             round(SUM((kv.value::numeric) * e.required / NULLIF(gs.total, 0))) AS v
      FROM exploded e
      CROSS JOIN LATERAL (
        SELECT SUM(x.value::numeric) AS total
        FROM jsonb_each_text(e.item_grade) x WHERE x.key ~ '^[0-9/]+$'
      ) gs
      , jsonb_each_text(e.item_grade) kv
      WHERE e.component = 'Solado' AND e.item_grade IS NOT NULL
        AND kv.key ~ '^[0-9/]+$' AND COALESCE(gs.total, 0) > 0
      GROUP BY e.product_id, e.color, kv.key
    ) g WHERE v > 0 GROUP BY product_id, color
  )
  SELECT
    r.product_id                  AS material_id,
    COALESCE(p.name, r.product_id::text) AS product_name,
    COALESCE(p.unit, 'un')        AS unit,
    r.color,
    r.needed_qty,
    GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0) + COALESCE(orr.own_reserved, 0)) AS stock_qty,
    GREATEST(0, r.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0) + COALESCE(orr.own_reserved, 0))) AS shortage,
    p.supplier_id,
    sup.name                      AS supplier_name,
    COALESCE(p.unit_price, 0)     AS last_unit_price,
    COALESCE(p.is_artisanal, false) AS is_artisanal,
    sg.grade,
    COALESCE(m.color_mismatch, false) AS color_mismatch,
    r.conversion_warning
  FROM rolled r
  LEFT JOIN public.products p   ON p.id = r.product_id
  LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  LEFT JOIN own_res orr ON orr.product_id = r.product_id
  LEFT JOIN solado_grade sg ON sg.product_id = r.product_id AND sg.color = r.color
  LEFT JOIN mism m ON m.product_id = r.product_id AND m.color = r.color
  -- Achado (f): linha 100% warned (needed 0) continua visível pra propagar o aviso
  WHERE r.needed_qty > 0 OR r.conversion_warning IS NOT NULL
  ORDER BY sup.name NULLS LAST, COALESCE(p.name, r.product_id::text);
$function$;

GRANT EXECUTE ON FUNCTION public.compute_materials_per_pv(uuid[]) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. get_wave_material_needs — achados (f) conversion_warning fora da soma,
--    (i) variante. RETURNS TABLE ganha coluna no fim → DROP + CREATE.
--    (suggest_pv_deadline consome via plpgsql — resolve em runtime, coluna
--    extra no fim é inócua.)
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_wave_material_needs(uuid[]);

CREATE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
 RETURNS TABLE(product_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text, base_product_id uuid, base_product_name text, base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric, os_send_date date, conversion_warning text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_palmilha_start_date INTO v_corte_start
    FROM public.compute_wave_timeline(p_sale_order_ids) t LIMIT 1;

  RETURN QUERY
  WITH
  items_with_cons AS (
    SELECT COALESCE(public.filter_caixa_by_packaging_mode(
      public.calculate_order_consumption_by_grade(
        soi.reference_id,
        public.scale_grade_to_total(soi.grade, soi.quantity),
        COALESCE(soi.color, ''),
        soi.material_variant_id              -- achado (i): variante do PV
      ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND soi.reference_id IS NOT NULL
      AND soi.grade IS NOT NULL
      AND jsonb_typeof(soi.grade) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(soi.grade) g
        WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND (g.value)::numeric > 0
      )
  ),
  exploded AS (
    SELECT (line ->> 'product_id')::uuid AS product_id,
           COALESCE(line ->> 'color', '') AS effective_color,
           (line ->> 'required')::numeric AS required,
           (line ->> 'unit') AS unit,
           (line ->> 'conversion_warning') AS conversion_warning
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    SELECT sn.product_id,
           COALESCE(sn.color, '') AS effective_color,
           sn.required_m AS required,
           'm'::text AS unit,
           NULL::text AS conversion_warning
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    CROSS JOIN LATERAL public.order_strap_needs(soi.strap_colors, soi.quantity::numeric, soi.grade) sn
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND sn.product_id IS NOT NULL
  ),
  all_exploded AS (
    SELECT * FROM exploded
    UNION ALL
    SELECT * FROM strap_exploded
  ),
  needed AS (
    SELECT product_id, effective_color,
      -- Achado (f): linhas com conversion_warning NÃO entram na qty comprável
      COALESCE(SUM(required) FILTER (WHERE unit IS NULL AND conversion_warning IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(product_id) conv LIMIT 1), 1), 1)
      + COALESCE(SUM(required) FILTER (WHERE unit IS NOT NULL AND conversion_warning IS NULL), 0) AS needed_qty,
      MAX(conversion_warning) AS conversion_warning
    FROM all_exploded
    GROUP BY product_id, effective_color
  ),
  enriched AS (
    SELECT n.product_id, p.name AS product_name, p.group_id AS group_id, COALESCE(p.unit,'un') AS unit,
           n.effective_color AS color, n.needed_qty,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
           GREATEST(0, n.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
           p.supplier_id, sup.name AS supplier_name,
           COALESCE(p.supplier_lead_time_days, 10)::int AS supplier_lead_time_days,
           COALESCE(p.is_artisanal, false) AS is_artisanal,
           n.conversion_warning
      FROM needed n
      JOIN public.products p ON p.id = n.product_id
      LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
     -- Achado (f): linha 100% warned (needed 0) continua visível pra propagar o aviso
     WHERE n.needed_qty > 0 OR n.conversion_warning IS NOT NULL
  )
  SELECT e.product_id, e.product_name, e.unit, e.color, e.needed_qty, e.stock_qty,
         e.shortage, e.supplier_id, e.supplier_name, e.supplier_lead_time_days,
         e.is_artisanal,
         ar.id AS artisanal_recipe_id, ar.name AS artisanal_recipe_name,
         bp.id AS base_product_id, ar.base_product_name,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
              THEN ROUND(e.needed_qty / ar.yield_per_meter, 3) ELSE NULL END AS base_needed_qty,
         bp.quantity AS base_stock_qty,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
              THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity)
              ELSE NULL END AS base_shortage,
         CASE WHEN e.is_artisanal AND v_corte_start IS NOT NULL
              THEN (v_corte_start - 7)::date ELSE NULL END AS os_send_date,
         e.conversion_warning
    FROM enriched e
    LEFT JOIN public.product_groups epg ON epg.id = e.group_id
    LEFT JOIN public.artisanal_recipes ar
           ON e.is_artisanal = true AND ar.active = true
          AND epg.id IS NOT NULL
          AND lower(trim(unaccent(ar.artisanal_product_name))) = lower(trim(unaccent(epg.name)))
    LEFT JOIN public.product_groups bpg
           ON ar.id IS NOT NULL
          AND lower(trim(unaccent(bpg.name))) = lower(trim(unaccent(ar.base_product_name)))
    LEFT JOIN LATERAL (
      SELECT bp2.id, bp2.quantity
        FROM public.products bp2
       WHERE ar.id IS NOT NULL AND bp2.active = true
         AND (bp2.group_id = bpg.id
              OR lower(trim(unaccent(bp2.name))) = lower(trim(unaccent(ar.base_product_name))))
         AND (e.color = ''
              OR lower(unaccent(COALESCE(bp2.color,''))) = lower(unaccent(e.color)))
       ORDER BY (bp2.group_id = bpg.id) DESC NULLS LAST, bp2.quantity DESC NULLS LAST
       LIMIT 1
    ) bp ON true
   ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_wave_material_needs(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_wave_material_needs(uuid[]) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. REPAIR (j) — per-size de cola em kg/cluster (>100× o escalar) vira NULL.
--    Listado no banco vivo em 2026-07-02 (exatamente 2 linhas, ambas na ficha
--    DS12 3040c4db-94d5-4ba1-80b3-f3cba8511186):
--      • COLA FORTE fbbe0f31-90f9-4685-9f7c-fae261617db0 — escalar 0.0018,
--        per-size 0.25 em 34–40 (139×)
--      • COLA PVC   66b39bc6-fa22-4b10-bc82-19cb49ed44d2 — escalar 0.0028,
--        per-size 14 em 34–40 (5000× — o caso "168 kg vs 0,0336 kg")
--    WHERE estrito por (sheet_id, product_id) + re-checa a condição >100×:
--    idempotente e no-op se os dados já tiverem sido corrigidos manualmente.
--    O consumo dessas linhas volta a sair do escalar quantity_per_unit (fonte
--    correta), o mesmo usado por by_grade/débito e — após esta migration —
--    também por check_stock_availability.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.sheet_materials sm
SET consumption_per_size = NULL
WHERE sm.sheet_id = '3040c4db-94d5-4ba1-80b3-f3cba8511186'::uuid
  AND sm.product_id IN (
    'fbbe0f31-90f9-4685-9f7c-fae261617db0'::uuid,  -- COLA FORTE
    '66b39bc6-fa22-4b10-bc82-19cb49ed44d2'::uuid   -- COLA PVC
  )
  AND sm.consumption_per_size IS NOT NULL
  AND jsonb_typeof(sm.consumption_per_size) = 'object'
  AND COALESCE(sm.quantity_per_unit, 0) > 0
  AND EXISTS (
    SELECT 1 FROM jsonb_each_text(sm.consumption_per_size) e
    WHERE e.value ~ '^[0-9]+([.,][0-9]+)?$'
      AND replace(e.value, ',', '.')::numeric > 100 * sm.quantity_per_unit
  );
