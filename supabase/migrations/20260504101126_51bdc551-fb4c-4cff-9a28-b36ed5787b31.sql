-- Add material columns to sole_structures to allow selecting specific items instead of just groups
ALTER TABLE public.sole_structures 
ADD COLUMN IF NOT EXISTS lining_material_id UUID REFERENCES public.products(id),
ADD COLUMN IF NOT EXISTS insole_material_id UUID REFERENCES public.products(id);

-- Update comment for clarity
COMMENT ON COLUMN public.sole_structures.default_group_id IS 'Grupo de material padrão (legado/fallback)';
COMMENT ON COLUMN public.sole_structures.lining_material_id IS 'Material específico de forração';
COMMENT ON COLUMN public.sole_structures.insole_material_id IS 'Material específico de palmilha';