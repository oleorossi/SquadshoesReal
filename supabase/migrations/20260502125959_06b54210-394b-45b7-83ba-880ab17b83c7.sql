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