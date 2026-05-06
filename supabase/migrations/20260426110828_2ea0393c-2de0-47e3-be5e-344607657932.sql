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
  v_result     jsonb;
  v_src        text;
  v_val        numeric;
BEGIN
  DELETE FROM sheet_materials       WHERE sheet_id = v_sheet_id;
  DELETE FROM sole_technical_specs  WHERE sole_id  = v_sole_id;
  DELETE FROM technical_sheets      WHERE id       = v_sheet_id;
  DELETE FROM products              WHERE id IN (v_sole_id, v_napa_id, v_forro_id, v_palm_id);

  INSERT INTO products (id, sku, name, category, color, quantity, active, unit) VALUES
    (v_sole_id,  'TEST-SOLADO-X', 'TEST_SOLADO_X', 'solado',   'Caramelo', 1000, true, 'PAR'),
    (v_napa_id,  'TEST-NAPA',     'TEST_NAPA',     'cabedal',  'Caramelo', 5000, true, 'DM2'),
    (v_forro_id, 'TEST-FORRO',    'TEST_FORRO',    'forro',    'Caramelo', 5000, true, 'DM2'),
    (v_palm_id,  'TEST-PALMILHA', 'TEST_PALMILHA', 'palmilha', 'Caramelo', 5000, true, 'DM2');

  INSERT INTO technical_sheets (
    id, name, status, reference_size,
    upper_material,  upper_consumption,  upper_consumption_per_size,
    lining_material, lining_consumption, lining_consumption_per_size,
    insole_material, insole_consumption, insole_consumption_per_size,
    sole_drives_consumption
  ) VALUES (
    v_sheet_id, 'TEST_FICHA_HIERARQUIA', 'ativo', 37,
    'TEST_NAPA',     9.00, '{"37": 9.29}'::jsonb,
    'TEST_FORRO',    5.50, '{"37": 5.70}'::jsonb,
    'TEST_PALMILHA', 4.00, '{"37": 4.16}'::jsonb,
    true
  );

  INSERT INTO sole_technical_specs (sole_id, size, lining_consumption_dm2, insole_consumption_dm2)
  VALUES (v_sole_id, 38, 6.10, 4.50);

  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', 37);
  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Cabedal' LIMIT 1;
  RETURN QUERY SELECT 'CASO 1 (size=37) Cabedal source'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forro' LIMIT 1;
  RETURN QUERY SELECT 'CASO 1 (size=37) Forro source'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Palmilha' LIMIT 1;
  RETURN QUERY SELECT 'CASO 1 (size=37) Palmilha source'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', 38);
  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forro' LIMIT 1;
  RETURN QUERY SELECT 'CASO 2 (size=38) Forro ≈ sole_spec(6.10)'::text,
    v_val IS NOT NULL AND v_val BETWEEN 6.0 AND 6.2, format('valor=%s', v_val);

  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Palmilha' LIMIT 1;
  RETURN QUERY SELECT 'CASO 2 (size=38) Palmilha ≈ sole_spec(4.50)'::text,
    v_val IS NOT NULL AND v_val BETWEEN 4.4 AND 4.6, format('valor=%s', v_val);

  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', 99);
  SELECT (e->>'consumption_per_unit')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Forro' LIMIT 1;
  RETURN QUERY SELECT 'CASO 3 (size=99) Forro ≈ escalar(5.50)'::text,
    v_val IS NOT NULL AND v_val BETWEEN 5.4 AND 5.6, format('valor=%s', v_val);

  v_result := calculate_order_consumption(v_sheet_id, 10, 'Caramelo', NULL);
  SELECT (e->>'source') INTO v_src FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Cabedal' LIMIT 1;
  RETURN QUERY SELECT 'CASO 4 (size=NULL) usa reference_size=37'::text, v_src = 'sheet_per_size', format('source=%s', v_src);

  v_result := calculate_order_consumption(v_sheet_id, 10, '', 37);
  RETURN QUERY SELECT 'CASO 5 (color="") retorna array JSONB'::text,
    v_result IS NOT NULL AND jsonb_typeof(v_result) = 'array', format('typeof=%s', jsonb_typeof(v_result));

  v_result := calculate_order_consumption(v_sheet_id, 100, 'Caramelo', 37);
  SELECT (e->>'required')::numeric INTO v_val FROM jsonb_array_elements(v_result) e WHERE e->>'component' = 'Cabedal' LIMIT 1;
  RETURN QUERY SELECT 'CASO 6 (qty=100) required ≈ 9.29 × 100'::text,
    v_val IS NOT NULL AND v_val BETWEEN 920 AND 940, format('required=%s', v_val);

  DELETE FROM sheet_materials       WHERE sheet_id = v_sheet_id;
  DELETE FROM sole_technical_specs  WHERE sole_id  = v_sole_id;
  DELETE FROM technical_sheets      WHERE id       = v_sheet_id;
  DELETE FROM products              WHERE id IN (v_sole_id, v_napa_id, v_forro_id, v_palm_id);

EXCEPTION WHEN OTHERS THEN
  DELETE FROM sheet_materials       WHERE sheet_id = v_sheet_id;
  DELETE FROM sole_technical_specs  WHERE sole_id  = v_sole_id;
  DELETE FROM technical_sheets      WHERE id       = v_sheet_id;
  DELETE FROM products              WHERE id IN (v_sole_id, v_napa_id, v_forro_id, v_palm_id);
  RAISE;
END;
$$;