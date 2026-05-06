-- Sector restructuring: new capacity columns for restructured production sectors.
--
-- The production sector list is updated to the correct manufacturing sequence:
--   Corte Palmilha → Corte Forração → Mesa → Silk → Colagem → Montagem → Solagem → Acabamento
--
-- Column mapping (old → new conceptual label, column name unchanged):
--   cutting_capacity_per_day  → "Corte Forração"  (cabedal/lining cutting)
--   sewing_capacity_per_day   → "Corte Palmilha"  (insole cutting, repurposed since Costura removed)
--   assembly_capacity_per_day → "Montagem"         (unchanged)
--   finishing_capacity_per_day→ "Acabamento"        (unchanged)
--   mesa_daily_capacity       → "Mesa"              (already exists, managed separately)
--
-- New columns added in this migration:
--   silk_capacity_per_day     → "Silk"
--   gluing_capacity_per_day   → "Colagem"
--   soling_capacity_per_day   → "Solagem"

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS silk_capacity_per_day    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gluing_capacity_per_day  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soling_capacity_per_day  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.technical_sheets.silk_capacity_per_day   IS 'Pares/dia no setor Silk (serigrafia). 0 = não configurado.';
COMMENT ON COLUMN public.technical_sheets.gluing_capacity_per_day IS 'Pares/dia no setor Colagem. 0 = não configurado.';
COMMENT ON COLUMN public.technical_sheets.soling_capacity_per_day IS 'Pares/dia no setor Solagem. 0 = não configurado.';
