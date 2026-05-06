-- Fix search_path for the specific function signature found
ALTER FUNCTION public.get_material_conversion_info(UUID) SET search_path = public;

-- Indices are already applied in previous step, so we are good.
