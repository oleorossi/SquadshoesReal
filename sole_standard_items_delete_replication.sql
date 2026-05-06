-- =============================================================================
-- Teste de integração SQL para REPLICAÇÃO POR MODELO na REMOÇÃO
-- de sole_standard_items_consumption.
--
-- Premissa industrial: ao remover o consumo base de um item padrão para uma
-- variante de cor, a remoção DEVE alcançar TODAS as variantes do mesmo
-- modelo (mesmo nome normalizado), preservando os dados de OUTROS modelos.
-- =============================================================================

BEGIN;
SET LOCAL search_path = public;

-- ----------------------------------------------------------------------------
-- Limpeza defensiva
-- ----------------------------------------------------------------------------
DELETE FROM sole_standard_items_consumption WHERE sole_product_id IN (
  '77770001-0000-0000-0000-000000000001',
  '77770001-0000-0000-0000-000000000002',
  '77770001-0000-0000-0000-000000000003',
  '77770002-0000-0000-0000-000000000001',
  '77770002-0000-0000-0000-000000000002',
  '77770003-0000-0000-0000-000000000001'
) OR standard_item_id IN (
  '66660000-0000-0000-0000-0000000000aa',
  '66660000-0000-0000-0000-0000000000bb'
);

DELETE FROM products WHERE id IN (
  '77770001-0000-0000-0000-000000000001',
  '77770001-0000-0000-0000-000000000002',
  '77770001-0000-0000-0000-000000000003',
  '77770002-0000-0000-0000-000000000001',
  '77770002-0000-0000-0000-000000000002',
  '77770003-0000-0000-0000-000000000001',
  '66660000-0000-0000-0000-0000000000aa',
  '66660000-0000-0000-0000-0000000000bb'
);

-- ----------------------------------------------------------------------------
-- SEED — 3 modelos: A (3 variantes), B (2 variantes), C (1 variante)
-- ----------------------------------------------------------------------------
INSERT INTO products (id, name, category, color, quantity, active, unit) VALUES
  ('77770001-0000-0000-0000-000000000001', 'TEST_DEL_SOLADO_A Caramelo', 'solado',  'Caramelo', 100, true, 'PAR'),
  ('77770001-0000-0000-0000-000000000002', 'TEST_DEL_SOLADO_A Preto',    'solado',  'Preto',    100, true, 'PAR'),
  ('77770001-0000-0000-0000-000000000003', 'TEST_DEL_SOLADO_A Marrom',   'solado',  'Marrom',   100, true, 'PAR'),
  ('77770002-0000-0000-0000-000000000001', 'TEST_DEL_SOLADO_B Caramelo', 'solado',  'Caramelo', 100, true, 'PAR'),
  ('77770002-0000-0000-0000-000000000002', 'TEST_DEL_SOLADO_B Preto',    'solado',  'Preto',    100, true, 'PAR'),
  ('77770003-0000-0000-0000-000000000001', 'TEST_DEL_SOLADO_C Preto',    'solado',  'Preto',    100, true, 'PAR'),
  ('66660000-0000-0000-0000-0000000000aa', 'TEST_DEL_ITEM_COLA',         'químico', NULL,       100, true, 'g'),
  ('66660000-0000-0000-0000-0000000000bb', 'TEST_DEL_ITEM_LINHA',        'aviamento', NULL,     100, true, 'm');

-- Pré-popula consumo: COLA e LINHA em TODAS as 6 variantes (todos modelos),
-- 2 tamanhos cada → 12 linhas por item × 2 itens = 24 linhas no total.
INSERT INTO sole_standard_items_consumption (sole_product_id, standard_item_id, size, consumption, unit)
SELECT p.id, item_id, sz, val, unit_t
FROM (VALUES
  ('66660000-0000-0000-0000-0000000000aa'::uuid, 37, 10.0, 'g'),
  ('66660000-0000-0000-0000-0000000000aa'::uuid, 38, 11.0, 'g'),
  ('66660000-0000-0000-0000-0000000000bb'::uuid, 37, 1.5,  'm'),
  ('66660000-0000-0000-0000-0000000000bb'::uuid, 38, 1.6,  'm')
) AS v(item_id, sz, val, unit_t)
CROSS JOIN products p
WHERE p.id IN (
  '77770001-0000-0000-0000-000000000001',
  '77770001-0000-0000-0000-000000000002',
  '77770001-0000-0000-0000-000000000003',
  '77770002-0000-0000-0000-000000000001',
  '77770002-0000-0000-0000-000000000002',
  '77770003-0000-0000-0000-000000000001'
);

-- Sanity: confere que temos as 24 linhas de partida.
DO $$
DECLARE v_total int;
BEGIN
  SELECT count(*) INTO v_total
  FROM sole_standard_items_consumption
  WHERE standard_item_id IN (
    '66660000-0000-0000-0000-0000000000aa',
    '66660000-0000-0000-0000-0000000000bb'
  );
  IF v_total <> 24 THEN RAISE EXCEPTION 'Seed deveria ter 24 linhas, tem %', v_total; END IF;
  RAISE NOTICE '✓ Seed inicial OK (24 linhas)';
