
-- Add enhanced packaging specification columns to packaging_configs
ALTER TABLE public.packaging_configs
  ADD COLUMN IF NOT EXISTS material text NOT NULL DEFAULT 'cardboard',
  ADD COLUMN IF NOT EXISTS protection_level text NOT NULL DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS stackable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_stack_height integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_weight_kg numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ext_comprimento_cm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ext_largura_cm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ext_altura_cm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_unit numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minimum_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS padding_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS padding_material text DEFAULT 'paper',
  ADD COLUMN IF NOT EXISTS padding_thickness_mm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_be_inverted boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_be_rotated boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fragile_sides jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS label_config jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;
