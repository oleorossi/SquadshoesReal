-- Add min_stock_grade jsonb column to products for per-size min stock (solado)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS min_stock_grade jsonb DEFAULT '{}'::jsonb;

-- Add sizes text column to reference_materials to track which sizes use this material
ALTER TABLE public.reference_materials ADD COLUMN IF NOT EXISTS sizes text DEFAULT '';