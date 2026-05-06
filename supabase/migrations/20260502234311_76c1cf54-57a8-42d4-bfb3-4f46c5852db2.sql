-- 20260508120000_kanban-wave-mapping-after-sector-rename.sql
-- Update production wave stages following the canonical sector rename
UPDATE public.production_waves
SET current_stage = 'montagem'
WHERE current_stage::text IN ('Mesa de Montagem', 'Montagem');

UPDATE public.production_waves
SET current_stage = 'costura'
WHERE current_stage::text IN ('Bancada de Costura', 'Costura');

-- 20260508130000_idempotent-restore-product-stocks.sql
-- Idempotently initialize product current_stock for items with NULL values
UPDATE public.products
SET current_stock = 0
WHERE current_stock IS NULL;

-- 20260508140000_fix-quantity-processed-on-stage-complete.sql
-- Ensure produced quantity correctly reflects completion in production wave stages
-- We use total_items from production_waves as the target for completion
CREATE OR REPLACE FUNCTION public.fn_update_produced_quantity_on_complete()
RETURNS TRIGGER AS $$
DECLARE
    v_total_items INTEGER;
BEGIN
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        SELECT total_items INTO v_total_items FROM public.production_waves WHERE id = NEW.wave_id;
        NEW.produced_quantity = COALESCE(v_total_items, 0);
        NEW.progress_pct = 100;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_update_produced_quantity_on_complete ON public.production_wave_stages;
CREATE TRIGGER tr_update_produced_quantity_on_complete
BEFORE UPDATE ON public.production_wave_stages
FOR EACH ROW
EXECUTE FUNCTION public.fn_update_produced_quantity_on_complete();
