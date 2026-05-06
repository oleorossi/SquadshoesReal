-- =============================================================================
-- Reference Material Variants
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.reference_material_variants (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id              uuid        NOT NULL
                              REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  material_name             text        NOT NULL,
  sku                       text,
  barcode                   text,
  ncm                       text,
  description_override      text,
  upper_material_product_id uuid
                              REFERENCES public.products(id) ON DELETE SET NULL,
  unit_price_override       numeric,
  active                    boolean     NOT NULL DEFAULT true,
  display_order             integer     NOT NULL DEFAULT 0,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),
  UNIQUE (reference_id, material_name)
);

CREATE INDEX IF NOT EXISTS idx_ref_mat_variants_reference
  ON public.reference_material_variants(reference_id);

ALTER TABLE public.reference_material_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_rw_ref_mat_variants" ON public.reference_material_variants;
CREATE POLICY "authenticated_rw_ref_mat_variants"
  ON public.reference_material_variants
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS material_variant_id uuid
    REFERENCES public.reference_material_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_soi_material_variant
  ON public.sale_order_items(material_variant_id)
  WHERE material_variant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_touch_ref_mat_variant()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_ref_mat_variant
  ON public.reference_material_variants;
CREATE TRIGGER trg_touch_ref_mat_variant
  BEFORE UPDATE ON public.reference_material_variants
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_ref_mat_variant();

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