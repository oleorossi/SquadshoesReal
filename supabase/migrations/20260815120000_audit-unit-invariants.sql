-- ============================================================================
-- P1.3 — audit_unit_invariants(): cobre os invariantes que audit_unit_divergences
--         estava CEGO (compra×estoque×rate, ficha trocada, preço placeholder)
-- ============================================================================
-- Em vez de reescrever a função grande (audit_unit_divergences), adiciona uma
-- função IRMÃ focada nos invariantes de UNIDADE DE COMPRA e cadastro, que o
-- diagnóstico não enxergava. Surfar em /diagnostics junto da outra.
--   A) purchase_order_unit ≠ unit AND conversion_rate = 1  → fator de conversão
--      FALTANDO (a OC sai rotulada errada; material de área não converte).
--   B) purchase_order_unit = unit AND conversion_rate ≠ 1  → fator ESPÚRIO.
--   C) component_sheets linear com dimensions_length > dimensions_width →
--      largura/comprimento provavelmente TROCADOS (mitigado por GREATEST, mas
--      sinaliza dado sujo).
--   D) material linear de napa/couro com unit_price < R$3/m → preço placeholder
--      (custo subestimado / margem inflada).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_unit_invariants()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_count int;
  v_examples jsonb;
BEGIN
  -- A) fator de conversão FALTANDO (units diferem mas rate=1)
  SELECT COUNT(*) INTO v_count FROM products
  WHERE purchase_order_unit IS NOT NULL AND purchase_order_unit <> unit AND COALESCE(conversion_rate,1) = 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',name,'value',unit||' -> '||purchase_order_unit) ORDER BY name),'[]'::jsonb)
  INTO v_examples FROM (
    SELECT id,name,unit,purchase_order_unit FROM products
    WHERE purchase_order_unit IS NOT NULL AND purchase_order_unit <> unit AND COALESCE(conversion_rate,1) = 1
    LIMIT 5) t;
  v_result := v_result || jsonb_build_object(
    'key','purchase_unit_missing_rate','table','products','field','conversion_rate',
    'severity', CASE WHEN v_count>0 THEN 'medium' ELSE 'ok' END,
    'description','Unidade de compra ≠ unidade de estoque mas conversion_rate=1 — fator faltando (OC mislabel / área não converte)',
    'expected','conversion_rate ≠ 1 quando purchase_order_unit ≠ unit',
    'count', v_count, 'examples', v_examples);

  -- B) fator ESPÚRIO (units iguais mas rate≠1)
  SELECT COUNT(*) INTO v_count FROM products
  WHERE purchase_order_unit = unit AND COALESCE(conversion_rate,1) <> 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',name,'value',conversion_rate) ORDER BY name),'[]'::jsonb)
  INTO v_examples FROM (
    SELECT id,name,conversion_rate FROM products
    WHERE purchase_order_unit = unit AND COALESCE(conversion_rate,1) <> 1
    LIMIT 5) t;
  v_result := v_result || jsonb_build_object(
    'key','purchase_unit_spurious_rate','table','products','field','conversion_rate',
    'severity', CASE WHEN v_count>0 THEN 'high' ELSE 'ok' END,
    'description','Unidade de compra = estoque mas conversion_rate ≠ 1 — fator espúrio (infla/desinfla compra)',
    'expected','conversion_rate = 1 quando purchase_order_unit = unit',
    'count', v_count, 'examples', v_examples);

  -- C) component_sheets linear com largura/comprimento trocados
  SELECT COUNT(*) INTO v_count
  FROM component_sheets cs JOIN products p ON p.id = cs.product_id
  WHERE LOWER(p.unit) IN ('m','cm','mm')
    AND COALESCE(cs.dimensions_length,0) > COALESCE(cs.dimensions_width,0)
    AND COALESCE(cs.dimensions_width,0) > 0;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',sub.id,'label',sub.name,'value',sub.dimensions_width||'x'||sub.dimensions_length) ORDER BY sub.name),'[]'::jsonb)
  INTO v_examples FROM (
    SELECT cs.id, p.name, cs.dimensions_width, cs.dimensions_length
    FROM component_sheets cs JOIN products p ON p.id = cs.product_id
    WHERE LOWER(p.unit) IN ('m','cm','mm')
      AND COALESCE(cs.dimensions_length,0) > COALESCE(cs.dimensions_width,0)
      AND COALESCE(cs.dimensions_width,0) > 0
    LIMIT 5) sub;
  v_result := v_result || jsonb_build_object(
    'key','component_sheet_dim_swapped','table','component_sheets','field','dimensions_width/length',
    'severity', CASE WHEN v_count>0 THEN 'low' ELSE 'ok' END,
    'description','Ficha linear com comprimento > largura — provável troca de campo (mitigado por GREATEST, mas dado sujo)',
    'expected','dimensions_width (largura da bobina) ≥ dimensions_length',
    'count', v_count, 'examples', v_examples);

  -- D) napa/couro linear com preço placeholder (< R$3/m)
  SELECT COUNT(*) INTO v_count FROM products
  WHERE LOWER(unit) = 'm' AND unit_price > 0 AND unit_price < 3
    AND (name ~* 'napa|couro|nobuck|nobuk|velvet|suede|pelo|glow');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',name,'value',unit_price) ORDER BY name),'[]'::jsonb)
  INTO v_examples FROM (
    SELECT id,name,unit_price FROM products
    WHERE LOWER(unit) = 'm' AND unit_price > 0 AND unit_price < 3
      AND (name ~* 'napa|couro|nobuck|nobuk|velvet|suede|pelo|glow')
    LIMIT 5) t;
  v_result := v_result || jsonb_build_object(
    'key','linear_material_price_placeholder','table','products','field','unit_price',
    'severity', CASE WHEN v_count>0 THEN 'high' ELSE 'ok' END,
    'description','Material de napa/couro em metro com preço < R$3/m — provável placeholder (custo subestimado, margem inflada)',
    'expected','preço por metro realista (tipicamente > R$5/m)',
    'count', v_count, 'examples', v_examples);

  RETURN jsonb_build_object('generated_at', now(), 'checks', v_result);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.audit_unit_invariants() TO authenticated;
