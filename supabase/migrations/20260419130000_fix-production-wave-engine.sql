-- =============================================================================
-- FIX PRODUCTION WAVE ENGINE
-- Fixes 4 bugs identified in the wave system:
--   1. resolve_billing_week_for_order: wrong JOIN (ts.product_id → ts.id)
--   2. split_wave_to_finishing: grade jsonb_object_agg loses duplicate keys instead of summing
--   3. v_sector_board: next_wave shows all-pending waves for ALL sectors (should respect order)
--   4. production_wave_item_sources: missing UNIQUE constraint (ON CONFLICT DO NOTHING never fires)
-- =============================================================================

-- 1. Fix resolve_billing_week_for_order ---------------------------------------------------
-- sale_order_items.reference_id is a technical_sheets.id (FK confirmed).
-- Both previous versions had wrong JOINs:
--   v1 (20260419005623): ts.product_id = soi.reference_id  (field doesn't exist)
--   v2 (20260419005802): via products table + LOWER(ts.name) = LOWER(p.name)  (fragile name match)
-- Correct: JOIN technical_sheets ts ON ts.id = soi.reference_id

DROP FUNCTION IF EXISTS public.resolve_billing_week_for_order(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_billing_week_for_order(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing_week date;
  v_delivery date;
  v_lead_days int;
  v_target date;
BEGIN
  SELECT billing_week, delivery_deadline
    INTO v_billing_week, v_delivery
    FROM sale_orders
   WHERE id = p_sale_order_id;

  -- 1) explicit billing_week wins — snap to monday
  IF v_billing_week IS NOT NULL THEN
    RETURN v_billing_week - ((EXTRACT(ISODOW FROM v_billing_week)::int - 1));
  END IF;

  IF v_delivery IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2) lead time from the technical sheet directly referenced by the item
  --    (sale_order_items.reference_id IS a technical_sheets.id)
  SELECT COALESCE(ts.lead_time_corte_dias, 0)
       + COALESCE(ts.lead_time_costura_dias, 0)
       + COALESCE(ts.lead_time_montagem_dias, 0)
       + COALESCE(ts.lead_time_acabamento_dias, 0)
       + COALESCE(ts.lead_time_buffer_material_dias, 0)
    INTO v_lead_days
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = p_sale_order_id
     AND COALESCE(ts.lead_time_corte_dias, 0)
       + COALESCE(ts.lead_time_costura_dias, 0)
       + COALESCE(ts.lead_time_montagem_dias, 0)
       + COALESCE(ts.lead_time_acabamento_dias, 0)
       + COALESCE(ts.lead_time_buffer_material_dias, 0) > 0
   ORDER BY 1 DESC
   LIMIT 1;

  -- 3) fallback to default_lead_times table
  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    SELECT COALESCE(lead_time_corte_dias, 0)
         + COALESCE(lead_time_costura_dias, 0)
         + COALESCE(lead_time_montagem_dias, 0)
         + COALESCE(lead_time_acabamento_dias, 0)
         + COALESCE(lead_time_buffer_material_dias, 0)
      INTO v_lead_days
      FROM default_lead_times
     ORDER BY shoe_category
     LIMIT 1;
  END IF;

  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    v_lead_days := 21;
  END IF;

  v_target := v_delivery - v_lead_days;
  -- snap to monday
  RETURN v_target - ((EXTRACT(ISODOW FROM v_target)::int - 1));
END;
$$;


-- 2. Fix split_wave_to_finishing grade aggregation ----------------------------------------
-- Problem: jsonb_object_agg(k, v) keeps only one value per key (last-wins).
--          When two source rows both have size "38", one value is silently dropped.
--          Additionally, the LATERAL join multiplied src.quantity by the number of grade keys.
-- Fix: separate quantity aggregation (no LATERAL) from grade aggregation (with SUM per key).

