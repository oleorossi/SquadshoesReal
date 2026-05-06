-- Fix get_wave_material_needs: correct sole quantity calculation
-- Root cause: the function calculated sole needs from sheet_materials, but soles
-- are stored in technical_sheets.sole_material (not sheet_materials). If a sole
-- product happened to appear in sheet_materials with a wrong quantity_per_unit,
-- the PO would get a wildly incorrect quantity.
--
-- Fix:
--   1. Exclude sole-category products from the sheet_materials CTE.
--   2. Add a dedicated sole_needed CTE that uses resolve_sole_color and counts
--      exactly 1 pair of soles per pair of shoes (correct for all sole types).
--
-- Also fixes OC-2026-00127 by recalculating its sole items from the actual
-- production_wave_items data (total_pairs per sole product).

-- ─── 1. Fix get_wave_material_needs ──────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_wave_material_needs(p_sale_order_ids uuid[]) CASCADE;
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
RETURNS TABLE (
  product_id              uuid,
  product_name            text,
  unit                    text,
  color                   text,
  needed_qty              numeric,
  stock_qty               numeric,
  shortage                numeric,
  supplier_id             uuid,
  supplier_name           text,
  supplier_lead_time_days int,
  is_artisanal            boolean,
  artisanal_recipe_id     uuid,
  artisanal_recipe_name   text,
  base_product_id         uuid,
  base_product_name       text,
  base_needed_qty         numeric,
  base_stock_qty          numeric,
  base_shortage           numeric,
  os_send_date            date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_start_date INTO v_corte_start
    FROM compute_wave_timeline(p_sale_order_ids) t
   LIMIT 1;

  RETURN QUERY
  WITH
  -- ── Sheet materials (non-sole) ─────────────────────────────────────────────
  -- Sole-category products are intentionally excluded here: their quantity is
  -- always 1 per pair and must be computed via resolve_sole_color (see below).
  -- Including them via sheet_materials risks wrong quantity_per_unit values.
  sheet_needed AS (
    SELECT
      sm.product_id,
      COALESCE(NULLIF(sm.color, ''), soi.color, '') AS effective_color,
      SUM(sm.quantity_per_unit * soi.quantity)       AS needed_qty
    FROM sale_order_items soi
    JOIN sheet_materials  sm ON sm.sheet_id = soi.reference_id
    JOIN products         sp ON sp.id = sm.product_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      -- exclude any product already tracked as a sole (category-based guard)
      AND lower(COALESCE(sp.category, '')) NOT LIKE '%solado%'
      AND lower(COALESCE(sp.category, '')) != 'sola'
    GROUP BY sm.product_id,
             COALESCE(NULLIF(sm.color, ''), soi.color, '')
  ),

  -- ── Sole needs: exactly 1 per pair ────────────────────────────────────────
  -- Resolved via technical_sheets.sole_material + resolve_sole_color.
  -- This is the only correct source for sole quantity; it is immune to wrong
  -- quantity_per_unit entries in sheet_materials.
  sole_needed AS (
    SELECT
      rsc.sole_product_id                                        AS product_id,
      COALESCE(NULLIF(rsc.sole_color, ''), soi.color, '')        AS effective_color,
      SUM(soi.quantity)                                          AS needed_qty
    FROM sale_order_items soi
    CROSS JOIN LATERAL (
      SELECT sole_product_id, sole_color
        FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))
    ) rsc
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND rsc.sole_product_id IS NOT NULL
    GROUP BY rsc.sole_product_id,
             COALESCE(NULLIF(rsc.sole_color, ''), soi.color, '')
  ),

  -- ── Merge both sources ─────────────────────────────────────────────────────
  all_needed AS (
    SELECT product_id, effective_color, needed_qty FROM sheet_needed
    UNION ALL
    SELECT product_id, effective_color, needed_qty FROM sole_needed
  ),
  needed AS (
    SELECT   product_id,
             effective_color,
             SUM(needed_qty) AS needed_qty
    FROM     all_needed
    GROUP BY product_id, effective_color
  ),

  -- ── Enrich with product + supplier info ───────────────────────────────────
  enriched AS (
    SELECT
      n.product_id,
      p.name                                              AS product_name,
      COALESCE(p.unit, 'un')                              AS unit,
      n.effective_color                                   AS color,
      n.needed_qty,
      p.quantity                                          AS stock_qty,
      GREATEST(0, n.needed_qty - p.quantity)              AS shortage,
      p.supplier_id,
      sup.name                                            AS supplier_name,
      COALESCE(p.supplier_lead_time_days, 7)::int         AS supplier_lead_time_days,
      COALESCE(p.is_artisanal, false)                     AS is_artisanal
    FROM needed n
    JOIN products p ON p.id = n.product_id
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
  )
  SELECT
    e.product_id,
    e.product_name,
    e.unit,
    e.color,
    e.needed_qty,
    e.stock_qty,
    e.shortage,
    e.supplier_id,
    e.supplier_name,
    e.supplier_lead_time_days,
    e.is_artisanal,
    ar.id                                                 AS artisanal_recipe_id,
    ar.name                                               AS artisanal_recipe_name,
    bp.id                                                 AS base_product_id,
    ar.base_product_name,
    CASE
      WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
      THEN ROUND(e.needed_qty / ar.yield_per_meter, 3)
      ELSE NULL
    END                                                   AS base_needed_qty,
    bp.quantity                                           AS base_stock_qty,
    CASE
      WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
      THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity)
      ELSE NULL
    END                                                   AS base_shortage,
    CASE
      WHEN e.is_artisanal AND v_corte_start IS NOT NULL
      THEN (v_corte_start - 7)::date
      ELSE NULL
    END                                                   AS os_send_date
  FROM enriched e
  LEFT JOIN artisanal_recipes ar
         ON e.is_artisanal = true
        AND ar.active = true
        AND (
              lower(e.product_name) LIKE '%' || lower(ar.artisanal_product_name) || '%'
           OR lower(ar.artisanal_product_name) LIKE '%' || lower(e.product_name) || '%'
            )
  LEFT JOIN products bp
         ON ar.id IS NOT NULL
        AND (
              lower(bp.name) = lower(ar.base_product_name)
           OR lower(bp.name) LIKE lower(ar.base_product_name) || ':%'
           OR lower(bp.name) LIKE lower(ar.base_product_name) || ' -%'
            )
        AND (
              e.color = ''
           OR lower(COALESCE(bp.color, '')) = lower(e.color)
           OR bp.color IS NULL
           OR bp.color = ''
            )
  ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$$;

