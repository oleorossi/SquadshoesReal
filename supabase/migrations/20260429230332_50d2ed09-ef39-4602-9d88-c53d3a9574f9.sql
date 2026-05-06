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
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_start_date INTO v_corte_start
    FROM compute_wave_timeline(p_sale_order_ids) t
   LIMIT 1;

  RETURN QUERY
  WITH
  sheet_needed AS (
    SELECT
      sm.product_id,
      COALESCE(NULLIF(sm.color, ''), soi.color, '') AS effective_color,
      SUM(sm.quantity_per_unit * soi.quantity)       AS needed_qty
    FROM sale_order_items soi
    JOIN sheet_materials  sm ON sm.sheet_id = soi.reference_id
    JOIN products         sp ON sp.id = sm.product_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND lower(COALESCE(sp.category, '')) NOT LIKE '%solado%'
      AND lower(COALESCE(sp.category, '')) != 'sola'
    GROUP BY sm.product_id,
             COALESCE(NULLIF(sm.color, ''), soi.color, '')
  ),
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
BEGIN
  SELECT id, created_at::date
    INTO v_po_id, v_creation_date
    FROM purchase_orders
   WHERE order_number = 'OC-2026-00127';

  IF v_po_id IS NULL THEN
    RAISE NOTICE 'OC-2026-00127 não encontrada — nada a fazer.';
    RETURN;
  END IF;

  DELETE FROM purchase_order_items
   WHERE purchase_order_id = v_po_id
     AND id NOT IN (
           SELECT DISTINCT ON (product_id) id
             FROM purchase_order_items
            WHERE purchase_order_id = v_po_id
            ORDER BY product_id, quantity DESC, created_at DESC
         );

  FOR v_item_id, v_sole_id, v_item_qty IN
    SELECT poi.id, poi.product_id, poi.quantity
      FROM purchase_order_items poi
      JOIN products p ON p.id = poi.product_id
     WHERE poi.purchase_order_id = v_po_id
       AND (lower(COALESCE(p.category, '')) LIKE '%solado%'
         OR lower(COALESCE(p.category, '')) = 'sola')
  LOOP
    SELECT COALESCE(SUM(pwi.total_quantity), 0)
      INTO v_wave_pairs
      FROM production_wave_items pwi
      JOIN production_waves pw ON pw.id = pwi.wave_id
     WHERE pwi.sole_product_id = v_sole_id
       AND pw.created_at::date BETWEEN (v_creation_date - INTERVAL '1 day')
                                   AND (v_creation_date + INTERVAL '1 day');

    SELECT COALESCE(quantity, 0) INTO v_stock
      FROM products WHERE id = v_sole_id;

    v_correct_qty := GREATEST(0, v_wave_pairs - v_stock);

    IF v_correct_qty = 0 THEN
      DELETE FROM purchase_order_items WHERE id = v_item_id;
      SELECT name INTO v_sole_name FROM products WHERE id = v_sole_id;
      RAISE NOTICE 'Removido solado sem falta: % (era %)', v_sole_name, v_item_qty;
    ELSIF v_correct_qty <> v_item_qty THEN
      UPDATE purchase_order_items
         SET quantity = v_correct_qty,
             suggested_quantity = v_correct_qty
       WHERE id = v_item_id;
      SELECT name INTO v_sole_name FROM products WHERE id = v_sole_id;
      RAISE NOTICE 'Corrigido solado % de % para %', v_sole_name, v_item_qty, v_correct_qty;
    ELSE
      RAISE NOTICE 'Solado já com quantidade correta (%)', v_item_qty;
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(quantity * unit_price), 0)
    INTO v_new_total
    FROM purchase_order_items
   WHERE purchase_order_id = v_po_id;

  UPDATE purchase_orders SET total_value = v_new_total WHERE id = v_po_id;

  RAISE NOTICE 'OC-2026-00127 finalizada — total R$ %', v_new_total;
END;
$$;