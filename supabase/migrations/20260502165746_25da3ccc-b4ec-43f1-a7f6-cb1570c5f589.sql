-- Migration: 20260507180000_tighten-ref-mat-variants-rls (Updated)
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
