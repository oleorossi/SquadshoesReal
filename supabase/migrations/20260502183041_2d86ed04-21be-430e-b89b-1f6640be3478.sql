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

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'reference_material_variants' 
    AND policyname = 'authenticated_rw_ref_mat_variants'
  ) THEN
    CREATE POLICY "authenticated_rw_ref_mat_variants"
      ON public.reference_material_variants
      FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

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