-- Migration: 20260502100000_fix-rls-missing-policies
-- Description: RLS hardening for reference_materials and reference_color_variants

-- Secure Reference Color Variants
ALTER TABLE public.reference_color_variants ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reference_color_variants' AND policyname = 'Users can view color variants') THEN
        CREATE POLICY "Users can view color variants" ON public.reference_color_variants
            FOR SELECT USING (auth.role() = 'authenticated');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reference_color_variants' AND policyname = 'Users can manage color variants') THEN
        CREATE POLICY "Users can manage color variants" ON public.reference_color_variants
            FOR ALL USING (auth.role() = 'authenticated');
    END IF;
END $$;

-- Secure Reference Materials
ALTER TABLE public.reference_materials ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reference_materials' AND policyname = 'Users can view reference materials') THEN
        CREATE POLICY "Users can view reference materials" ON public.reference_materials
            FOR SELECT USING (auth.role() = 'authenticated');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reference_materials' AND policyname = 'Users can manage reference materials') THEN
        CREATE POLICY "Users can manage reference materials" ON public.reference_materials
            FOR ALL USING (auth.role() = 'authenticated');
    END IF;
END $$;

-- Ensure consistency between reference materials and color variants
CREATE OR REPLACE FUNCTION public.check_reference_color_variant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.reference_materials WHERE id = NEW.reference_material_id) THEN
        RAISE EXCEPTION 'Reference Material ID % does not exist', NEW.reference_material_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trig_check_ref_color_variant_consistency') THEN
        CREATE TRIGGER trig_check_ref_color_variant_consistency
        BEFORE INSERT OR UPDATE ON public.reference_color_variants
        FOR EACH ROW EXECUTE FUNCTION public.check_reference_color_variant_consistency();
    END IF;
END $$;

-- Migration: 20260502130000_construction-model-restructure

DROP TRIGGER IF EXISTS trg_sync_construction_routing ON public.technical_sheets;
DROP FUNCTION IF EXISTS public.sync_construction_routing();

ALTER TABLE public.technical_sheets 
DROP COLUMN IF EXISTS construction_type,
DROP COLUMN IF EXISTS has_colored_lining,
DROP COLUMN IF EXISTS colored_lining_mode,
DROP COLUMN IF EXISTS insole_color_mode,
DROP COLUMN IF EXISTS max_insole_colors,
DROP COLUMN IF EXISTS requires_cutting,
DROP COLUMN IF EXISTS requires_cutting_cabedal,
DROP COLUMN IF EXISTS requires_sewing,
DROP COLUMN IF EXISTS corte_a_faca,
DROP COLUMN IF EXISTS overlock_required,
DROP COLUMN IF EXISTS tira_chata_required,
DROP COLUMN IF EXISTS insole_has_lining;

-- Reference Material Variants Table
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