DROP FUNCTION IF EXISTS public.split_wave_to_finishing(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.split_wave_to_finishing(p_wave_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  DELETE FROM production_finishing_packages WHERE wave_id = p_wave_id;

  INSERT INTO production_finishing_packages(
    wave_id, sale_order_id, store_name, reference_id, color, quantity, grade
  )
  WITH qty_agg AS (
    -- Sum total quantity per (wave, order, reference, color) WITHOUT grade expansion
    -- to avoid multiplication by number of grade keys
    SELECT
      wi.wave_id,
      src.sale_order_id,
      src.store_name,
      wi.reference_id,
      wi.color,
      SUM(src.quantity) AS quantity
    FROM production_wave_items wi
    JOIN production_wave_item_sources src ON src.wave_item_id = wi.id
    WHERE wi.wave_id = p_wave_id
    GROUP BY wi.wave_id, src.sale_order_id, src.store_name, wi.reference_id, wi.color
  ),
  grade_keys AS (
    -- Expand grade JSONB and SUM per size key (so duplicates across multiple sources are summed)
    SELECT
      wi.wave_id,
      src.sale_order_id,
      src.store_name,
      wi.reference_id,
      wi.color,
      g.k,
      SUM(g.v) AS size_qty
    FROM production_wave_items wi
    JOIN production_wave_item_sources src ON src.wave_item_id = wi.id
    JOIN LATERAL (
      SELECT key AS k, (value::text)::numeric AS v
      FROM jsonb_each_text(src.grade)
      WHERE key ~ '^[0-9]+$'
    ) g ON TRUE
    WHERE wi.wave_id = p_wave_id
    GROUP BY wi.wave_id, src.sale_order_id, src.store_name, wi.reference_id, wi.color, g.k
  ),
  grade_agg AS (
    -- Re-assemble summed keys into JSONB
    SELECT
      wave_id, sale_order_id, store_name, reference_id, color,
      jsonb_object_agg(k, size_qty) AS grade
    FROM grade_keys
    GROUP BY wave_id, sale_order_id, store_name, reference_id, color
  )
  SELECT
    q.wave_id,
    q.sale_order_id,
    q.store_name,
    q.reference_id,
    q.color,
    q.quantity,
    COALESCE(g.grade, '{}'::jsonb) AS grade
  FROM qty_agg q
  LEFT JOIN grade_agg g USING (wave_id, sale_order_id, store_name, reference_id, color);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.split_wave_to_finishing(uuid) TO authenticated;


-- 3. Fix v_sector_board next_wave ---------------------------------------------------------
-- Problem: A newly created wave (all 5 stages = 'pending') shows up as next_wave for ALL
--          5 sector columns simultaneously. A sector should only queue a wave as its
--          "next" if that wave's *previous* stage is already completed (or it's the first
--          sector, corte).
-- Fix: add existence check on the previous stage being 'completed' for that specific wave.

DROP VIEW IF EXISTS public.v_sector_board CASCADE;
CREATE OR REPLACE VIEW public.v_sector_board AS
WITH stages AS (
  SELECT s.stage,
         w.id AS wave_id, w.code AS wave_code, w.week_start, w.week_end,
         s.status AS stage_status,
         s.progress_pct,
         s.started_at, s.finished_at,
         w.total_pairs,
         stage_order(s.stage) AS ord
  FROM production_wave_stages s
  JOIN production_waves w ON w.id = s.wave_id
  WHERE w.status IN ('running', 'planning')
)
SELECT stage, ord,
       (SELECT jsonb_build_object(
           'wave_id', wave_id, 'code', wave_code,
           'week_start', week_start, 'week_end', week_end,
           'progress_pct', progress_pct, 'total_pairs', total_pairs,
           'started_at', started_at
         )
         FROM stages s2
         WHERE s2.stage = stages.stage AND s2.stage_status = 'in_progress'
         LIMIT 1) AS active_wave,
       -- next_wave: only queue a pending wave if it's ready for this sector
       -- (first sector has no prerequisite; others need the previous stage completed)
       (SELECT jsonb_build_object(
           'wave_id', s3.wave_id, 'code', s3.wave_code, 'week_start', s3.week_start
         )
         FROM stages s3
         WHERE s3.stage = stages.stage
           AND s3.stage_status = 'pending'
           AND (
             s3.ord = 1  -- corte: no predecessor required
             OR EXISTS (
               SELECT 1
               FROM production_wave_stages prev_s
               WHERE prev_s.wave_id = s3.wave_id
                 AND stage_order(prev_s.stage) = s3.ord - 1
                 AND prev_s.status = 'completed'
             )
           )
         ORDER BY s3.week_start
         LIMIT 1) AS next_wave,
       (SELECT count(*)
         FROM stages s4
         WHERE s4.stage = stages.stage AND s4.stage_status = 'completed') AS completed_count
FROM stages
GROUP BY stage, ord
ORDER BY ord;

GRANT SELECT ON public.v_sector_board TO authenticated;


-- 4. Add UNIQUE constraint to production_wave_item_sources --------------------------------
-- Problem: ON CONFLICT DO NOTHING in auto_assign_sale_order_to_wave never triggers because
--          there is no UNIQUE constraint on (wave_item_id, sale_order_item_id).
--          Without it, re-running assignment creates duplicate source rows.

ALTER TABLE public.production_wave_item_sources
  ADD CONSTRAINT uq_wave_item_sources
  UNIQUE (wave_item_id, sale_order_item_id);
