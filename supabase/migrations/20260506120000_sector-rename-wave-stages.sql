-- =============================================================================
-- SECTOR RENAME — Wave Stages & Planning Engine
-- =============================================================================
--
-- Restructures the production sector vocabulary from legacy names to the new
-- sequence used by the shop floor:
--
--   OLD (UI labels)          NEW (UI labels)
--   ─────────────────────    ────────────────────────────────────────────
--   Corte                 →  Corte Palmilha  (sewing_capacity_per_day)
--   Costura / Forração    →  Corte Forração  (cutting_capacity_per_day)
--   Mesa                  =  Mesa             (mesa_daily_capacity)
--   Silk / Serigrafia     →  Silk             (silk_capacity_per_day — added 20260505130000)
--   Colagem               →  Colagem          (gluing_capacity_per_day — added 20260505130000)
--   Montagem              =  Montagem         (assembly_capacity_per_day)
--   Solagem               →  Solagem          (soling_capacity_per_day — added 20260505130000)
--   Acabamento            =  Acabamento       (finishing_capacity_per_day)
--   (new)                 →  Expedição        (enum only, capacity = 0)
--
-- DB column names are UNCHANGED; only the UI display names change.
--
-- Changes in this migration:
--   1. Add new enum values to production_stage_enum
--   2. Replace stage_order() with new sector ordering (1-9)
--   3. Create sector_display_to_enum() helper function
--   4. Replace create_production_wave() to use production_sectors JSONB
--   5. Replace compute_wave_timeline() with expanded sector cascade + new return columns
--   6. Data migration: remap existing production_wave_stages rows to new enum values
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ADD NEW ENUM VALUES
-- ─────────────────────────────────────────────────────────────────────────────
-- Add values for the new sector names. Legacy values (corte, costura, palmilha,
-- mesa, solagem, montagem, acabamento) already exist; adding the missing ones.

ALTER TYPE public.production_stage_enum ADD VALUE IF NOT EXISTS 'corte_palmilha';
ALTER TYPE public.production_stage_enum ADD VALUE IF NOT EXISTS 'corte_forracao';
ALTER TYPE public.production_stage_enum ADD VALUE IF NOT EXISTS 'silk';
ALTER TYPE public.production_stage_enum ADD VALUE IF NOT EXISTS 'colagem';
ALTER TYPE public.production_stage_enum ADD VALUE IF NOT EXISTS 'expedicao';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REPLACE stage_order()
-- ─────────────────────────────────────────────────────────────────────────────
-- Maps each sector to its sequential execution order (1 = first, 9 = last).
-- Sectors with the same order number run in parallel.
-- Legacy values (corte, costura, palmilha) are preserved for backward
-- compatibility with existing production_wave_stages rows until they are
-- migrated in section 6 below.

DROP FUNCTION IF EXISTS public.stage_order(s production_stage_enum) CASCADE;
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    -- ── New canonical ordering ──
    WHEN 'corte_palmilha' THEN 1
    WHEN 'corte_forracao' THEN 2
    WHEN 'mesa'           THEN 3
    WHEN 'silk'           THEN 4
    WHEN 'colagem'        THEN 5
    WHEN 'montagem'       THEN 6
    WHEN 'solagem'        THEN 7
    WHEN 'acabamento'     THEN 8
    WHEN 'expedicao'      THEN 9
    -- ── Legacy backward-compat (old rows still in DB before data-migration) ──
    WHEN 'corte'          THEN 1   -- was Corte (= Corte Palmilha in new naming)
    WHEN 'palmilha'       THEN 1   -- was Palmilha (= Corte Palmilha)
    WHEN 'costura'        THEN 2   -- was Costura (= Corte Forração)
    -- ── Anything unrecognised → sort last ──
    ELSE 99
  END;
$$;

COMMENT ON FUNCTION public.stage_order(production_stage_enum) IS
  'Returns the sequential execution order for a production sector (1 = first). '
  'New canonical values: corte_palmilha(1) → corte_forracao(2) → mesa(3) → '
  'silk(4) → colagem(5) → montagem(6) → solagem(7) → acabamento(8) → expedicao(9). '
  'Legacy enum values (corte, palmilha, costura) map to their nearest equivalent '
  'for backward-compat until the data migration in section 6 promotes them.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CREATE sector_display_to_enum()