END
$$;

-- ----------------------------------------------------------------------------
-- Helper temp: agrupamento por modelo (mesma regra do hook JS).
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _sole_norm AS
SELECT
  id,
  name,
  regexp_replace(
    lower(unaccent(name)),
    '[\s\-/–—]+(caramelo|preto|preta|marrom|bege|branco|branca|natural|cinza|vermelho|vermelha|azul|verde|amarelo|amarela|rosa|nude|cafe|chocolate|tabaco|conhaque|off white|off-white)\s*$',
    ''
  ) AS group_key
FROM products
WHERE lower(category) LIKE '%solado%' OR lower(category) = 'sola';

-- ----------------------------------------------------------------------------
-- CASO 1 — DELETE de COLA via A-Marrom remove COLA de todas variantes do A.
-- ----------------------------------------------------------------------------
DELETE FROM sole_standard_items_consumption
WHERE standard_item_id = '66660000-0000-0000-0000-0000000000aa'
  AND sole_product_id IN (
    SELECT n2.id
    FROM _sole_norm n1
    JOIN _sole_norm n2 ON n1.group_key = n2.group_key
    WHERE n1.id = '77770001-0000-0000-0000-000000000003'  -- A-Marrom
  );

DO $$
DECLARE
  v_cola_a int;
  v_cola_b int;
  v_cola_c int;
  v_linha_a int;
BEGIN
  -- COLA no modelo A: deveria ser 0
  SELECT count(*) INTO v_cola_a
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '66660000-0000-0000-0000-0000000000aa'
    AND sole_product_id IN (
      '77770001-0000-0000-0000-000000000001',
      '77770001-0000-0000-0000-000000000002',
      '77770001-0000-0000-0000-000000000003'
    );
  -- COLA no modelo B: deveria continuar com 4 (2 variantes × 2 tamanhos)
  SELECT count(*) INTO v_cola_b
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '66660000-0000-0000-0000-0000000000aa'
    AND sole_product_id IN (
      '77770002-0000-0000-0000-000000000001',
      '77770002-0000-0000-0000-000000000002'
    );
  -- COLA no modelo C: deveria continuar com 2
  SELECT count(*) INTO v_cola_c
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '66660000-0000-0000-0000-0000000000aa'
    AND sole_product_id = '77770003-0000-0000-0000-000000000001';
  -- LINHA no modelo A: NÃO deveria ter sido afetada (ainda 6 linhas)
  SELECT count(*) INTO v_linha_a
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '66660000-0000-0000-0000-0000000000bb'
    AND sole_product_id IN (
      '77770001-0000-0000-0000-000000000001',
      '77770001-0000-0000-0000-000000000002',
      '77770001-0000-0000-0000-000000000003'
    );

  IF v_cola_a <> 0 THEN RAISE EXCEPTION 'COLA no modelo A deveria ser removido completamente, sobraram %', v_cola_a; END IF;
  IF v_cola_b <> 4 THEN RAISE EXCEPTION 'COLA no modelo B NÃO deveria ter sido afetado (esperado 4), tem %', v_cola_b; END IF;
  IF v_cola_c <> 2 THEN RAISE EXCEPTION 'COLA no modelo C NÃO deveria ter sido afetado (esperado 2), tem %', v_cola_c; END IF;
  IF v_linha_a <> 6 THEN RAISE EXCEPTION 'LINHA no modelo A NÃO deveria ter sido afetada (esperado 6), tem %', v_linha_a; END IF;

  RAISE NOTICE '✓ Caso 1: DELETE de COLA via A-Marrom removeu de TODAS as 3 variantes do A, sem afetar B/C nem outros itens';
END
$$;

-- ----------------------------------------------------------------------------
-- CASO 2 — DELETE de LINHA via B-Preto: remove LINHA das 2 variantes do B,
-- preserva LINHA em A e C.
-- ----------------------------------------------------------------------------
DELETE FROM sole_standard_items_consumption
WHERE standard_item_id = '66660000-0000-0000-0000-0000000000bb'
  AND sole_product_id IN (
    SELECT n2.id
    FROM _sole_norm n1
    JOIN _sole_norm n2 ON n1.group_key = n2.group_key
    WHERE n1.id = '77770002-0000-0000-0000-000000000002'  -- B-Preto
  );

DO $$
DECLARE
  v_linha_b int;
  v_linha_a int;
  v_linha_c int;
