-- =============================================================================
-- 20260515170000 — Auditoria pós-fix da cola: forro + backfill de primary_sole
-- =============================================================================
--
-- Continuação da auditoria que começou no fix do custo de cola (commit f32d830,
-- migration 20260515160000). Três achados adicionais tratados aqui:
--
-- #1 sheet_materials Forro 5.7 m/par (12 linhas — dados mortos)
--    6 fichas (SP101, SP105, SP117, SP119, DS15, DS19) tinham 2 entradas cada
--    (NAPA SANTORINE + NAPA SOFT) com quantity_per_unit=5.7 m/par e nota "Item
--    padrão do solado". Provavelmente seed automático antigo. NÃO estavam
--    sendo usadas pelo cálculo (a função calculate_order_consumption_by_grade
--    usa technical_sheets.lining_material em vez do BOM pra Forro), mas
--    explodiriam se a função fosse alterada. DELETE seguro.
--
-- #2 technical_sheets.lining_consumption_per_size com valores absurdos
--    4 fichas (SP101, SP105, ST15, ST17) tinham consumo de forro em 5.7 m/par
--    em todos os tamanhos — claramente errado (real ~0.3-0.5 m). UPDATE pra
--    0.5 m/par. Ainda restam 23 fichas com lining_consumption_per_size vazio
--    (cai em fallback_average ~0.04 m, subestimado) — NÃO tocadas porque o
--    valor real varia por modelo; criada view v_sheets_missing_lining_consumption
--    pro usuário preencher.
--
-- #3 primary_sole_id NULL em 17 fichas
--    Coluna usada por soleAvailability.ts (check de estoque pré-aprovação).
--    Backfill por match exato de nome (case-insensitive) entre
--    technical_sheets.sole_material e products.name de categoria solado.
--    Pega 17 fichas. Não toca em fichas sem match (ex: "SOLADO: CARAMELO -
--    Caramelo" tem formato bizarro, sem produto correspondente).
--
-- Recálculo: marca costs_dirty_at nos 6 PVs com OPs ativas das 4 fichas
-- corrigidas em #2. Snapshots e order_costs apagados pra forçar refazer.
--
-- View v_sheets_missing_lining_consumption: lista as 23 fichas pendentes
-- pra o usuário preencher manualmente o consumo de forro por modelo.

-- ── #1 DELETE Forro 5.7 (dados mortos) ──────────────────────────────────────
DELETE FROM sheet_materials sm
 USING products p
 WHERE sm.product_id = p.id
   AND p.category = 'Forro'
   AND sm.quantity_per_unit > 2;

-- ── #2 UPDATE lining absurdo (>2 m/par) pra 0.5 m/par ──────────────────────
UPDATE technical_sheets
   SET lining_consumption_per_size = (
     SELECT jsonb_object_agg(k, 0.5)
       FROM jsonb_object_keys(lining_consumption_per_size) k
   )
 WHERE lining_material IS NOT NULL AND lining_material <> ''
   AND EXISTS (
     SELECT 1 FROM jsonb_each_text(lining_consumption_per_size) e
      WHERE e.value::numeric > 2
   );

-- ── #2b View pendentes (pro usuário preencher por modelo) ──────────────────
DROP VIEW IF EXISTS v_sheets_missing_lining_consumption;
CREATE OR REPLACE VIEW v_sheets_missing_lining_consumption AS
SELECT id, code, name, lining_material,
       jsonb_array_length(
         COALESCE((SELECT jsonb_agg(k) FROM jsonb_object_keys(upper_consumption_per_size) k), '[]'::jsonb)
       ) AS sizes_no_upper,
       upper_consumption_per_size AS upper_template
  FROM technical_sheets
 WHERE lining_material IS NOT NULL AND lining_material <> ''
   AND (lining_consumption_per_size IS NULL OR lining_consumption_per_size = '{}'::jsonb)
 ORDER BY name;

GRANT SELECT ON v_sheets_missing_lining_consumption TO authenticated;

-- ── #3 Backfill primary_sole_id ────────────────────────────────────────────
WITH matches AS (
  SELECT ts.id AS sheet_id, p.id AS product_id
    FROM technical_sheets ts
    JOIN products p ON lower(trim(p.name)) = lower(trim(ts.sole_material))
   WHERE ts.primary_sole_id IS NULL
     AND ts.sole_material IS NOT NULL AND ts.sole_material <> ''
     AND p.category ILIKE '%solado%'
),
unique_matches AS (
  SELECT DISTINCT ON (sheet_id) sheet_id, product_id FROM matches
)
UPDATE technical_sheets ts
   SET primary_sole_id = um.product_id
  FROM unique_matches um
 WHERE ts.id = um.sheet_id;

-- ── Recálculo dos PVs afetados pelo fix #2 ────────────────────────────────
WITH ref_ids AS (
  SELECT id FROM technical_sheets WHERE name IN ('SP101', 'SP105', 'ST15', 'ST17')
),
affected_orders AS (
  SELECT DISTINCT i.sale_order_id
    FROM sale_order_items i
   WHERE i.reference_id IN (SELECT id FROM ref_ids)
),
del_snaps AS (
  DELETE FROM technical_sheet_snapshots
   WHERE sale_order_id IN (SELECT sale_order_id FROM affected_orders)
  RETURNING 1
),
del_costs AS (
  DELETE FROM order_costs
   WHERE sale_order_id IN (SELECT sale_order_id FROM affected_orders)
  RETURNING 1
)
UPDATE sale_orders SET costs_dirty_at = now()
 WHERE id IN (SELECT sale_order_id FROM affected_orders);