-- ─────────────────────────────────────────────────────────────────────────────
-- Converts the human-readable sector names stored in
-- technical_sheets.production_sectors (a JSONB text array) to the canonical
-- production_stage_enum values.
-- Case-insensitive, trims leading/trailing whitespace.
-- Returns NULL for unknown names so callers can filter them out safely.

DROP FUNCTION IF EXISTS public.sector_display_to_enum(p_name text) CASCADE;
CREATE OR REPLACE FUNCTION public.sector_display_to_enum(p_name text)
RETURNS production_stage_enum
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(trim(p_name))
    -- ── Canonical new names ──
    WHEN 'corte palmilha'  THEN 'corte_palmilha'::production_stage_enum
    WHEN 'corte forração'  THEN 'corte_forracao'::production_stage_enum
    WHEN 'corte forracao'  THEN 'corte_forracao'::production_stage_enum
    WHEN 'mesa'            THEN 'mesa'::production_stage_enum
    WHEN 'silk'            THEN 'silk'::production_stage_enum
    WHEN 'colagem'         THEN 'colagem'::production_stage_enum
    WHEN 'montagem'        THEN 'montagem'::production_stage_enum
    WHEN 'solagem'         THEN 'solagem'::production_stage_enum
    WHEN 'acabamento'      THEN 'acabamento'::production_stage_enum
    WHEN 'expedição'       THEN 'expedicao'::production_stage_enum
    WHEN 'expedicao'       THEN 'expedicao'::production_stage_enum
    -- ── Legacy / alternate names ──
    WHEN 'corte'           THEN 'corte_palmilha'::production_stage_enum
    WHEN 'costura'         THEN 'corte_forracao'::production_stage_enum
    WHEN 'palmilha'        THEN 'corte_palmilha'::production_stage_enum
    WHEN 'aviamento'       THEN 'mesa'::production_stage_enum
    WHEN 'forração'        THEN 'corte_forracao'::production_stage_enum
    WHEN 'forracao'        THEN 'corte_forracao'::production_stage_enum
    WHEN 'forro'           THEN 'corte_forracao'::production_stage_enum
    WHEN 'serigrafia'      THEN 'silk'::production_stage_enum
    WHEN 'silkscreen'      THEN 'silk'::production_stage_enum
    -- ── Unknown → NULL (callers should filter with IS NOT NULL) ──
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.sector_display_to_enum(text) TO authenticated;

COMMENT ON FUNCTION public.sector_display_to_enum(text) IS
  'Converts a human-readable sector display name (as stored in '
  'technical_sheets.production_sectors JSONB array) to its canonical '
  'production_stage_enum value. Case-insensitive. Returns NULL for unknown names.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REPLACE create_production_wave()
-- ─────────────────────────────────────────────────────────────────────────────
-- Instead of inserting a hardcoded list of stages, this version reads the
-- production_sectors JSONB array from each item's technical sheet to determine
-- which stages are actually needed for the wave.
--
-- For each sector that appears in production_sectors, the wave stage is created
-- with the correct capacity_per_day sourced from the appropriate column.
-- The wave_items / wave_item_sources loop and final UPDATE are unchanged.

