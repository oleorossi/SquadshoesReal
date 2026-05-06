-- =============================================================================
-- Reference Material Variants — schema hardening
-- =============================================================================

ALTER TABLE public.reference_material_variants
  DROP CONSTRAINT IF EXISTS reference_material_variants_reference_id_material_name_key;

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_ref_mat_variants_reference_lower_name
  ON public.reference_material_variants (reference_id, lower(btrim(material_name)));

ALTER TABLE public.sale_order_items
  DROP CONSTRAINT IF EXISTS sale_order_items_material_variant_id_fkey;

ALTER TABLE public.sale_order_items
  ADD CONSTRAINT sale_order_items_material_variant_id_fkey
    FOREIGN KEY (material_variant_id)
    REFERENCES public.reference_material_variants(id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_ref_mat_variants_upper_material_product
  ON public.reference_material_variants(upper_material_product_id)
  WHERE upper_material_product_id IS NOT NULL;