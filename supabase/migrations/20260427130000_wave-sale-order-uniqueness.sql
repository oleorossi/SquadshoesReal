-- Prevent the same sale_order from being assigned to more than one active
-- production wave simultaneously (guards against the race condition in
-- listPendingSaleOrdersForWeek + createWave).
--
-- A sale_order CAN appear in multiple FINISHED/CANCELLED waves (historical),
-- but only once in a wave whose status is draft / planning / running.

-- Helper function used by the constraint
CREATE OR REPLACE FUNCTION public.wave_is_active(wave_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.production_waves
    WHERE id = wave_id
      AND status NOT IN ('finished', 'cancelled')
  );
$$;

-- Unique partial index: (sale_order_id) where the linked wave is active.
-- Cannot use a direct partial index on a FK-resolved value, so we use an
-- EXCLUDE constraint via a trigger instead.

CREATE OR REPLACE FUNCTION public.check_sale_order_single_active_wave()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sale_order_id IS NOT NULL AND public.wave_is_active(
    (SELECT wave_id FROM public.production_wave_items WHERE id = NEW.wave_item_id)
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM public.production_wave_item_sources s
      JOIN public.production_wave_items wi ON wi.id = s.wave_item_id
      JOIN public.production_waves pw ON pw.id = wi.wave_id
      WHERE s.sale_order_id = NEW.sale_order_id
        AND s.id IS DISTINCT FROM NEW.id
        AND pw.status NOT IN ('finished', 'cancelled')
    ) THEN
      RAISE EXCEPTION
        'sale_order % is already assigned to an active production wave',
        NEW.sale_order_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_sale_order_single_active_wave
  ON public.production_wave_item_sources;

CREATE TRIGGER trg_check_sale_order_single_active_wave
  BEFORE INSERT OR UPDATE ON public.production_wave_item_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.check_sale_order_single_active_wave();

COMMENT ON TRIGGER trg_check_sale_order_single_active_wave
  ON public.production_wave_item_sources IS
  'Blocks a sale_order from being assigned to more than one active (non-finished, non-cancelled) production wave at a time.';
