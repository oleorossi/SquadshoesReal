-- 20260506120000_sector-rename-wave-stages.sql
-- Update active order stages to match new names
UPDATE public.order_stages SET stage_name = 'Corte Palmilha' WHERE stage_name = 'Corte';
UPDATE public.order_stages SET stage_name = 'Corte Forração' WHERE stage_name = 'Forração';
UPDATE public.order_stages SET stage_name = 'Silk' WHERE stage_name = 'Silk/Alta Frequência';

-- 20260507120000_backfill-sole-grade-range-metadata.sql
-- Backfill missing metadata for sole components using the existing column
UPDATE public.products
SET is_standard_sole_item = true
WHERE category ILIKE '%solado%';
