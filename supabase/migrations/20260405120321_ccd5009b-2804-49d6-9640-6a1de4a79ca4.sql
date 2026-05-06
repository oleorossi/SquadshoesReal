-- Add per-size consumption column to sheet_materials for granular BOM tracking
ALTER TABLE public.sheet_materials
  ADD COLUMN IF NOT EXISTS consumption_per_size jsonb DEFAULT '{}'::jsonb;