BEGIN
  SELECT count(*) INTO v_linha_b
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '66660000-0000-0000-0000-0000000000bb'
    AND sole_product_id IN (
      '77770002-0000-0000-0000-000000000001',
      '77770002-0000-0000-0000-000000000002'
    );
  SELECT count(*) INTO v_linha_a
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '66660000-0000-0000-0000-0000000000bb'
    AND sole_product_id IN (
      '77770001-0000-0000-0000-000000000001',
      '77770001-0000-0000-0000-000000000002',
      '77770001-0000-0000-0000-000000000003'
    );
  SELECT count(*) INTO v_linha_c
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '66660000-0000-0000-0000-0000000000bb'
    AND sole_product_id = '77770003-0000-0000-0000-000000000001';

  IF v_linha_b <> 0 THEN RAISE EXCEPTION 'LINHA no modelo B deveria ser 0, tem %', v_linha_b; END IF;
  IF v_linha_a <> 6 THEN RAISE EXCEPTION 'LINHA no modelo A deveria continuar 6, tem %', v_linha_a; END IF;
  IF v_linha_c <> 2 THEN RAISE EXCEPTION 'LINHA no modelo C deveria continuar 2, tem %', v_linha_c; END IF;
  RAISE NOTICE '✓ Caso 2: DELETE de LINHA via B-Preto removeu de TODAS as 2 variantes do B, preservou A e C';
END
$$;

-- ----------------------------------------------------------------------------
-- CASO 3 — DELETE em modelo de 1 variante (C) afeta apenas o próprio.
-- ----------------------------------------------------------------------------
DELETE FROM sole_standard_items_consumption
WHERE standard_item_id = '66660000-0000-0000-0000-0000000000aa'
  AND sole_product_id IN (
    SELECT n2.id
    FROM _sole_norm n1
    JOIN _sole_norm n2 ON n1.group_key = n2.group_key
    WHERE n1.id = '77770003-0000-0000-0000-000000000001'  -- C-Preto
  );

DO $$
DECLARE
  v_cola_c int;
  v_total_left int;
BEGIN
  SELECT count(*) INTO v_cola_c
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '66660000-0000-0000-0000-0000000000aa'
    AND sole_product_id = '77770003-0000-0000-0000-000000000001';
  IF v_cola_c <> 0 THEN RAISE EXCEPTION 'COLA no modelo C deveria ser 0, tem %', v_cola_c; END IF;

  -- Total restante: COLA-B (4) + LINHA-A (6) + LINHA-C (2) = 12
  SELECT count(*) INTO v_total_left
  FROM sole_standard_items_consumption
  WHERE standard_item_id IN (
    '66660000-0000-0000-0000-0000000000aa',
    '66660000-0000-0000-0000-0000000000bb'
  );
  IF v_total_left <> 12 THEN RAISE EXCEPTION 'Total restante deveria ser 12 (4+6+2), tem %', v_total_left; END IF;
  RAISE NOTICE '✓ Caso 3: DELETE em modelo de 1 variante afeta só o próprio';
END
$$;

-- ----------------------------------------------------------------------------
-- CASO 4 — IDEMPOTÊNCIA: re-rodar o DELETE do Caso 1 não falha e não
-- altera mais nada.
-- ----------------------------------------------------------------------------
DELETE FROM sole_standard_items_consumption
WHERE standard_item_id = '66660000-0000-0000-0000-0000000000aa'
  AND sole_product_id IN (
    SELECT n2.id
    FROM _sole_norm n1
    JOIN _sole_norm n2 ON n1.group_key = n2.group_key
    WHERE n1.id = '77770001-0000-0000-0000-000000000001'  -- A-Caramelo
  );

DO $$
DECLARE v_total_left int;
BEGIN
  SELECT count(*) INTO v_total_left
  FROM sole_standard_items_consumption
  WHERE standard_item_id IN (
    '66660000-0000-0000-0000-0000000000aa',
    '66660000-0000-0000-0000-0000000000bb'
  );
  IF v_total_left <> 12 THEN RAISE EXCEPTION 'Re-DELETE não deveria alterar contagem (esperado 12), tem %', v_total_left; END IF;
  RAISE NOTICE '✓ Caso 4: re-DELETE é idempotente';
END
$$;

-- ----------------------------------------------------------------------------
-- CASO 5 — CASCATA por FK: deletar o produto solado remove suas linhas
-- (ON DELETE CASCADE garante limpeza).
-- ----------------------------------------------------------------------------
INSERT INTO sole_standard_items_consumption (sole_product_id, standard_item_id, size, consumption, unit)
VALUES
  ('77770001-0000-0000-0000-000000000001', '66660000-0000-0000-0000-0000000000aa', 39, 12.0, 'g');

DELETE FROM products WHERE id = '77770001-0000-0000-0000-000000000001';

DO $$
DECLARE v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM sole_standard_items_consumption
  WHERE sole_product_id = '77770001-0000-0000-0000-000000000001';
  IF v_orphans <> 0 THEN RAISE EXCEPTION 'CASCADE deveria ter removido as linhas órfãs, sobraram %', v_orphans; END IF;
  RAISE NOTICE '✓ Caso 5: CASCADE remove linhas quando o produto é apagado';
END
$$;

-- ----------------------------------------------------------------------------
-- Resumo final
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '===============================================';
  RAISE NOTICE '✅ TODOS OS CASOS DE DELETE-REPLICAÇÃO PASSARAM';
  RAISE NOTICE '===============================================';
END
$$;

ROLLBACK;
