-- Aceitação somente leitura da I701, pela grade da imagem (480 pares).
-- Não exige saldo zero: entradas futuras não invalidam a correção.
BEGIN READ ONLY;

DO $test$
DECLARE
  v_ref constant uuid := '049cef09-f46f-4017-b9c7-e927b52b8632';
  v_variant constant uuid := '864fd0f1-8445-439c-97de-1213fdd59975';
  v_grade constant jsonb := '{"25":40,"26":40,"27":40,"28":40,"29":80,"30":80,"31":40,"32":40,"33":40,"34":40}';
  v_expected constant numeric := (2.74 + 2.28) * 480 / 137;
  v_color text;
  v_upper_group uuid;
  v_lining_group uuid;
  v_lines jsonb;
  v_upper jsonb;
BEGIN
  SELECT upper_material_group_id, lining_material_group_id
    INTO STRICT v_upper_group, v_lining_group
    FROM public.reference_material_variants WHERE id = v_variant AND reference_id = v_ref;
  IF v_upper_group IS NULL OR v_lining_group IS NULL OR v_upper_group = v_lining_group THEN
    RAISE EXCEPTION 'A variante não distingue dublado e forração simples.';
  END IF;

  FOREACH v_color IN ARRAY ARRAY['CHAMPAGNE','COBRE','OURO LIGHT','PRATA'] LOOP
    v_lines := public.calculate_order_consumption_by_grade(v_ref, v_grade, v_color, v_variant);
    IF (SELECT count(*) FROM jsonb_array_elements(v_lines) l
        JOIN public.products p ON p.id = (l->>'product_id')::uuid
        WHERE p.group_id = v_upper_group) <> 1 THEN
      RAISE EXCEPTION 'Cabedal deve gerar uma linha consolidada para %.', v_color;
    END IF;
    SELECT l INTO STRICT v_upper FROM jsonb_array_elements(v_lines) l
      JOIN public.products p ON p.id = (l->>'product_id')::uuid
      WHERE p.group_id = v_upper_group;
    IF v_upper->>'unit' IS DISTINCT FROM 'm'
       OR v_upper->>'color' IS DISTINCT FROM v_color
       OR v_upper->>'matched_by' IS DISTINCT FROM 'variant_group'
       OR v_upper->>'required' IS NULL
       OR abs((v_upper->>'required')::numeric - v_expected) > 0.000001
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l
          JOIN public.products p ON p.id = (l->>'product_id')::uuid
          WHERE p.group_id = 'd2e718c8-aeb9-4706-be19-fd34b7fcc158') THEN
      RAISE EXCEPTION 'Consumo incorreto do dublado para %: %', v_color, v_upper;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l
       JOIN public.products p ON p.id = (l->>'product_id')::uuid
       WHERE p.group_id = v_lining_group AND p.color = v_color
         AND l->>'component' = 'Forração Palmilha' AND l->>'unit' = 'm'
         AND abs((l->>'required')::numeric - 16.0666569343) < 0.000001) THEN
      RAISE EXCEPTION 'Forração simples incorreta para %.', v_color;
    END IF;
  END LOOP;
END
$test$;

ROLLBACK;
