-- 1. Função para resolver produto por material e cor
DROP FUNCTION IF EXISTS public.resolve_material_product(p_group_name text, p_color text, p_required numeric, p_check_stock boolean) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_material_product(p_group_name text, p_color text, p_required numeric DEFAULT 0, p_check_stock boolean DEFAULT false)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 1. Match exato por cor
  IF p_color IS NOT NULL AND p_color <> '' THEN
    RETURN QUERY
    SELECT p.id, p.name, p.quantity, 'exact_color'::text
    FROM products p
    JOIN product_groups pg ON pg.id = p.group_id
    WHERE p.active = true
      AND pg.name = p_group_name
      AND p.color = p_color
      AND (NOT p_check_stock OR p.quantity >= p_required)
    ORDER BY p.quantity DESC
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 2. Match parcial no nome
    RETURN QUERY
    SELECT p.id, p.name, p.quantity, 'partial_name'::text
    FROM products p
    JOIN product_groups pg ON pg.id = p.group_id
    WHERE p.active = true
      AND pg.name = p_group_name
      AND LOWER(p.name) LIKE '%' || LOWER(p_color) || '%'
      AND (NOT p_check_stock OR p_check_stock AND p.quantity >= p_required)
    ORDER BY p.quantity DESC
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 3. Fallback: qualquer produto ativo do grupo
  RETURN QUERY
  SELECT p.id, p.name, p.quantity, 'group_fallback'::text
  FROM products p
  JOIN product_groups pg ON pg.id = p.group_id
  WHERE p.active = true
    AND pg.name = p_group_name
    AND (NOT p_check_stock OR p.quantity >= p_required)
  ORDER BY p.quantity DESC
  LIMIT 1;
END;
$function$;

-- 2. Função de cálculo de consumo individual
DROP FUNCTION IF EXISTS public.calculate_order_consumption(p_reference_id uuid, p_order_quantity numeric, p_color text, p_size integer) CASCADE;
CREATE OR REPLACE FUNCTION public.calculate_order_consumption(p_reference_id uuid, p_order_quantity numeric, p_color text, p_size integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet              RECORD;
  v_sole_product_id    uuid;
  v_sole_color         text;
  v_spec               RECORD;
  v_result             jsonb := '[]'::jsonb;
  v_row                RECORD;
  v_item               jsonb;
  v_pid                uuid;
  v_consumption        numeric;
  v_required           numeric;
  v_resolved           RECORD;
  v_group_name         text;
  v_effective_size     integer;
  v_lining_consumption numeric;
  v_insole_consumption numeric;
  v_upper_consumption  numeric;
  v_covered_categories  text[]  := ARRAY[]::text[];
  v_covered_product_ids uuid[]  := ARRAY[]::uuid[];
  v_row_cat_norm       text;
  v_conv               RECORD;
  v_is_fachetado       boolean;
  v_fachete_consumption numeric;
  v_palmilha_color     text;
  v_insole_mode        text;
BEGIN
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  v_effective_size := COALESCE(p_size, v_sheet.reference_size, 37);

  -- Tenta resolver sola primeiro se houver lógica específica
  BEGIN
    SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
    FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));
  EXCEPTION WHEN OTHERS THEN
    v_sole_product_id := NULL;
  END;

  v_upper_consumption  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_effective_size::text))::numeric, 0), 0);
  v_lining_consumption := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);
  v_insole_consumption := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);

  IF (v_upper_consumption IS NULL OR v_lining_consumption IS NULL OR v_insole_consumption IS NULL)
     AND COALESCE(v_sheet.sole_drives_consumption, false) AND v_sole_product_id IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_spec FROM sole_technical_specs
      WHERE sole_id = v_sole_product_id AND size = v_effective_size;
      IF FOUND THEN
        IF v_upper_consumption  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper_consumption  := v_spec.upper_consumption_dm2;  END IF;
        IF v_lining_consumption IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining_consumption := v_spec.lining_consumption_dm2; END IF;
        IF v_insole_consumption IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole_consumption := v_spec.insole_consumption_dm2; END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  v_upper_consumption  := COALESCE(v_upper_consumption,  v_sheet.upper_consumption,  0);
  v_lining_consumption := COALESCE(v_lining_consumption, v_sheet.lining_consumption, 0);
  v_insole_consumption := COALESCE(v_insole_consumption, v_sheet.insole_consumption, 0);

  -- Montagem simplificada do JSON de resultado (foco nos materiais principais)
  IF v_sheet.upper_material IS NOT NULL THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    IF v_resolved.product_id IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'required_qty', v_upper_consumption * p_order_quantity,
        'category', 'Cabedal'
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

-- 3. Função de cálculo de consumo por grade
DROP FUNCTION IF EXISTS public.calculate_order_consumption_by_grade(p_reference_id uuid, p_grade jsonb, p_color text) CASCADE;
CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(p_reference_id uuid, p_grade jsonb, p_color text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_qty numeric := 0;
  v_result jsonb := '[]'::jsonb;
  v_size text;
  v_pairs numeric;
  v_item_cons jsonb;
BEGIN
  FOR v_size, v_pairs IN SELECT * FROM jsonb_each_text(p_grade)
  LOOP
    IF v_pairs::numeric > 0 THEN
      v_item_cons := calculate_order_consumption(p_reference_id, v_pairs::numeric, p_color, v_size::integer);
      v_result := v_result || v_item_cons;
    END IF;
  END LOOP;
  
  -- Agrupa o resultado por product_id
  RETURN (
    SELECT jsonb_agg(sub)
    FROM (
      SELECT product_id, product_name, category, SUM(required_qty) as total_required
      FROM jsonb_to_recordset(v_result) AS x(product_id uuid, product_name text, category text, required_qty numeric)
      GROUP BY product_id, product_name, category
    ) sub
  );
END;
$function$;