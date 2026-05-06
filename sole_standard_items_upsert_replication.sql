-- =============================================================================
-- Teste de integração SQL para REPLICAÇÃO POR MODELO no upsert
-- de sole_standard_items_consumption.
--
-- Premissa industrial: cor de solado é IRRELEVANTE para o consumo dos
-- itens compartilhados (cola, palmilha, forro, linha, EVA…). Logo, ao
-- salvar consumo para uma variante, o resultado final no banco deve
-- conter linhas IDÊNTICAS (mesmo standard_item_id, mesmo size, mesmo
-- consumption) para TODAS as variantes do mesmo modelo.
--
-- Este teste reproduz a mesma resolução de "siblings" que o hook
-- useUpsertSoleStandardItem faz em JS — agrupando por nome normalizado
-- (sufixo de cor removido), restrito à categoria 'solado'.
-- =============================================================================

BEGIN;
SET LOCAL search_path = public;

-- ----------------------------------------------------------------------------
-- Limpeza defensiva
-- ----------------------------------------------------------------------------
DELETE FROM sole_standard_items_consumption WHERE sole_product_id IN (
  '88880001-0000-0000-0000-000000000001',
  '88880001-0000-0000-0000-000000000002',
  '88880001-0000-0000-0000-000000000003',
  '88880002-0000-0000-0000-000000000001',
  '88880002-0000-0000-0000-000000000002',
  '88880003-0000-0000-0000-000000000001'
) OR standard_item_id IN (
  '99990000-0000-0000-0000-0000000000aa',
  '99990000-0000-0000-0000-0000000000bb'
);

DELETE FROM products WHERE id IN (
  '88880001-0000-0000-0000-000000000001',
  '88880001-0000-0000-0000-000000000002',
  '88880001-0000-0000-0000-000000000003',
  '88880002-0000-0000-0000-000000000001',
  '88880002-0000-0000-0000-000000000002',
  '88880003-0000-0000-0000-000000000001',
  '99990000-0000-0000-0000-0000000000aa',
  '99990000-0000-0000-0000-0000000000bb'
);

-- ----------------------------------------------------------------------------
-- SEED — 3 modelos de solado com várias cores, e 2 itens padrão (cola, linha)
-- ----------------------------------------------------------------------------
-- Modelo X: 3 variantes
-- Modelo Y: 2 variantes
-- Modelo Z: 1 variante
INSERT INTO products (id, name, category, color, quantity, active, unit) VALUES
  ('88880001-0000-0000-0000-000000000001', 'TEST_SOLADO_X Caramelo', 'solado',  'Caramelo', 100, true, 'PAR'),
  ('88880001-0000-0000-0000-000000000002', 'TEST_SOLADO_X Preto',    'solado',  'Preto',    100, true, 'PAR'),
  ('88880001-0000-0000-0000-000000000003', 'TEST_SOLADO_X Marrom',   'solado',  'Marrom',   100, true, 'PAR'),
  ('88880002-0000-0000-0000-000000000001', 'TEST_SOLADO_Y Caramelo', 'solado',  'Caramelo', 100, true, 'PAR'),
  ('88880002-0000-0000-0000-000000000002', 'TEST_SOLADO_Y Preto',    'solado',  'Preto',    100, true, 'PAR'),
  ('88880003-0000-0000-0000-000000000001', 'TEST_SOLADO_Z Preto',    'solado',  'Preto',    100, true, 'PAR'),
  ('99990000-0000-0000-0000-0000000000aa', 'TEST_ITEM_COLA',         'químico', NULL,       100, true, 'g'),
  ('99990000-0000-0000-0000-0000000000bb', 'TEST_ITEM_LINHA',        'aviamento', NULL,     100, true, 'm');

