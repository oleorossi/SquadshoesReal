CREATE OR REPLACE FUNCTION public.audit_unit_divergences()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_units text[] := ARRAY['kg','g','mg','L','ml','m','cm','mm','m²','dm²','cm²','un','par','cx','pc','rolo','folha','chapa','jg'];
  v_result jsonb := '[]'::jsonb;
  v_count int;
  v_examples jsonb;
BEGIN
  -- 1) products.unit fora do canônico
  SELECT COUNT(*) INTO v_count FROM products
  WHERE unit IS NULL OR unit = '' OR NOT (unit = ANY(v_canonical_units));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',name,'value',unit) ORDER BY name), '[]'::jsonb)
  INTO v_examples
  FROM (
    SELECT id, name, unit FROM products
    WHERE unit IS NULL OR unit = '' OR NOT (unit = ANY(v_canonical_units))
    LIMIT 5
  ) t;

  v_result := v_result || jsonb_build_object(
    'key','products_invalid_unit',
    'table','products',
    'field','unit',
    'severity', CASE WHEN v_count > 0 THEN 'high' ELSE 'ok' END,
    'description','Produtos com unidade vazia ou fora da lista canônica aceita pelo frontend',
    'expected','um valor de: ' || array_to_string(v_canonical_units, ', '),
    'count', v_count,
    'examples', v_examples
  );

  -- 2) technical_sheets: upper_consumption suspeito (< 1 dm²/par)
  SELECT COUNT(*) INTO v_count FROM technical_sheets
  WHERE upper_consumption IS NOT NULL AND upper_consumption > 0 AND upper_consumption < 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',name,'value',upper_consumption) ORDER BY name), '[]'::jsonb)
  INTO v_examples
  FROM (
    SELECT id, name, upper_consumption FROM technical_sheets
    WHERE upper_consumption IS NOT NULL AND upper_consumption > 0 AND upper_consumption < 1
    LIMIT 5
  ) t;

  v_result := v_result || jsonb_build_object(
    'key','tech_sheets_upper_lt1',
    'table','technical_sheets',
    'field','upper_consumption',
    'severity', CASE WHEN v_count > 0 THEN 'medium' ELSE 'ok' END,
    'description','Consumo de cabedal menor que 1 — provável valor em m² gravado em campo dm²/par',
    'expected','dm²/par (tipicamente entre 1 e 30)',
    'count', v_count,
    'examples', v_examples
  );

  -- 3) technical_sheets: insole_consumption suspeito (< 1)
  SELECT COUNT(*) INTO v_count FROM technical_sheets
  WHERE insole_consumption IS NOT NULL AND insole_consumption > 0 AND insole_consumption < 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',name,'value',insole_consumption) ORDER BY name), '[]'::jsonb)
  INTO v_examples
  FROM (
    SELECT id, name, insole_consumption FROM technical_sheets
    WHERE insole_consumption IS NOT NULL AND insole_consumption > 0 AND insole_consumption < 1
    LIMIT 5
  ) t;

  v_result := v_result || jsonb_build_object(
    'key','tech_sheets_insole_lt1',
    'table','technical_sheets',
    'field','insole_consumption',
    'severity', CASE WHEN v_count > 0 THEN 'medium' ELSE 'ok' END,
    'description','Consumo de palmilha menor que 1 — provável valor em m² gravado em campo dm²/par',
    'expected','dm²/par (tipicamente entre 1 e 10)',
    'count', v_count,
    'examples', v_examples
  );

  -- 4) technical_sheets: lining_consumption suspeito (< 1)
  SELECT COUNT(*) INTO v_count FROM technical_sheets
  WHERE lining_consumption IS NOT NULL AND lining_consumption > 0 AND lining_consumption < 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',name,'value',lining_consumption) ORDER BY name), '[]'::jsonb)
  INTO v_examples
  FROM (
    SELECT id, name, lining_consumption FROM technical_sheets
    WHERE lining_consumption IS NOT NULL AND lining_consumption > 0 AND lining_consumption < 1
    LIMIT 5
  ) t;

  v_result := v_result || jsonb_build_object(
    'key','tech_sheets_lining_lt1',
    'table','technical_sheets',
    'field','lining_consumption',
    'severity', CASE WHEN v_count > 0 THEN 'medium' ELSE 'ok' END,
    'description','Consumo de forro menor que 1 — provável valor em m² gravado em campo dm²/par',
    'expected','dm²/par (tipicamente entre 1 e 10)',
    'count', v_count,
    'examples', v_examples
  );

  -- 5) technical_sheets: sole_consumption fora de [0.5 .. 2]
  SELECT COUNT(*) INTO v_count FROM technical_sheets
  WHERE sole_consumption IS NOT NULL AND (sole_consumption > 2 OR (sole_consumption > 0 AND sole_consumption < 0.5));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',name,'value',sole_consumption) ORDER BY name), '[]'::jsonb)
  INTO v_examples
  FROM (
    SELECT id, name, sole_consumption FROM technical_sheets
    WHERE sole_consumption IS NOT NULL AND (sole_consumption > 2 OR (sole_consumption > 0 AND sole_consumption < 0.5))
    LIMIT 5
  ) t;

  v_result := v_result || jsonb_build_object(
    'key','tech_sheets_sole_out_of_range',
    'table','technical_sheets',
    'field','sole_consumption',
    'severity', CASE WHEN v_count > 0 THEN 'high' ELSE 'ok' END,
    'description','Consumo de solado fora do intervalo esperado — solado é sempre 1 par por par',
    'expected','1 par/par (regra fixa)',
    'count', v_count,
    'examples', v_examples
  );

  -- 6) sole_technical_specs: lining_consumption_dm2 suspeito (< 1)
  SELECT COUNT(*) INTO v_count FROM sole_technical_specs
  WHERE lining_consumption_dm2 IS NOT NULL AND lining_consumption_dm2 > 0 AND lining_consumption_dm2 < 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',sts.id,'label',COALESCE(p.name,'Solado '||sts.sole_id::text)||' tam '||sts.size::text,'value',sts.lining_consumption_dm2)), '[]'::jsonb)
  INTO v_examples
  FROM (
    SELECT id, sole_id, size, lining_consumption_dm2 FROM sole_technical_specs
    WHERE lining_consumption_dm2 IS NOT NULL AND lining_consumption_dm2 > 0 AND lining_consumption_dm2 < 1
    LIMIT 5
  ) sts
  LEFT JOIN products p ON p.id = sts.sole_id;

  v_result := v_result || jsonb_build_object(
    'key','sole_specs_lining_lt1',
    'table','sole_technical_specs',
    'field','lining_consumption_dm2',
    'severity', CASE WHEN v_count > 0 THEN 'medium' ELSE 'ok' END,
    'description','Especificação por tamanho com consumo de forro menor que 1 — provável valor em m² no campo dm²',
    'expected','dm² por par (tipicamente entre 1 e 10)',
    'count', v_count,
    'examples', v_examples
  );

  -- 7) sole_technical_specs: insole_consumption_dm2 suspeito
  SELECT COUNT(*) INTO v_count FROM sole_technical_specs
  WHERE insole_consumption_dm2 IS NOT NULL AND insole_consumption_dm2 > 0 AND insole_consumption_dm2 < 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',sts.id,'label',COALESCE(p.name,'Solado '||sts.sole_id::text)||' tam '||sts.size::text,'value',sts.insole_consumption_dm2)), '[]'::jsonb)
  INTO v_examples
  FROM (
    SELECT id, sole_id, size, insole_consumption_dm2 FROM sole_technical_specs
    WHERE insole_consumption_dm2 IS NOT NULL AND insole_consumption_dm2 > 0 AND insole_consumption_dm2 < 1
    LIMIT 5
  ) sts
  LEFT JOIN products p ON p.id = sts.sole_id;

  v_result := v_result || jsonb_build_object(
    'key','sole_specs_insole_lt1',
    'table','sole_technical_specs',
    'field','insole_consumption_dm2',
    'severity', CASE WHEN v_count > 0 THEN 'medium' ELSE 'ok' END,
    'description','Especificação por tamanho com consumo de palmilha menor que 1 — provável valor em m² no campo dm²',
    'expected','dm² por par (tipicamente entre 1 e 10)',
    'count', v_count,
    'examples', v_examples
  );

  -- 8) Tiras em technical_sheets com consumo < 1 (cm/par)
  SELECT COUNT(*) INTO v_count
  FROM technical_sheets ts, jsonb_array_elements(COALESCE(ts.strap_colors,'[]'::jsonb)) sc
  WHERE (sc->>'consumption') IS NOT NULL
    AND (sc->>'consumption')::numeric > 0
    AND (sc->>'consumption')::numeric < 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',ts.id,'label',ts.name||' / '||COALESCE(sc->>'color','?'),'value',(sc->>'consumption')::numeric)), '[]'::jsonb)
  INTO v_examples
  FROM (
    SELECT ts.id, ts.name, sc
    FROM technical_sheets ts, jsonb_array_elements(COALESCE(ts.strap_colors,'[]'::jsonb)) sc
    WHERE (sc->>'consumption') IS NOT NULL
      AND (sc->>'consumption')::numeric > 0
      AND (sc->>'consumption')::numeric < 1
    LIMIT 5
  ) ts;

  v_result := v_result || jsonb_build_object(
    'key','strap_consumption_lt1_tech_sheets',
    'table','technical_sheets',
    'field','strap_colors[].consumption',
    'severity', CASE WHEN v_count > 0 THEN 'high' ELSE 'ok' END,
    'description','Tira com consumo menor que 1 em ficha técnica — esperado cm/par, suspeita de valor em metros',
    'expected','cm por par (tipicamente entre 5 e 200)',
    'count', v_count,
    'examples', v_examples
  );

  -- 9) Tiras em product_references
  SELECT COUNT(*) INTO v_count
  FROM product_references pr, jsonb_array_elements(COALESCE(pr.strap_colors,'[]'::jsonb)) sc
  WHERE (sc->>'consumption') IS NOT NULL
    AND (sc->>'consumption')::numeric > 0
    AND (sc->>'consumption')::numeric < 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pr.id,'label',pr.code||' / '||COALESCE(sc->>'color','?'),'value',(sc->>'consumption')::numeric)), '[]'::jsonb)
  INTO v_examples
  FROM (
    SELECT pr.id, pr.code, sc
    FROM product_references pr, jsonb_array_elements(COALESCE(pr.strap_colors,'[]'::jsonb)) sc
    WHERE (sc->>'consumption') IS NOT NULL
      AND (sc->>'consumption')::numeric > 0
      AND (sc->>'consumption')::numeric < 1
    LIMIT 5
  ) pr;

  v_result := v_result || jsonb_build_object(
    'key','strap_consumption_lt1_product_refs',
    'table','product_references',
    'field','strap_colors[].consumption',
    'severity', CASE WHEN v_count > 0 THEN 'high' ELSE 'ok' END,
    'description','Tira com consumo menor que 1 em referência — esperado cm/par',
    'expected','cm por par (tipicamente entre 5 e 200)',
    'count', v_count,
    'examples', v_examples
  );

  -- 10) Tiras em sale_order_items
  SELECT COUNT(*) INTO v_count
  FROM sale_order_items soi, jsonb_array_elements(COALESCE(soi.strap_colors,'[]'::jsonb)) sc
  WHERE (sc->>'consumption') IS NOT NULL
    AND (sc->>'consumption')::numeric > 0
    AND (sc->>'consumption')::numeric < 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',soi.id,'label','Item '||substring(soi.id::text,1,8)||' / '||COALESCE(sc->>'color','?'),'value',(sc->>'consumption')::numeric)), '[]'::jsonb)
  INTO v_examples
  FROM (
    SELECT soi.id, sc
    FROM sale_order_items soi, jsonb_array_elements(COALESCE(soi.strap_colors,'[]'::jsonb)) sc
    WHERE (sc->>'consumption') IS NOT NULL
      AND (sc->>'consumption')::numeric > 0
      AND (sc->>'consumption')::numeric < 1
    LIMIT 5
  ) soi;

  v_result := v_result || jsonb_build_object(
    'key','strap_consumption_lt1_sale_order_items',
    'table','sale_order_items',
    'field','strap_colors[].consumption',
    'severity', CASE WHEN v_count > 0 THEN 'high' ELSE 'ok' END,
    'description','Tira com consumo menor que 1 em item de pedido — esperado cm/par',
    'expected','cm por par (tipicamente entre 5 e 200)',
    'count', v_count,
    'examples', v_examples
  );

  RETURN jsonb_build_object(
    'generated_at', now(),
    'checks', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.audit_unit_divergences() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_unit_divergences() TO authenticated;