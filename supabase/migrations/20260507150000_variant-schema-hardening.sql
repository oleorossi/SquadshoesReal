-- =============================================================================
-- Reference Material Variants — schema hardening
-- =============================================================================
--
-- Audit findings (Grupo 14 follow-up):
--   H1 — UNIQUE (reference_id, material_name) is exact-text. "Couro" vs
--        "couro " vs "COURO" all create independent rows, each with its own
--        SKU on the NF-e. Replace with a case-insensitive functional UNIQUE
--        index on lower(btrim(material_name)) and add a BEFORE trigger that
--        normalizes the material_name to btrim() before storage.
--   H2 — sale_order_items.material_variant_id ON DELETE SET NULL silently
--        drops fiscal SKU from active orders pending NF-e emission. Switch
--        to ON DELETE RESTRICT so admins must migrate/cancel affected
--        orders before deleting a variant.
--   H4 — reference_material_variants.upper_material_product_id has no
--        index → every DELETE of a `products` row scans the whole table.
--        Add a partial index.
--
-- Plus H7 (compute_wave_timeline) — Mesa lead-time CASE has no fallback,
-- so sheets where Mesa is in production_sectors but mesa_daily_capacity
-- is 0 silently get 0 days for Mesa. Add ELSE 1 default. Will be applied
-- in 20260507160000_compute-wave-timeline-mesa-fallback.sql so this file
-- stays focused on the variants table.
-- =============================================================================

-- ── H1: case-insensitive uniqueness for material_name ────────────────────────
-- 1. Drop the exact-text constraint
ALTER TABLE public.reference_material_variants
  DROP CONSTRAINT IF EXISTS reference_material_variants_reference_id_material_name_key;

-- 2. Add a normalization trigger (trim whitespace before insert/update).
CREATE OR REPLACE FUNCTION public.fn_normalize_material_variant_name()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.material_name IS NOT NULL THEN
    NEW.material_name := btrim(NEW.material_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_material_variant_name
  ON public.reference_material_variants;
CREATE TRIGGER trg_normalize_material_variant_name
  BEFORE INSERT OR UPDATE ON public.reference_material_variants
  FOR EACH ROW EXECUTE FUNCTION public.fn_normalize_material_variant_name();

-- 3. Backfill: collapse pre-existing duplicates by lowercasing & trimming.
-- For each (reference_id, lower(btrim(material_name))) group, keep the row
-- with the lowest display_order (or oldest created_at as tiebreaker) and
-- delete the rest. This requires manual review in production — wrap in a
-- DO block that warns instead of acting if duplicates exist.
DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT count(*) INTO v_dup_count
    FROM (
      SELECT reference_id, lower(btrim(material_name)) AS norm
      FROM public.reference_material_variants
      GROUP BY reference_id, lower(btrim(material_name))
      HAVING count(*) > 1
    ) t;

  IF v_dup_count > 0 THEN
    RAISE WARNING
      'reference_material_variants: % duplicate(s) detected by case-insensitive comparison. '
      'Resolve manually before applying the unique index — review which row should win '
      '(consider sale_order_items.material_variant_id references).',
      v_dup_count;
  END IF;
END;
$$;

-- 4. Apply the case-insensitive functional unique index.
-- This will fail if duplicates remain after the warning above.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ref_mat_variants_reference_lower_name
  ON public.reference_material_variants (reference_id, lower(btrim(material_name)));

-- ── H2: ON DELETE RESTRICT for sale_order_items.material_variant_id ──────────
-- Force admins to migrate/cancel affected orders before destroying a variant.
-- Replace the existing FK constraint.
ALTER TABLE public.sale_order_items
  DROP CONSTRAINT IF EXISTS sale_order_items_material_variant_id_fkey;

ALTER TABLE public.sale_order_items
  ADD CONSTRAINT sale_order_items_material_variant_id_fkey
    FOREIGN KEY (material_variant_id)
    REFERENCES public.reference_material_variants(id)
    ON DELETE RESTRICT;

-- ── H4: index for FK on upper_material_product_id ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ref_mat_variants_upper_material_product
  ON public.reference_material_variants(upper_material_product_id)
  WHERE upper_material_product_id IS NOT NULL;