DROP FUNCTION IF EXISTS public.create_production_wave(
  p_week_start date,
  p_sale_order_ids uuid[]
) CASCADE;
CREATE OR REPLACE FUNCTION public.create_production_wave(
  p_week_start date,
  p_sale_order_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave_id  uuid;
  v_code     text;
  v_week_end date;
  v_row      RECORD;
  v_item_id  uuid;
BEGIN
  -- Require authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  v_week_end := p_week_start + 6;
  v_code := 'W' || to_char(p_week_start, 'IYYY-IW');

  -- Insert (or touch) the wave header
  INSERT INTO production_waves(code, week_start, week_end, status, created_by)
  VALUES (v_code, p_week_start, v_week_end, 'draft', auth.uid())
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  -- ── Insert wave stages derived from technical_sheets.production_sectors ──
  --
  -- sectors_needed: distinct enum values collected from every item's sheet.
  --   Falls back to the canonical full list when production_sectors is NULL/empty.
  -- capacities: per-sector MAX capacity across all sheets in the batch.
  --   This lets the operator review/override later via the boost-capacity dialog.

  WITH sectors_needed AS (
    SELECT DISTINCT sector_display_to_enum(s.nm) AS stage
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      COALESCE(
        NULLIF(ts.production_sectors, 'null'::jsonb),
        '["Corte Palmilha","Corte Forração","Mesa","Silk","Colagem","Montagem","Solagem","Acabamento"]'::jsonb
      )
    ) AS s(nm)
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND sector_display_to_enum(s.nm) IS NOT NULL
  ),
  capacities(stage, cap) AS (
    -- Corte Palmilha → sewing_capacity_per_day (column repurposed from "Costura")
    SELECT 'corte_palmilha'::production_stage_enum,
           MAX(ts.sewing_capacity_per_day)
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)

    UNION ALL

    -- Corte Forração → cutting_capacity_per_day (column repurposed from "Corte")
    SELECT 'corte_forracao'::production_stage_enum,
           MAX(ts.cutting_capacity_per_day)
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)

    UNION ALL

    -- Mesa → mesa_daily_capacity
    SELECT 'mesa'::production_stage_enum,
           MAX(ts.mesa_daily_capacity)
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)

    UNION ALL

    -- Silk → silk_capacity_per_day
    SELECT 'silk'::production_stage_enum,
           MAX(ts.silk_capacity_per_day)
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)

    UNION ALL

    -- Colagem → gluing_capacity_per_day
    SELECT 'colagem'::production_stage_enum,
           MAX(ts.gluing_capacity_per_day)
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)

    UNION ALL

    -- Montagem → assembly_capacity_per_day
    SELECT 'montagem'::production_stage_enum,
           MAX(ts.assembly_capacity_per_day)
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)

    UNION ALL

    -- Solagem → soling_capacity_per_day
    SELECT 'solagem'::production_stage_enum,
           MAX(ts.soling_capacity_per_day)
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)

    UNION ALL

    -- Acabamento → finishing_capacity_per_day
    SELECT 'acabamento'::production_stage_enum,
           MAX(ts.finishing_capacity_per_day)
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)

    UNION ALL

    -- Expedição → no physical capacity column yet; always 0
    SELECT 'expedicao'::production_stage_enum, 0
  )
  INSERT INTO production_wave_stages(wave_id, stage, status, capacity_per_day)
  SELECT v_wave_id,
         sn.stage,
         'pending',
         COALESCE(c.cap, 0)
  FROM sectors_needed sn
  LEFT JOIN capacities c ON c.stage = sn.stage
  ON CONFLICT DO NOTHING;

  -- ── Wave items: consolidate sale order items into wave items ──
  FOR v_row IN
    SELECT
      soi.id                                                         AS source_item_id,
      so.id                                                          AS sale_order_id,
      so.client_id                                                   AS client_id,
      COALESCE(c.razao_social, so.id::text)                          AS store_name,
      soi.reference_id                                               AS reference_id,
      COALESCE(soi.color, '')                                        AS color,
      COALESCE(soi.quantity, 0)::numeric                             AS qty,
      COALESCE(soi.grade, '{}'::jsonb)                               AS grade,
      (SELECT sole_product_id
         FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
    WHERE so.id = ANY(p_sale_order_ids)
  LOOP
    INSERT INTO production_wave_items(
      wave_id, reference_id, sole_product_id, color, total_quantity, grade
    )
    VALUES (
      v_wave_id, v_row.reference_id, v_row.sole_id,
      v_row.color, v_row.qty, v_row.grade
    )
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET total_quantity =
      production_wave_items.total_quantity + EXCLUDED.total_quantity
    RETURNING id INTO v_item_id;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id,
      client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id,
      v_row.client_id, v_row.store_name, v_row.qty, v_row.grade
    );
  END LOOP;

  -- ── Final totals & status ──
  UPDATE production_waves w
  SET
    total_pairs = COALESCE(
      (SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id), 0),
    total_items = COALESCE(
      (SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id), 0),
    status = 'planning'
  WHERE w.id = v_wave_id;

  RETURN v_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_wave(date, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.create_production_wave(date, uuid[]) IS
  'Creates (or re-touches) a production wave for the given ISO week and sale order '
  'batch. Wave stages are derived dynamically from each item''s technical_sheets.'
  'production_sectors JSONB array, with capacity_per_day populated from the '
  'corresponding capacity column. Unknown sector names are silently skipped.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REPLACE compute_wave_timeline()
-- ─────────────────────────────────────────────────────────────────────────────
-- Extends the planning cascade from 4 sectors to 8 (+ Expedição as a sentinel).
-- New sectors (Silk, Colagem, Solagem) are included only when they appear in the
-- items' production_sectors list; lead time is 0 otherwise.
--
-- Cascade (backwards from delivery deadline):
--   deadline
--     - acabamento
--     - solagem
--     - montagem
--     - colagem
--     - silk
--     - mesa
--     - corte_forracao  (= costura_start_date for backward-compat naming)
--     - corte_palmilha  (= corte_start_date for backward-compat naming)
--     - buffer
--     - supplier
--
-- Capacity fallback per sector (most-specific → least-specific):
--   1. technical_sheets.<sector>_capacity_per_day  (capacity-driven: ceil(qty/cap))
--   2. legacy lead_time_*_dias field on technical_sheets
--   3. default_lead_times table (by shoe_category)
--   4. hard-coded constant (see per-sector defaults below)

-- Drop the old 7-column signature so PostgreSQL accepts the new 9-column one.
-- CREATE OR REPLACE refuses to change RETURNS TABLE composition. plpgsql
-- callers (update_wave_timeline, get_wave_material_needs) resolve callees at
-- runtime so they do NOT create hard catalog dependencies — DROP without
-- CASCADE is safe and avoids accidentally dropping unrelated objects.
DROP FUNCTION IF EXISTS public.compute_wave_timeline(uuid[]);

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline     date,
  -- Backward-compat column names kept so existing callers don't break:
  corte_start_date      date,   -- = Corte Palmilha start
  costura_start_date    date,   -- = Corte Forração start
  montagem_start_date   date,
  acabamento_start_date date,
  -- New columns for the additional sectors:
  silk_start_date       date,
  colagem_start_date    date,
  solagem_start_date    date,
  material_ready_date   date,
  purchase_deadline     date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  -- Lead time variables — one per sector
  v_lead_palmilha  int;   -- Corte Palmilha  (sewing_capacity_per_day)
  v_lead_forracao  int;   -- Corte Forração  (cutting_capacity_per_day)
  v_lead_mesa      int;   -- Mesa            (mesa_daily_capacity)
  v_lead_silk      int;   -- Silk            (silk_capacity_per_day)
  v_lead_colagem   int;   -- Colagem         (gluing_capacity_per_day)
  v_lead_montagem  int;   -- Montagem        (assembly_capacity_per_day)
  v_lead_solagem   int;   -- Solagem         (soling_capacity_per_day)
  v_lead_acab      int;   -- Acabamento      (finishing_capacity_per_day)
  v_lead_buffer    int;   -- Buffer material
  v_lead_supplier  int;   -- Supplier replenishment lead time
  v_deadline       date;
BEGIN
  -- ── Earliest delivery deadline across the batch ──
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  -- ── Per-sector lead times: capacity-driven with multi-level fallback ──
  -- Uses MAX across the batch (worst-case determines the wave schedule).
  -- For each sector, also checks whether the sector actually appears in any
  -- item's production_sectors; if not, the lead time contributes 0 days.
  SELECT
    -- Corte Palmilha: sewing_capacity_per_day; fallback lead_time_costura_dias; default 1
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'corte_palmilha'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                          dlt.sewing_capacity_per_day, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                            dlt.sewing_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_costura_dias, 0),
                          dlt.lead_time_costura_dias,
                          (SELECT sc.costura_dias FROM shoe_category_lead_times sc
                           WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                          1)
          END
        ELSE 0
      END
    ), 1),

    -- Corte Forração: cutting_capacity_per_day; fallback lead_time_corte_dias; default 2
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'corte_forracao'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                          dlt.cutting_capacity_per_day, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                            dlt.cutting_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_corte_dias, 0),
                          dlt.lead_time_corte_dias,
                          (SELECT sc.corte_dias FROM shoe_category_lead_times sc
                           WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                          2)
          END
        ELSE 0
      END
    ), 0),

    -- Mesa: mesa_daily_capacity; no legacy field. When the sector is present
    -- in production_sectors but mesa_daily_capacity is 0/null, fall back to
    -- 1 day so Mesa actually contributes to the cascade — matches the
    -- behaviour of Silk/Colagem/Solagem below. Without this fallback Mesa
    -- silently disappears from the schedule for any sheet that hasn't yet
    -- configured its capacity column.
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'mesa'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.mesa_daily_capacity, 0), 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   ts.mesa_daily_capacity::numeric)::int)
            ELSE 1
          END
        ELSE 0
      END
    ), 0),

    -- Silk: silk_capacity_per_day; no legacy field; default 1 when sector present
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'silk'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.silk_capacity_per_day, 0), 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   ts.silk_capacity_per_day::numeric)::int)
            ELSE 1
          END
        ELSE 0
      END
    ), 0),

    -- Colagem: gluing_capacity_per_day; no legacy field; default 1 when sector present
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'colagem'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day, 0), 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   ts.gluing_capacity_per_day::numeric)::int)
            ELSE 1
          END
        ELSE 0
      END
    ), 0),

    -- Montagem: assembly_capacity_per_day; fallback lead_time_montagem_dias; default 2
    COALESCE(MAX(
      CASE
        WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                      dlt.assembly_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                        dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias, 0),
                      dlt.lead_time_montagem_dias,
                      (SELECT sc.montagem_dias FROM shoe_category_lead_times sc
                       WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                      2)
      END
    ), 2),

    -- Solagem: soling_capacity_per_day; no legacy field; default 1
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'solagem'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.soling_capacity_per_day, 0), 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   ts.soling_capacity_per_day::numeric)::int)
            ELSE 1
          END
        ELSE 0
      END
    ), 0),

    -- Acabamento: finishing_capacity_per_day; fallback lead_time_acabamento_dias; default 1
    COALESCE(MAX(
      CASE
        WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                      dlt.finishing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                        dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0),
                      dlt.lead_time_acabamento_dias,
                      (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc
                       WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                      1)
      END
    ), 1),

    -- Buffer material (unchanged)
    COALESCE(MAX(COALESCE(
      NULLIF(ts.lead_time_buffer_material_dias, 0),
      dlt.lead_time_buffer_material_dias,
      (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc
       WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
      2
    )), 2)

  INTO
    v_lead_palmilha, v_lead_forracao, v_lead_mesa,
    v_lead_silk, v_lead_colagem,
    v_lead_montagem, v_lead_solagem, v_lead_acab,
    v_lead_buffer

  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- ── Supplier lead time: conditional on stock shortfall ──
  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 7) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id,
             SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  -- ── Cascade: work backwards from delivery deadline ──
  --
  --   deadline
  --     └─ acabamento_start_date         = deadline - acab
  --     └─ solagem_start_date            = deadline - acab - solagem
  --     └─ montagem_start_date           = deadline - acab - solagem - montagem
  --     └─ colagem_start_date            = deadline - acab - solagem - montagem - colagem
  --     └─ silk_start_date               = ... - silk
  --     └─ mesa runs in parallel (not on critical path for corte_forracao)
  --     └─ costura_start_date (forracao) = ... - forracao
  --     └─ corte_start_date  (palmilha)  = ... - palmilha
  --     └─ material_ready_date           = corte_start - buffer
  --     └─ purchase_deadline             = material_ready - supplier

  RETURN QUERY SELECT
    v_deadline                                             AS earliest_deadline,

    -- corte_start_date = Corte Palmilha start (bottom of cascade)
    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao + v_lead_palmilha)
    )::date                                                AS corte_start_date,

    -- costura_start_date = Corte Forração start (one step above Corte Palmilha)
    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao)
    )::date                                                AS costura_start_date,

    -- montagem_start_date
    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem)
    )::date                                                AS montagem_start_date,

    -- acabamento_start_date
    add_business_days(
      v_deadline,
      -v_lead_acab
    )::date                                                AS acabamento_start_date,

    -- silk_start_date (new)
    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk)
    )::date                                                AS silk_start_date,

    -- colagem_start_date (new)
    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem)
    )::date                                                AS colagem_start_date,

    -- solagem_start_date (new)
    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem)
    )::date                                                AS solagem_start_date,

    -- material_ready_date = Corte Palmilha start minus buffer
    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao
        + v_lead_palmilha + v_lead_buffer)
    )::date                                                AS material_ready_date,

    -- purchase_deadline = material_ready minus supplier replenishment
    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao
        + v_lead_palmilha + v_lead_buffer + v_lead_supplier)
    )::date                                                AS purchase_deadline;
