-- =============================================================================
-- Reference Material Variants
-- =============================================================================
--
-- Allows the same technical sheet (reference) to be produced with different
-- upper (cabedal) materials. Each variant gets its own SKU and, optionally,
-- its own NCM and description for NF-e fiscal purposes.
--
-- Use case: "Sandália 101" can be made in Napa, Couro or Sintético.
-- The production process is identical, but each material is a different
-- SKU on the NF-e so SEFAZ can track the material origin.
--
-- Relationships:
--   reference_material_variants → technical_sheets (many-to-one)
--   reference_material_variants → products (optional, for stock consumption)
--   sale_order_items.material_variant_id → reference_material_variants
-- =============================================================================

CREATE TABLE public.reference_material_variants (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id              uuid        NOT NULL
                              REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  material_name             text        NOT NULL,  -- e.g. "Couro", "Napa Fosca"
  sku                       text,                  -- codigo_produto on NF-e
  barcode                   text,
  -- Fiscal overrides (NULL = inherit from technical_sheet)
  ncm                       text,
  description_override      text,                  -- replaces "{name} - {color}" on NF-e
  -- Optional: which material product to consume from stock for this variant
  -- When NULL the BOM resolves by upper_material name as usual
  upper_material_product_id uuid
                              REFERENCES public.products(id) ON DELETE SET NULL,
  -- Commercial
  unit_price_override       numeric,               -- NULL = use sale_order_item.unit_price
  active                    boolean     NOT NULL DEFAULT true,
  display_order             integer     NOT NULL DEFAULT 0,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),
  UNIQUE (reference_id, material_name)
);

-- Index for look-ups by reference
CREATE INDEX idx_ref_mat_variants_reference
  ON public.reference_material_variants(reference_id);

-- RLS: same policy as other reference tables
ALTER TABLE public.reference_material_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_rw_ref_mat_variants" ON public.reference_material_variants;
CREATE POLICY "authenticated_rw_ref_mat_variants"
  ON public.reference_material_variants
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── Add material_variant_id to sale_order_items ──────────────────────────────
ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS material_variant_id uuid
    REFERENCES public.reference_material_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_soi_material_variant
  ON public.sale_order_items(material_variant_id)
  WHERE material_variant_id IS NOT NULL;

-- ── Timestamps trigger (reuse same pattern as other tables) ──────────────────
DROP FUNCTION IF EXISTS public.fn_touch_ref_mat_variant() CASCADE;
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
