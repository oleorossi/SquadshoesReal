-- Wave Material Intelligence
-- Adds timeline back-calculation and material shortage detection to production waves.
--
-- New columns on production_waves:
--   earliest_deadline, corte_start_date, costura_start_date,
--   purchase_deadline, material_ready_date
--
-- New RPC functions:
--   compute_wave_timeline(sale_order_ids[])   → returns stage dates
--   get_wave_material_needs(sale_order_ids[]) → returns material shortages + artisanal info
--   update_wave_timeline(wave_id)             → computes & persists timeline for an existing wave

-- ── 1. Timeline columns ────────────────────────────────────────────────────────
ALTER TABLE public.production_waves
  ADD COLUMN IF NOT EXISTS earliest_deadline   date,
  ADD COLUMN IF NOT EXISTS corte_start_date    date,
  ADD COLUMN IF NOT EXISTS costura_start_date  date,
  ADD COLUMN IF NOT EXISTS purchase_deadline   date,
  ADD COLUMN IF NOT EXISTS material_ready_date date;

-- ── 2. compute_wave_timeline ───────────────────────────────────────────────────
-- Back-calculates stage start dates from the earliest delivery_deadline among the
-- given sale orders. Uses MAX lead-time values from technical_sheets (conservative).
DROP FUNCTION IF EXISTS public.compute_wave_timeline(p_sale_order_ids uuid[]) CASCADE;
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline    date,
  corte_start_date     date,
  costura_start_date   date,
  montagem_start_date  date,
  acabamento_start_date date,
  material_ready_date  date,
  purchase_deadline    date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  -- Earliest delivery deadline from sale orders
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN
    RETURN; -- no deadlines → no timeline
  END IF;

  -- Worst-case (MAX) lead times from technical sheets in these orders
  SELECT
    COALESCE(MAX(ts.lead_time_corte_dias),           2),
    COALESCE(MAX(ts.lead_time_costura_dias),         3),
    COALESCE(MAX(ts.lead_time_montagem_dias),        2),
    COALESCE(MAX(ts.lead_time_acabamento_dias),      1),
    COALESCE(MAX(ts.lead_time_buffer_material_dias), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Max supplier lead time across all materials needed
  SELECT COALESCE(MAX(COALESCE(p.supplier_lead_time_days, 7)), 7)
    INTO v_lead_supplier
    FROM sale_order_items soi
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    JOIN products p ON p.id = sm.product_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  RETURN QUERY SELECT
    v_deadline AS earliest_deadline,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte)::date        AS corte_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura)::date                        AS costura_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem)::date         AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                  AS acabamento_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer)::date                         AS material_ready_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer - v_lead_supplier)::date        AS purchase_deadline;
END;
$$;

-- ── 3. get_wave_material_needs ─────────────────────────────────────────────────
-- Returns one row per (material, color) combination needed by the given sale orders.
-- For artisanal materials: also returns base-material requirements and OS send date.
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
  -- Compute corte start date for OS timing calculation (OS must arrive before corte)
  SELECT t.corte_start_date INTO v_corte_start
    FROM compute_wave_timeline(p_sale_order_ids) t
   LIMIT 1;

  RETURN QUERY
  WITH
  -- ── Aggregate material needs from sale order items ────────────────────────
  needed AS (
    SELECT
      sm.product_id,
      -- Use sheet_material color if set, otherwise use sale_order_item color
      COALESCE(NULLIF(sm.color, ''), soi.color, '') AS effective_color,
      SUM(sm.quantity_per_unit * soi.quantity)       AS needed_qty
    FROM sale_order_items soi
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    GROUP BY sm.product_id, COALESCE(NULLIF(sm.color, ''), soi.color, '')
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
    -- Artisanal recipe (matched by artisanal_product_name like product name)
    ar.id                                                 AS artisanal_recipe_id,
    ar.name                                               AS artisanal_recipe_name,
    -- Base product: find by base_product_name + color match
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
    -- OS must be sent at least 7 working days before corte
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

-- ── 4. update_wave_timeline ────────────────────────────────────────────────────
-- Computes and persists timeline columns for an already-created wave.
-- Called by the application after wave creation.
DROP FUNCTION IF EXISTS public.update_wave_timeline(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_order_ids uuid[];
  v_tl        record;
BEGIN
  SELECT array_agg(DISTINCT wis.sale_order_id)
    INTO v_order_ids
    FROM production_wave_item_sources wis
    JOIN production_wave_items wi ON wi.id = wis.wave_item_id
   WHERE wi.wave_id = p_wave_id
     AND wis.sale_order_id IS NOT NULL;

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_tl
    FROM compute_wave_timeline(v_order_ids)
   LIMIT 1;

  UPDATE public.production_waves
     SET earliest_deadline   = v_tl.earliest_deadline,
         corte_start_date    = v_tl.corte_start_date,
         costura_start_date  = v_tl.costura_start_date,
         purchase_deadline   = v_tl.purchase_deadline,
         material_ready_date = v_tl.material_ready_date,
         updated_at          = now()
   WHERE id = p_wave_id;
END;
$$;
