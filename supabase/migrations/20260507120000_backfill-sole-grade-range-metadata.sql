-- =============================================================================
-- Backfill _size_from / _size_to in sole stock_grade
-- =============================================================================
--
-- Problem: SoladoGradeDialog previously did NOT persist _size_from/_size_to
-- metadata when conjugations were active. Soles like "238" (only 33/34 and
-- 39/40 conjugated) ended up with stock_grade = {"33/24": X, "39/40": Y}
-- and no range metadata. Without the range, the dialog and SaleOrderItemForm
-- could not show the individual sizes (35, 36, 37, 38) in between.
--
-- Fix: for every active sole product that
--   a) belongs to a group with sole_size_conjugations, AND
--   b) is missing _size_from or _size_to in its stock_grade
-- → derive the range from the min/max of the conjugation sizes and write it
--   into stock_grade as metadata.
--
-- This is a non-destructive update: only the metadata keys are added/updated,
-- existing quantity keys are untouched.
-- =============================================================================

DO $$
DECLARE
  v_rec        RECORD;
  v_min_size   integer;
  v_max_size   integer;
  v_grade      jsonb;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT p.id, p.group_id, p.stock_grade
    FROM products p
    WHERE p.active = true
      AND p.group_id IS NOT NULL
      AND p.stock_grade IS NOT NULL
      AND jsonb_typeof(p.stock_grade) = 'object'
      -- missing at least one of the range metadata keys
      AND (
        p.stock_grade->>'_size_from' IS NULL
        OR p.stock_grade->>'_size_to'   IS NULL
      )
      -- the group has conjugation rules
      AND EXISTS (
        SELECT 1 FROM sole_size_conjugations ssc
        WHERE ssc.sole_group_id = p.group_id
      )
  LOOP
    -- Derive range from conjugation sizes for this group
    SELECT MIN(sz), MAX(sz)
    INTO v_min_size, v_max_size
    FROM (
      SELECT unnest(sizes) AS sz
      FROM sole_size_conjugations
      WHERE sole_group_id = v_rec.group_id
    ) sub;

    CONTINUE WHEN v_min_size IS NULL OR v_max_size IS NULL;

    -- If the product already has numeric keys that extend beyond the conjugation
    -- range, respect them (prefer the wider range).
    SELECT
      LEAST(v_min_size,  COALESCE(MIN(k::integer), v_min_size)),
      GREATEST(v_max_size, COALESCE(MAX(k::integer), v_max_size))
    INTO v_min_size, v_max_size
    FROM jsonb_object_keys(v_rec.stock_grade) AS k
    WHERE k ~ '^[0-9]+$';

    v_grade := COALESCE(v_rec.stock_grade, '{}'::jsonb);
    v_grade := jsonb_set(v_grade, '{_size_from}', to_jsonb(v_min_size));
    v_grade := jsonb_set(v_grade, '{_size_to}',   to_jsonb(v_max_size));

    UPDATE products
    SET stock_grade = v_grade
    WHERE id = v_rec.id;
  END LOOP;
END;
$$;