END;
$$;

COMMENT ON FUNCTION public.compute_wave_timeline(uuid[]) IS
  'Calculates the production schedule for a wave from a batch of sale order IDs. '
  'Returns start dates for each sector in the new 8-sector cascade: '
  'corte_palmilha → corte_forracao → [mesa parallel] → silk → colagem → '
  'montagem → solagem → acabamento. '
  'Lead times are capacity-driven (ceil(qty/cap)) with fallback to fixed '
  'lead_time_*_dias fields and hard-coded constants. '
  'Sectors absent from production_sectors contribute 0 days. '
  'Adds three new output columns: silk_start_date, colagem_start_date, '
  'solagem_start_date. Existing columns (corte_start_date, costura_start_date, '
  'montagem_start_date, acabamento_start_date) retain their names for '
  'backward-compat; corte_start_date now maps to Corte Palmilha and '
  'costura_start_date maps to Corte Forração.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. DATA MIGRATION — remap existing production_wave_stages rows
-- ─────────────────────────────────────────────────────────────────────────────
-- Promotes legacy enum values in live rows to their canonical new equivalents.
-- The old enum values (palmilha, corte, costura) still exist in the type
-- definition (they cannot be removed from a PostgreSQL enum) but no active
-- rows should reference them after this block runs.
--
-- NOTE: production_wave_stages has UNIQUE(wave_id, stage). If a wave already
-- has BOTH the old AND new value (e.g. both 'corte' and 'corte_palmilha'),
-- the UPDATE will violate the unique constraint. Such duplicates are handled by
-- deleting the old row only when the new one already exists.