-- ----------------------------------------------------------------------------
-- Helper: resolve sibling ids por nome normalizado (mesma lógica do hook).
-- O regex remove o sufixo de cor (após espaço/-/–/—//) no FIM do nome.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _sole_normalized AS
SELECT
  id,
  name,
  -- normaliza nome: lowercase + remove acento + remove sufixo de cor no fim
  regexp_replace(
    lower(unaccent(name)),
    '[\s\-/–—]+(caramelo|preto|preta|marrom|bege|branco|branca|natural|cinza|vermelho|vermelha|azul|verde|amarelo|amarela|rosa|nude|cafe|chocolate|tabaco|conhaque|off white|off-white)\s*$',
    ''
  ) AS group_key
FROM products
WHERE lower(category) LIKE '%solado%' OR lower(category) = 'sola';

-- Sanity: confere agrupamento por nome
DO $$
DECLARE
  v_x_count int;
  v_y_count int;
  v_z_count int;
BEGIN
  SELECT count(*) INTO v_x_count FROM _sole_normalized WHERE group_key = 'test_solado_x';
  SELECT count(*) INTO v_y_count FROM _sole_normalized WHERE group_key = 'test_solado_y';
  SELECT count(*) INTO v_z_count FROM _sole_normalized WHERE group_key = 'test_solado_z';
  IF v_x_count <> 3 THEN RAISE EXCEPTION 'Modelo X deveria ter 3 variantes, achei %', v_x_count; END IF;
  IF v_y_count <> 2 THEN RAISE EXCEPTION 'Modelo Y deveria ter 2 variantes, achei %', v_y_count; END IF;
  IF v_z_count <> 1 THEN RAISE EXCEPTION 'Modelo Z deveria ter 1 variante, achei %', v_z_count; END IF;
  RAISE NOTICE '✓ Agrupamento por modelo OK (X=3, Y=2, Z=1)';
END
$$;

-- ----------------------------------------------------------------------------
-- CASO 1 — upsert de COLA via X-Caramelo, tamanhos 37/38/39, deve
-- propagar para X-Preto e X-Marrom.
-- ----------------------------------------------------------------------------
WITH siblings AS (
  SELECT n2.id
  FROM _sole_normalized n1
  JOIN _sole_normalized n2 ON n1.group_key = n2.group_key
  WHERE n1.id = '88880001-0000-0000-0000-000000000001'  -- X-Caramelo
),
to_upsert AS (
  SELECT s.id AS sole_product_id,
         '99990000-0000-0000-0000-0000000000aa'::uuid AS standard_item_id,
         sz.size,
         sz.consumption,
         'g'::text AS unit
  FROM siblings s
  CROSS JOIN (VALUES (37, 10.0), (38, 11.0), (39, 12.0)) AS sz(size, consumption)
)
INSERT INTO sole_standard_items_consumption (sole_product_id, standard_item_id, size, consumption, unit)
SELECT sole_product_id, standard_item_id, size, consumption, unit FROM to_upsert
ON CONFLICT (sole_product_id, standard_item_id, size) DO UPDATE
  SET consumption = EXCLUDED.consumption, unit = EXCLUDED.unit, updated_at = now();

-- VERIFICAÇÃO 1: as 3 variantes do modelo X têm linhas para 37/38/39
DO $$
DECLARE
  v_count_x int;
  v_count_y int;
  v_count_z int;
  v_distinct_sole int;
BEGIN
  SELECT count(*) INTO v_count_x
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000aa'
    AND sole_product_id IN (
      '88880001-0000-0000-0000-000000000001',
      '88880001-0000-0000-0000-000000000002',
      '88880001-0000-0000-0000-000000000003'
    );

  SELECT count(*) INTO v_count_y
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000aa'
    AND sole_product_id IN (
      '88880002-0000-0000-0000-000000000001',
      '88880002-0000-0000-0000-000000000002'
    );

  SELECT count(*) INTO v_count_z
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000aa'
    AND sole_product_id = '88880003-0000-0000-0000-000000000001';

  SELECT count(DISTINCT sole_product_id) INTO v_distinct_sole
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000aa';

  IF v_count_x <> 9 THEN RAISE EXCEPTION 'Modelo X deveria ter 9 linhas (3 variantes × 3 tamanhos), tem %', v_count_x; END IF;
  IF v_count_y <> 0 THEN RAISE EXCEPTION 'Modelo Y NÃO deveria ter linhas (sem propagação cruzada), tem %', v_count_y; END IF;
  IF v_count_z <> 0 THEN RAISE EXCEPTION 'Modelo Z NÃO deveria ter linhas, tem %', v_count_z; END IF;
  IF v_distinct_sole <> 3 THEN RAISE EXCEPTION 'Total de solados distintos deveria ser 3, é %', v_distinct_sole; END IF;
  RAISE NOTICE '✓ Caso 1: upsert em X-Caramelo propagou para 3 variantes do modelo X';
END
$$;

-- VERIFICAÇÃO 1.B: o consumption é IDÊNTICO entre as variantes para cada tamanho.
DO $$
DECLARE
  v_distinct_consumption int;
BEGIN
  SELECT count(DISTINCT consumption)
    INTO v_distinct_consumption
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000aa'
    AND size = 37;
  IF v_distinct_consumption <> 1 THEN
    RAISE EXCEPTION 'Tamanho 37: consumption deveria ser idêntico entre variantes, mas há % valores distintos', v_distinct_consumption;
  END IF;
  RAISE NOTICE '✓ Caso 1.B: consumo idêntico entre variantes (sem divergência por cor)';
END
$$;

-- ----------------------------------------------------------------------------
-- CASO 2 — upsert de LINHA via Y-Preto, tamanhos 37/38, propaga só para Y.
-- ----------------------------------------------------------------------------
WITH siblings AS (
  SELECT n2.id
  FROM _sole_normalized n1
  JOIN _sole_normalized n2 ON n1.group_key = n2.group_key
  WHERE n1.id = '88880002-0000-0000-0000-000000000002'  -- Y-Preto
),
to_upsert AS (
  SELECT s.id AS sole_product_id,
         '99990000-0000-0000-0000-0000000000bb'::uuid AS standard_item_id,
         sz.size,
         sz.consumption,
         'm'::text AS unit
  FROM siblings s
  CROSS JOIN (VALUES (37, 1.5), (38, 1.6)) AS sz(size, consumption)
)
INSERT INTO sole_standard_items_consumption (sole_product_id, standard_item_id, size, consumption, unit)
SELECT * FROM to_upsert
ON CONFLICT (sole_product_id, standard_item_id, size) DO UPDATE
  SET consumption = EXCLUDED.consumption, unit = EXCLUDED.unit, updated_at = now();

DO $$
DECLARE
  v_count_y int;
  v_count_x int;
  v_count_z int;
BEGIN
  SELECT count(*) INTO v_count_y
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000bb'
    AND sole_product_id IN (
      '88880002-0000-0000-0000-000000000001',
      '88880002-0000-0000-0000-000000000002'
    );
  SELECT count(*) INTO v_count_x
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000bb'
    AND sole_product_id IN (
      '88880001-0000-0000-0000-000000000001',
      '88880001-0000-0000-0000-000000000002',
      '88880001-0000-0000-0000-000000000003'
    );
  SELECT count(*) INTO v_count_z
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000bb'
    AND sole_product_id = '88880003-0000-0000-0000-000000000001';

  IF v_count_y <> 4 THEN RAISE EXCEPTION 'Modelo Y deveria ter 4 linhas (2×2), tem %', v_count_y; END IF;
  IF v_count_x <> 0 THEN RAISE EXCEPTION 'Modelo X NÃO deveria ter LINHA, tem %', v_count_x; END IF;
  IF v_count_z <> 0 THEN RAISE EXCEPTION 'Modelo Z NÃO deveria ter LINHA, tem %', v_count_z; END IF;
  RAISE NOTICE '✓ Caso 2: upsert em Y-Preto propagou apenas para variantes do modelo Y (isolamento entre modelos)';
END
$$;

-- ----------------------------------------------------------------------------
-- CASO 3 — modelo com 1 só variante (Z) não inflaciona linhas.
-- ----------------------------------------------------------------------------
WITH siblings AS (
  SELECT n2.id
  FROM _sole_normalized n1
  JOIN _sole_normalized n2 ON n1.group_key = n2.group_key
  WHERE n1.id = '88880003-0000-0000-0000-000000000001'  -- Z-Preto (único)
)
INSERT INTO sole_standard_items_consumption (sole_product_id, standard_item_id, size, consumption, unit)
SELECT s.id, '99990000-0000-0000-0000-0000000000aa'::uuid, 37, 7.5, 'g' FROM siblings s
ON CONFLICT (sole_product_id, standard_item_id, size) DO UPDATE
  SET consumption = EXCLUDED.consumption;

DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM sole_standard_items_consumption
  WHERE sole_product_id = '88880003-0000-0000-0000-000000000001'
    AND standard_item_id = '99990000-0000-0000-0000-0000000000aa';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Modelo Z (1 variante) deveria ter 1 linha, tem %', v_count; END IF;
  RAISE NOTICE '✓ Caso 3: modelo com 1 variante não infla linhas';
END
$$;

-- ----------------------------------------------------------------------------
-- CASO 4 — IDEMPOTÊNCIA: re-rodar o upsert do Caso 1 com novos valores
-- atualiza (sem duplicar) e mantém a propagação.
-- ----------------------------------------------------------------------------
WITH siblings AS (
  SELECT n2.id
  FROM _sole_normalized n1
  JOIN _sole_normalized n2 ON n1.group_key = n2.group_key
  WHERE n1.id = '88880001-0000-0000-0000-000000000003'  -- X-Marrom desta vez
),
to_upsert AS (
  SELECT s.id AS sole_product_id,
         '99990000-0000-0000-0000-0000000000aa'::uuid AS standard_item_id,
         sz.size,
         sz.consumption,
         'g'::text AS unit
  FROM siblings s
  CROSS JOIN (VALUES (37, 99.0), (38, 99.0), (39, 99.0)) AS sz(size, consumption)
)
INSERT INTO sole_standard_items_consumption (sole_product_id, standard_item_id, size, consumption, unit)
SELECT * FROM to_upsert
ON CONFLICT (sole_product_id, standard_item_id, size) DO UPDATE
  SET consumption = EXCLUDED.consumption, unit = EXCLUDED.unit, updated_at = now();

DO $$
DECLARE
  v_count int;
  v_distinct_consumption int;
  v_value numeric;
BEGIN
  SELECT count(*) INTO v_count
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000aa'
    AND sole_product_id IN (
      '88880001-0000-0000-0000-000000000001',
      '88880001-0000-0000-0000-000000000002',
      '88880001-0000-0000-0000-000000000003'
    );
  IF v_count <> 9 THEN RAISE EXCEPTION 'Após re-upsert, modelo X deveria continuar com 9 linhas, tem %', v_count; END IF;

  SELECT count(DISTINCT consumption) INTO v_distinct_consumption
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000aa'
    AND sole_product_id IN (
      '88880001-0000-0000-0000-000000000001',
      '88880001-0000-0000-0000-000000000002',
      '88880001-0000-0000-0000-000000000003'
    );
  IF v_distinct_consumption <> 1 THEN
    RAISE EXCEPTION 'Após re-upsert, todas as variantes deveriam ter o mesmo consumo (99), mas há % valores distintos', v_distinct_consumption;
  END IF;

  SELECT consumption INTO v_value
  FROM sole_standard_items_consumption
  WHERE standard_item_id = '99990000-0000-0000-0000-0000000000aa'
    AND sole_product_id = '88880001-0000-0000-0000-000000000001'
    AND size = 37;
  IF v_value <> 99.0 THEN RAISE EXCEPTION 'X-Caramelo tamanho 37 deveria ter sido atualizado para 99, mas é %', v_value; END IF;

  RAISE NOTICE '✓ Caso 4: re-upsert é idempotente e atualiza valores (sem duplicar) em todas as variantes';
END
$$;

-- ----------------------------------------------------------------------------
-- Resumo final
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '===============================================';
  RAISE NOTICE '✅ TODOS OS CASOS DE UPSERT-REPLICAÇÃO PASSARAM';
  RAISE NOTICE '===============================================';
END
$$;

ROLLBACK;
