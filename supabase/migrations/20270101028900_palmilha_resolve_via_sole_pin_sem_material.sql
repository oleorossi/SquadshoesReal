-- Palmilha: honrar pin placa_palmilha do solado mesmo com insole_material vazio.
--
-- Sintoma: G01/G02/G03/DS53 (e qualquer ficha com sole_drives + material '')
-- saíam "Palmilha sem material" / required=0 no relatório canônico, embora
-- SOLADO 01 e SOLADO INFANTIL tenham pin EVA 3MM (metro linear) no Consumo
-- Padrão. O resolver já sabe usar o pin com group_name ''; o gate
-- `insole_material <> ''` em by_grade / check_stock impedia a chamada.
--
-- Decisão do dono (2026-09-25): fonte canônica do SKU = pin do solado;
-- EVA 3MM é a placa consumida em 01 e INFANTIL, em metro linear.

BEGIN;

DO $patch$
DECLARE
  r record;
  src text;
  new_src text;
  patched int := 0;
  old_by_grade constant text :=
    'IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '''' THEN';
  new_by_grade constant text :=
    -- Pin placa_palmilha do solado resolve mesmo com insole_material vazio.
    'IF COALESCE(btrim(v_sheet.insole_material), '''') <> '''''
    || ' OR v_sheet.sole_group_id IS NOT NULL'
    || ' OR v_sheet.primary_sole_id IS NOT NULL THEN';
  old_stock constant text :=
    'IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '''''
    || E'\n'
    || '         AND NOT v_is_palmilha_pronta AND COALESCE(v_sheet.insole_consumption, 0) > 0 THEN';
  new_stock constant text :=
    'IF NOT v_is_palmilha_pronta'
    || E'\n'
    || '         AND ('
    || E'\n'
    || '           COALESCE(v_sheet.insole_consumption, 0) > 0'
    || E'\n'
    || '           OR COALESCE(v_sheet.sole_drives_consumption, false)'
    || E'\n'
    || '         )'
    || E'\n'
    || '         AND ('
    || E'\n'
    || '           COALESCE(btrim(v_sheet.insole_material), '''') <> '''''
    || E'\n'
    || '           OR v_sheet.sole_group_id IS NOT NULL'
    || E'\n'
    || '           OR v_sheet.primary_sole_id IS NOT NULL'
    || E'\n'
    || '         ) THEN';
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'calculate_order_consumption_by_grade',
         'check_stock_availability'
       )
  LOOP
    src := pg_get_functiondef(r.sig);
    new_src := src;

    IF r.proname = 'calculate_order_consumption_by_grade' THEN
      IF src NOT LIKE '%' || old_by_grade || '%' THEN
        IF src LIKE '%' || 'OR v_sheet.sole_group_id IS NOT NULL' || '%'
           AND src LIKE '%resolve_insole_material_for_variant%' THEN
          RAISE NOTICE 'by_grade: gate já aberto — skip';
          CONTINUE;
        END IF;
        RAISE EXCEPTION
          'by_grade: gate antigo de insole_material nao encontrado (corpo mudou)';
      END IF;
      new_src := replace(src, old_by_grade, new_by_grade);
    ELSIF r.proname = 'check_stock_availability' THEN
      IF src NOT LIKE '%' || old_stock || '%' THEN
        IF src LIKE '%' || 'OR v_sheet.sole_group_id IS NOT NULL' || '%'
           AND src LIKE '%resolve_insole_material_for_variant%' THEN
          RAISE NOTICE 'check_stock: gate já aberto — skip';
          CONTINUE;
        END IF;
        RAISE EXCEPTION
          'check_stock: gate antigo de insole_material nao encontrado (corpo mudou)';
      END IF;
      new_src := replace(src, old_stock, new_stock);
    END IF;

    IF new_src IS DISTINCT FROM src THEN
      EXECUTE new_src;
      patched := patched + 1;
    END IF;
  END LOOP;

  IF patched < 1 THEN
    RAISE EXCEPTION
      'palmilha-sole-pin: nenhuma funcao patchada (esperado by_grade e/ou check_stock)';
  END IF;

  RAISE NOTICE 'palmilha-sole-pin: % funcoes patchadas', patched;
END
$patch$;

-- Pós-condição: G01 (material '') + SOLADO 01 deve resolver EVA 3MM, não unresolved.
DO $smoke$
DECLARE
  v_g01 uuid;
  v_lines jsonb;
  v_palm jsonb;
  v_eva uuid := '4d188ffd-9a85-4a21-80a5-591ba83171ad';
BEGIN
  SELECT id INTO v_g01
    FROM public.technical_sheets
   WHERE upper(btrim(name)) = 'G01'
   LIMIT 1;

  IF v_g01 IS NULL THEN
    RAISE NOTICE 'smoke: ficha G01 ausente — skip';
    RETURN;
  END IF;

  v_lines := public.calculate_order_consumption_by_grade(
    v_g01,
    '{"34":24,"35":24}'::jsonb,
    'OFF WHITE',
    NULL
  );

  SELECT line
    INTO v_palm
    FROM jsonb_array_elements(v_lines) line
   WHERE line->>'component' = 'Palmilha'
   LIMIT 1;

  IF v_palm IS NULL THEN
    RAISE EXCEPTION 'smoke G01: nenhuma linha Palmilha emitida';
  END IF;

  IF COALESCE(v_palm->>'source', '') = 'unresolved' THEN
    RAISE EXCEPTION
      'smoke G01: ainda unresolved (%)',
      v_palm->>'consumption_warning';
  END IF;

  IF (v_palm->>'product_id')::uuid IS DISTINCT FROM v_eva THEN
    RAISE EXCEPTION
      'smoke G01: esperava EVA 3MM (%), veio % (%)',
      v_eva, v_palm->>'product_id', v_palm->>'product_name';
  END IF;

  IF lower(COALESCE(v_palm->>'unit', '')) NOT IN ('m', 'metro') THEN
    RAISE EXCEPTION
      'smoke G01: unidade esperada m/metro, veio %',
      v_palm->>'unit';
  END IF;

  IF COALESCE((v_palm->>'required')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION 'smoke G01: required ainda zero';
  END IF;
END
$smoke$;

COMMIT;
