-- ════════════════════════════════════════════════════════════════════════════
-- Fix CRÍTICO (auditoria 2026-06-11) — Tema T1 (dm²→unidade física)
-- ════════════════════════════════════════════════════════════════════════════
-- O ramo `sheet_materials` (BOM) de check_stock_availability retornava
-- `v_required := calc_required_for_grade(...)` CRU em dm²/par para materiais de
-- ÁREA (napa/couro/forro), sem converter para a unidade física do produto (m,
-- placa). Apenas o ramo de tiras convertia (cm→m, ÷100). O `shortage`
-- (required − available) saía ~100× inflado e alimentava o auto-PO
-- (autoCreateMaterialPO em useSaleOrders.ts) → ordem de compra ~100× maior.
--
-- Correção: aplica a MESMA regra canônica da view purchase_projection_timeline /
-- helper get_material_conversion_info (e materialConsumption.ts no frontend):
--   • ÁREA → produto LINEAR (m/cm) com largura na ficha de componente:
--       required_físico = dm² / dm2_per_unit × (1 + waste%)
--   • ÁREA → produto PLACA com área da placa na ficha:
--       required_físico = dm² / area_da_placa_dm² × (1 + waste%)
--   • LINEAR direto sem ficha (conversion_warning ≠ NULL), CONTAGEM (un/par),
--       MASSA (kg/g) e dm² nativo: NÃO converte.
-- calc_required_for_grade NÃO aplica perda (só consumption × qty), então o
-- (1 + waste%) aqui não duplica perda — espelha exatamente a view.
-- Idempotente (CREATE OR REPLACE). Demais ramos (tiras) inalterados.

