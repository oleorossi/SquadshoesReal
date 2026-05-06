DROP FUNCTION IF EXISTS public.run_consumption_integration_tests() CASCADE;
CREATE OR REPLACE FUNCTION public.run_consumption_integration_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  DELETE FROM sheet_materials       WHERE sheet_id = v_sheet_id;
  DELETE FROM sole_technical_specs  WHERE sole_id  = v_sole_id;
  DELETE FROM technical_sheets      WHERE id       = v_sheet_id;
  DELETE FROM products              WHERE id IN (v_sole_id, v_napa_id, v_forro_id, v_palm_id);
  DELETE FROM product_groups        WHERE id IN (v_grp_napa, v_grp_forro, v_grp_palm, v_grp_sole);

  INSERT INTO product_groups (id, name) VALUES
    (v_grp_sole,  'TEST_SOLADO_X'),
    (v_grp_napa,  'TEST_NAPA'),
    (v_grp_forro, 'TEST_FORRO'),
    (v_grp_palm,  'TEST_PALMILHA');

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

  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forro' LIMIT 1;
  RETURN QUERY SELECT 'CASO 1 (size=37) Forro source'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Palmilha' LIMIT 1;
  RETURN QUERY SELECT 'CASO 1 (size=37) Palmilha source'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  -- CASO 1b — valida valor numérico do per-size (9.29 × 1.08 ≈ 10.03)
  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Cabedal' LIMIT 1;
  RETURN QUERY SELECT 'CASO 1b Cabedal valor ≈ 9.29 × 1.08'::text,
    v_val BETWEEN 9.95 AND 10.10, format('valor=%s', v_val);

  -- CASO 2 — size=38 → forro/palmilha de sole_spec (6.10 × 1.08 ≈ 6.59 ; 4.50 × 1.08 ≈ 4.86)
  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', 38);
  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forro' LIMIT 1;
  RETURN QUERY SELECT 'CASO 2 (size=38) Forro ≈ sole_spec(6.10×1.08)'::text,
    v_val BETWEEN 6.50 AND 6.65, format('valor=%s', v_val);

  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Palmilha' LIMIT 1;
  RETURN QUERY SELECT 'CASO 2 (size=38) Palmilha ≈ sole_spec(4.50×1.08)'::text,
    v_val BETWEEN 4.80 AND 4.90, format('valor=%s', v_val);

  -- CASO 3 — size=99 → escalar (5.50 × 1.08 ≈ 5.94)
  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', 99);
  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forro' LIMIT 1;
  RETURN QUERY SELECT 'CASO 3 (size=99) Forro ≈ escalar(5.50×1.08)'::text,
    v_val BETWEEN 5.90 AND 6.00, format('valor=%s', v_val);

  -- CASO 4 — size=NULL → reference_size=37
  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', NULL);
  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Cabedal' LIMIT 1;
  RETURN QUERY SELECT 'CASO 4 (size=NULL) usa reference_size=37'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  -- CASO 5 — color=""
  v_result := calculate_order_consumption(v_sheet_id, 10, '', 37);
  RETURN QUERY SELECT 'CASO 5 (color="") retorna array JSONB'::text,
    v_result IS NOT NULL AND jsonb_typeof(v_result) = 'array', format('typeof=%s', jsonb_typeof(v_result));

  -- CASO 6 — qty=100 escala linearmente (9.29 × 100 × 1.08 ≈ 1003)
  v_result := calculate_order_consumption(v_sheet_id, 100, 'Caramelo', 37);
  SELECT (e->>'required')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Cabedal' LIMIT 1;
  RETURN QUERY SELECT 'CASO 6 (qty=100) required ≈ 9.29 × 100 × 1.08'::text,
    v_val BETWEEN 995 AND 1010, format('required=%s', v_val);

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
$$;