-- =============================================================================
-- Testes de integração SQL para calculate_order_consumption
-- Validam a hierarquia: sheet_per_size → sole_spec → sheet_materials (escalar)
-- e os edge cases de p_size (NULL, tamanho inexistente, fallback).
--
-- Execução: psql -v ON_ERROR_STOP=1 -f tests/sql/integration/consumption_rpc_hierarchy.sql
-- Tudo roda em uma transação que faz ROLLBACK no final — não polui o banco.
-- =============================================================================

BEGIN;

SET LOCAL search_path = public;

-- ----------------------------------------------------------------------------
-- SEED: criamos um cenário sintético isolado, sem depender de dados reais.
-- IDs fixos para facilitar inspeção em caso de falha.
-- ----------------------------------------------------------------------------

-- Limpeza defensiva (caso uma execução anterior tenha vazado dados).
DELETE FROM sheet_materials       WHERE sheet_id     = '11111111-1111-1111-1111-111111111111';
DELETE FROM sole_technical_specs  WHERE sole_id      = '22222222-2222-2222-2222-222222222222';
DELETE FROM technical_sheets      WHERE id           = '11111111-1111-1111-1111-111111111111';
DELETE FROM products              WHERE id IN (
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555'
);

-- Solado, cabedal, forro, palmilha como produtos.
INSERT INTO products (id, name, category, color, quantity, active, unit) VALUES
  ('22222222-2222-2222-2222-222222222222', 'TEST_SOLADO_X',   'solado',          'Caramelo', 1000, true, 'PAR'),
  ('33333333-3333-3333-3333-333333333333', 'TEST_NAPA',       'cabedal',         'Caramelo', 5000, true, 'DM2'),
  ('44444444-4444-4444-4444-444444444444', 'TEST_FORRO',      'forro',           'Caramelo', 5000, true, 'DM2'),
  ('55555555-5555-5555-5555-555555555555', 'TEST_PALMILHA',   'palmilha',        'Caramelo', 5000, true, 'DM2');

-- Ficha técnica com:
--  • per-size DEFINIDO para o tamanho 37 (cabedal/forro/palmilha)
--  • per-size AUSENTE para o tamanho 38 (vai cair em sole_spec)
--  • per-size AUSENTE para o tamanho 99 (inexistente; cai em sole_spec → escalar)
INSERT INTO technical_sheets (
  id, name, reference_size,
  upper_material,  upper_consumption,  upper_consumption_per_size,
  lining_material, lining_consumption, lining_consumption_per_size,
  insole_material, insole_consumption, insole_consumption_per_size,
  sole_drives_consumption,
  active
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'TEST_FICHA_HIERARQUIA',
  37,
  'TEST_NAPA',     9.00,  '{"37": 9.29}'::jsonb,   -- per-size só para 37
  'TEST_FORRO',    5.50,  '{"37": 5.70}'::jsonb,
  'TEST_PALMILHA', 4.00,  '{"37": 4.16}'::jsonb,
  true,                                             -- sole drives → habilita fallback sole_spec
  true
);

-- BOM legado (sheet_materials) — usado quando não há per-size nem sole_spec.
-- Tem que apontar para outros produtos para não conflitar com a resolução por categoria.
-- Aqui simulamos um material adicional ("cola") que sempre aparece.
INSERT INTO sheet_materials (sheet_id, product_id, quantity_per_unit) VALUES
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 9.00),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 5.50),
  ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 4.00);

-- sole_technical_specs: define consumo de forro/palmilha para tamanho 38.
-- Para 99 (inexistente) NÃO definimos → o SQL deve cair no escalar.
INSERT INTO sole_technical_specs (
  sole_id, size, lining_consumption_dm2, insole_consumption_dm2
) VALUES
  ('22222222-2222-2222-2222-222222222222', 38, 6.10, 4.50);

-- ----------------------------------------------------------------------------
-- Helper: roda a RPC e retorna o JSON inteiro.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_result        jsonb;
  v_cabedal_src   text;
  v_forro_src     text;
  v_palmilha_src  text;
  v_cabedal_req   numeric;
  v_forro_req     numeric;
  v_palmilha_req  numeric;