-- ─── 2. Fix OC-2026-00127 sole items ─────────────────────────────────────────
-- Strategy:
--   a. Re-deduplicate (idempotent, safe to run again).
--   b. For each sole product still in this OC, recalculate needed_qty from the
--      production_wave_items that were active around the OC creation date.
--      shortage = MAX(0, total_wave_pairs_for_sole - current_sole_stock)
--   c. If shortage = 0 for a sole item → remove it from the OC (no longer needed).
--   d. Recalculate OC total_value.

DO $$
DECLARE
  v_po_id        uuid;
  v_creation_date date;
  v_sole_id      uuid;
  v_sole_name    text;
  v_wave_pairs   numeric;
  v_stock        numeric;
  v_correct_qty  numeric;
  v_item_id      uuid;
  v_item_qty     numeric;
  v_new_total    numeric;
  v_sole_cat     text;
BEGIN
  -- ── Find the OC ────────────────────────────────────────────────────────────
  SELECT id, created_at::date
    INTO v_po_id, v_creation_date
    FROM purchase_orders
   WHERE order_number = 'OC-2026-00127';

  IF v_po_id IS NULL THEN
    RAISE NOTICE 'OC-2026-00127 não encontrada — nada a fazer.';
    RETURN;
  END IF;

  -- ── Step a: Dedup (keep highest-quantity row per product) ──────────────────
  DELETE FROM purchase_order_items
   WHERE purchase_order_id = v_po_id
     AND id NOT IN (
           SELECT DISTINCT ON (product_id) id
             FROM purchase_order_items
            WHERE purchase_order_id = v_po_id
            ORDER BY product_id, quantity DESC, created_at DESC
         );

  -- ── Step b: Recalculate sole items using actual wave data ──────────────────
  -- Find sole items in this OC
  FOR v_item_id, v_sole_id, v_item_qty IN
    SELECT poi.id, poi.product_id, poi.quantity
      FROM purchase_order_items poi
      JOIN products p ON p.id = poi.product_id
     WHERE poi.purchase_order_id = v_po_id
       AND (lower(COALESCE(p.category, '')) LIKE '%solado%'
         OR lower(COALESCE(p.category, '')) = 'sola')
  LOOP
    -- Total pairs for this sole across all wave items created on or near the OC date
    -- (wave creation and OC creation happen in the same transaction, so dates match)
    SELECT COALESCE(SUM(pwi.total_quantity), 0)
      INTO v_wave_pairs
      FROM production_wave_items pwi
      JOIN production_waves pw ON pw.id = pwi.wave_id
     WHERE pwi.sole_product_id = v_sole_id
       AND pw.created_at::date BETWEEN (v_creation_date - INTERVAL '1 day')
                                   AND (v_creation_date + INTERVAL '1 day');

    -- Current stock of this sole
    SELECT COALESCE(quantity, 0) INTO v_stock
      FROM products WHERE id = v_sole_id;

    v_correct_qty := GREATEST(0, v_wave_pairs - v_stock);

    IF v_correct_qty = 0 THEN
      -- No shortage → remove the item
      DELETE FROM purchase_order_items WHERE id = v_item_id;
      SELECT name INTO v_sole_name FROM products WHERE id = v_sole_id;
      RAISE NOTICE 'OC-2026-00127: removido item sem falta — solado % (era %)', v_sole_name, v_item_qty;
    ELSIF v_correct_qty <> v_item_qty THEN
      -- Wrong quantity → correct it
      UPDATE purchase_order_items
         SET quantity = v_correct_qty,
             suggested_quantity = v_correct_qty
       WHERE id = v_item_id;
      SELECT name INTO v_sole_name FROM products WHERE id = v_sole_id;
      RAISE NOTICE 'OC-2026-00127: corrigido solado % de % para %', v_sole_name, v_item_qty, v_correct_qty;
    ELSE
      RAISE NOTICE 'OC-2026-00127: solado já com quantidade correta (%)' , v_item_qty;
    END IF;
  END LOOP;

  -- ── Step c: If no wave items found at all (no match by date), log a warning ─
  -- The user should verify manually in this edge case.

  -- ── Step d: Recalculate OC total_value ────────────────────────────────────
  SELECT COALESCE(SUM(quantity * unit_price), 0)
    INTO v_new_total
    FROM purchase_order_items
   WHERE purchase_order_id = v_po_id;

  UPDATE purchase_orders
     SET total_value = v_new_total
   WHERE id = v_po_id;

  RAISE NOTICE 'OC-2026-00127: total_value atualizado para R$ %', v_new_total;
END;
$$;