CREATE OR REPLACE FUNCTION public.check_stock_availability(p_reference_id uuid, p_order_quantity integer, p_color text DEFAULT ''::text, p_order_grade jsonb DEFAULT NULL::jsonb, p_strap_colors jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(product_id uuid, product_name text, required numeric, available numeric, sufficient boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  mat RECORD; v_required numeric; v_target_id uuid; v_target_name text; v_target_qty numeric;
  v_effective_straps jsonb; v_sheet_straps jsonb; v_strap jsonb; v_group_id uuid;
  v_color text; v_color_norm text; v_per_size jsonb; v_consumption numeric;
  v_size text; v_pairs numeric; v_cm_per_pair numeric; v_total_cm numeric; v_grade_total numeric; v_fichas numeric;
  v_conv RECORD; v_plate_area numeric;
BEGIN
  FOR mat IN
    SELECT sm.product_id, sm.quantity_per_unit, sm.consumption_per_size,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS current_stock, p.name, p.group_id, p.color AS product_color, lower(p.unit) AS product_unit
    FROM public.sheet_materials sm JOIN public.products p ON p.id = sm.product_id
   WHERE sm.sheet_id = p_reference_id
  LOOP
    v_required := public.calc_required_for_grade(mat.consumption_per_size, p_order_grade, mat.quantity_per_unit, p_order_quantity);
    v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;
    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) INTO v_target_id, v_target_name, v_target_qty
        FROM public.products p
       WHERE p.active = true AND p.color = p_color
         AND ((mat.group_id IS NOT NULL AND p.group_id = mat.group_id) OR (mat.group_id IS NULL AND p.name = mat.name))
       LIMIT 1;
      IF v_target_id IS NULL THEN
        v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;
      END IF;
    END IF;

    -- ── Conversão dm²→unidade física (regra canônica T1) ──────────────────────
    -- Mesma fórmula de purchase_projection_timeline / get_material_conversion_info.
    SELECT * INTO v_conv FROM public.get_material_conversion_info(v_target_id);
    IF v_conv.target_unit IN ('m','meters','metros','mt','cm')
       AND v_conv.conversion_warning IS NULL
       AND COALESCE(v_conv.dm2_per_unit, 0) > 0 THEN
      -- ÁREA → LINEAR (largura da ficha)
      v_required := (v_required / v_conv.dm2_per_unit) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    ELSIF mat.product_unit IN ('placa','placas') THEN
      -- ÁREA → PLACA (área da ficha)
      SELECT (
        (CASE LOWER(cs.dimensions_unit) WHEN 'cm' THEN cs.dimensions_width * 10
                                        WHEN 'm'  THEN cs.dimensions_width * 1000
                                        ELSE cs.dimensions_width END)
        *
        (CASE LOWER(cs.dimensions_unit) WHEN 'cm' THEN cs.dimensions_length * 10
                                        WHEN 'm'  THEN cs.dimensions_length * 1000
                                        ELSE cs.dimensions_length END)
      ) / 10000.0 INTO v_plate_area
      FROM public.component_sheets cs
      WHERE (cs.product_id = v_target_id OR cs.group_id = mat.group_id)
        AND COALESCE(cs.dimensions_width, 0)  > 0
        AND COALESCE(cs.dimensions_length, 0) > 0
      ORDER BY (cs.product_id = v_target_id) DESC
      LIMIT 1;
      IF COALESCE(v_plate_area, 0) > 0 THEN
        v_required := (v_required / v_plate_area) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
      END IF;
    END IF;

    product_id := v_target_id; product_name := v_target_name; required := v_required;
    available := v_target_qty; sufficient := (v_target_qty >= v_required);
    RETURN NEXT;
  END LOOP;

  IF p_strap_colors IS NOT NULL AND jsonb_typeof(p_strap_colors) = 'array' AND jsonb_array_length(p_strap_colors) > 0 THEN
    v_effective_straps := p_strap_colors;
  ELSE
    SELECT ts.strap_colors INTO v_sheet_straps FROM public.technical_sheets ts WHERE ts.id = p_reference_id;
    IF v_sheet_straps IS NULL OR jsonb_typeof(v_sheet_straps) <> 'array' OR jsonb_array_length(v_sheet_straps) = 0 THEN RETURN; END IF;
    SELECT jsonb_agg(CASE WHEN COALESCE(s ->> 'color', '') = '' AND p_color <> '' THEN s || jsonb_build_object('color', p_color) ELSE s END)
      INTO v_effective_straps FROM jsonb_array_elements(v_sheet_straps) AS s;
  END IF;
  IF v_effective_straps IS NULL THEN RETURN; END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(v_effective_straps) AS value LOOP
    v_color := v_strap ->> 'color';
    BEGIN v_group_id := (v_strap ->> 'group_id')::uuid; EXCEPTION WHEN OTHERS THEN v_group_id := NULL; END;
    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN CONTINUE; END IF;
    v_color_norm := lower(trim(extensions.unaccent(v_color)));
    v_per_size := v_strap -> 'consumption_per_size';
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 1);
    IF v_consumption <= 0 THEN v_consumption := 1; END IF;
    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object' AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0; v_grade_total := 0;
      FOR v_size, v_pairs IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;
      IF v_grade_total > 0 THEN v_fichas := GREATEST(1, ceil(p_order_quantity::numeric / v_grade_total)); ELSE v_fichas := 1; END IF;
      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      -- Não-graduado: consumption em cm/par → ÷100 p/ metros (unidade do produto-tira).
      v_required := (v_consumption * p_order_quantity) / 100;
    END IF;
    IF v_required <= 0 THEN CONTINUE; END IF;

    SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) INTO v_target_id, v_target_name, v_target_qty
      FROM public.products p
     WHERE p.active = true AND p.group_id = v_group_id AND lower(trim(extensions.unaccent(p.color))) = v_color_norm
     LIMIT 1;
    IF v_target_id IS NULL THEN
      SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) INTO v_target_id, v_target_name, v_target_qty
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_group_id AND (p.color IS NULL OR trim(p.color) = '')
       LIMIT 1;
    END IF;
    IF v_target_id IS NULL THEN
      product_id := NULL;
      product_name := COALESCE(NULLIF(trim(v_color), ''), 'tira') || ' (tira não cadastrada)';
      required := v_required; available := 0; sufficient := false;
      RETURN NEXT; CONTINUE;
    END IF;
    product_id := v_target_id; product_name := v_target_name; required := v_required;
    available := COALESCE(v_target_qty, 0); sufficient := (COALESCE(v_target_qty,0) >= v_required);
    RETURN NEXT;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.check_stock_availability(uuid, integer, text, jsonb, jsonb) IS
  'Disponibilidade de materiais por ficha. Ramo BOM converte dm²→unidade física '
  '(largura/área da ficha de componente) via get_material_conversion_info, igual à '
  'view purchase_projection_timeline e a materialConsumption.ts. Sem isso o auto-PO '
  'comprava ~100× material de área. Ramo de tiras converte cm→m (÷100).';