BEGIN
  -- =========================================================================
  -- CASO 1 — size = 37 (per-size DEFINIDO) → todos devem vir de sheet_per_size
  -- =========================================================================
  SELECT calculate_order_consumption(
    '11111111-1111-1111-1111-111111111111'::uuid, 10, 'Caramelo', 37
  ) INTO v_result;

  SELECT (elem->>'source') INTO v_cabedal_src
  FROM jsonb_array_elements(v_result) elem
  WHERE elem->>'component' = 'Cabedal' LIMIT 1;

  SELECT (elem->>'source') INTO v_forro_src
  FROM jsonb_array_elements(v_result) elem
  WHERE elem->>'component' = 'Forro' LIMIT 1;

  SELECT (elem->>'source') INTO v_palmilha_src
  FROM jsonb_array_elements(v_result) elem
  WHERE elem->>'component' = 'Palmilha' LIMIT 1;

  ASSERT v_cabedal_src  = 'sheet_per_size',
    format('CASO 1 (size=37): Cabedal deveria vir de sheet_per_size, veio de %s', v_cabedal_src);
  ASSERT v_forro_src    = 'sheet_per_size',
    format('CASO 1 (size=37): Forro deveria vir de sheet_per_size, veio de %s', v_forro_src);
  ASSERT v_palmilha_src = 'sheet_per_size',
    format('CASO 1 (size=37): Palmilha deveria vir de sheet_per_size, veio de %s', v_palmilha_src);

  RAISE NOTICE '✓ CASO 1 (size=37, per-size definido): todas as fontes = sheet_per_size';

  -- =========================================================================
  -- CASO 2 — size = 38 (per-size AUSENTE, sole_spec PRESENTE)
  -- Cabedal cai no escalar (upper_consumption=9.00) porque não há sole_spec p/ upper.
  -- Forro/Palmilha vêm de sole_spec (6.10 / 4.50).
  -- =========================================================================
  SELECT calculate_order_consumption(
    '11111111-1111-1111-1111-111111111111'::uuid, 10, 'Caramelo', 38
  ) INTO v_result;

  SELECT (elem->>'consumption_per_unit')::numeric INTO v_forro_req
  FROM jsonb_array_elements(v_result) elem
  WHERE elem->>'component' = 'Forro' LIMIT 1;

  SELECT (elem->>'consumption_per_unit')::numeric INTO v_palmilha_req
  FROM jsonb_array_elements(v_result) elem
  WHERE elem->>'component' = 'Palmilha' LIMIT 1;

  -- O motor aplica conversão (dm2_per_unit / waste); quando não há conversão
  -- configurada, get_material_conversion_info retorna 1 / 0%, então o valor
  -- por par fica próximo do consumption original.
  ASSERT v_forro_req IS NOT NULL,
    'CASO 2 (size=38): Forro ausente do resultado (esperado fallback sole_spec=6.10)';
  ASSERT v_palmilha_req IS NOT NULL,
    'CASO 2 (size=38): Palmilha ausente do resultado (esperado fallback sole_spec=4.50)';
  ASSERT v_forro_req >= 6.0 AND v_forro_req <= 6.2,
    format('CASO 2 (size=38): Forro deveria refletir sole_spec ≈6.10, veio %s', v_forro_req);
  ASSERT v_palmilha_req >= 4.4 AND v_palmilha_req <= 4.6,
    format('CASO 2 (size=38): Palmilha deveria refletir sole_spec ≈4.50, veio %s', v_palmilha_req);

  RAISE NOTICE '✓ CASO 2 (size=38, sem per-size): forro/palmilha vieram de sole_spec';

  -- =========================================================================
  -- CASO 3 — size = 99 (per-size AUSENTE, sole_spec AUSENTE) → cai no escalar
  -- =========================================================================
  SELECT calculate_order_consumption(
    '11111111-1111-1111-1111-111111111111'::uuid, 10, 'Caramelo', 99
  ) INTO v_result;

  SELECT (elem->>'consumption_per_unit')::numeric INTO v_forro_req
  FROM jsonb_array_elements(v_result) elem
  WHERE elem->>'component' = 'Forro' LIMIT 1;

  ASSERT v_forro_req IS NOT NULL,
    'CASO 3 (size=99): Forro ausente — esperado fallback escalar (lining_consumption=5.50)';
  ASSERT v_forro_req >= 5.4 AND v_forro_req <= 5.6,
    format('CASO 3 (size=99): Forro deveria refletir escalar ≈5.50, veio %s', v_forro_req);

  RAISE NOTICE '✓ CASO 3 (size=99, sem per-size, sem sole_spec): cai no escalar da ficha';

  -- =========================================================================
  -- CASO 4 — size = NULL → usa reference_size (37) → per-size definido
  -- =========================================================================
  SELECT calculate_order_consumption(
    '11111111-1111-1111-1111-111111111111'::uuid, 10, 'Caramelo', NULL
  ) INTO v_result;

  SELECT (elem->>'source') INTO v_cabedal_src
  FROM jsonb_array_elements(v_result) elem
  WHERE elem->>'component' = 'Cabedal' LIMIT 1;

  ASSERT v_cabedal_src = 'sheet_per_size',
    format('CASO 4 (size=NULL): deveria usar reference_size=37 → sheet_per_size, veio %s', v_cabedal_src);

  RAISE NOTICE '✓ CASO 4 (size=NULL): fallback para reference_size respeitado';

  -- =========================================================================
  -- CASO 5 — color = '' (vazio) → não deve quebrar; resolve_sole_color cuida
  -- =========================================================================
  SELECT calculate_order_consumption(
    '11111111-1111-1111-1111-111111111111'::uuid, 10, '', 37
  ) INTO v_result;

  ASSERT v_result IS NOT NULL,
    'CASO 5 (color=""): RPC retornou NULL (esperado JSONB com lines)';
  ASSERT jsonb_typeof(v_result) = 'array',
    format('CASO 5 (color=""): tipo esperado array, veio %s', jsonb_typeof(v_result));

  RAISE NOTICE '✓ CASO 5 (color=""): RPC processou sem erro';

  -- =========================================================================
  -- CASO 6 — quantity escala linearmente o required
  -- =========================================================================
  SELECT calculate_order_consumption(
    '11111111-1111-1111-1111-111111111111'::uuid, 100, 'Caramelo', 37
  ) INTO v_result;

  SELECT (elem->>'required')::numeric INTO v_cabedal_req
  FROM jsonb_array_elements(v_result) elem
  WHERE elem->>'component' = 'Cabedal' LIMIT 1;

  -- 100 pares × 9.29 dm² = 929 dm² (sem conversão, esperando ~929)
  ASSERT v_cabedal_req >= 920 AND v_cabedal_req <= 940,
    format('CASO 6 (qty=100): Cabedal deveria escalar para ≈929, veio %s', v_cabedal_req);

  RAISE NOTICE '✓ CASO 6 (qty=100): required escala linearmente (≈929 dm²)';

  RAISE NOTICE '----------------------------------------------------------------';
  RAISE NOTICE '✅ Todos os 6 testes de integração SQL passaram.';
  RAISE NOTICE '----------------------------------------------------------------';
END $$;

-- Sempre rollback: testes não devem persistir nada.
ROLLBACK;