DO $$
BEGIN
  -- palmilha → corte_palmilha
  -- Delete old row first when the new canonical row already exists to avoid UNIQUE conflict.
  DELETE FROM production_wave_stages old
  WHERE old.stage = 'palmilha'
    AND EXISTS (
      SELECT 1 FROM production_wave_stages new
      WHERE new.wave_id = old.wave_id AND new.stage = 'corte_palmilha'
    );
  UPDATE production_wave_stages SET stage = 'corte_palmilha' WHERE stage = 'palmilha';

  -- corte → corte_palmilha
  DELETE FROM production_wave_stages old
  WHERE old.stage = 'corte'
    AND EXISTS (
      SELECT 1 FROM production_wave_stages new
      WHERE new.wave_id = old.wave_id AND new.stage = 'corte_palmilha'
    );
  UPDATE production_wave_stages SET stage = 'corte_palmilha' WHERE stage = 'corte';

  -- costura → corte_forracao
  DELETE FROM production_wave_stages old
  WHERE old.stage = 'costura'
    AND EXISTS (
      SELECT 1 FROM production_wave_stages new
      WHERE new.wave_id = old.wave_id AND new.stage = 'corte_forracao'
    );
  UPDATE production_wave_stages SET stage = 'corte_forracao' WHERE stage = 'costura';
END;
$$;
