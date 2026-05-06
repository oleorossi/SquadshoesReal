-- =============================================================================
-- Audit-2 Batch D2: remove duplicate 'em produção' literal in resync trigger
-- =============================================================================
--
-- Audit-2 SQL #9: in 20260504180000_atomic-resync-ops-and-trigger-coverage.sql
-- the IN clause of fn_enqueue_resync_for_sole_conjugation listed
-- 'em produção' twice:
--
--   AND LOWER(COALESCE(o.status, '')) IN ('reservado', 'em produção', 'em produção');
--
-- The duplicate is harmless but it is a clear sign of a typo (one of the two
-- entries was meant to be a different status, or the duplicate was copy-pasted
-- by mistake). Recreate the function with the de-duplicated list aligned to the
-- sibling triggers (fn_enqueue_resync_for_palmilha_colors).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_enqueue_resync_for_sole_conjugation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sole_group_id uuid;
BEGIN
  v_sole_group_id := COALESCE(NEW.sole_group_id, OLD.sole_group_id);

  -- Find OPs whose sole product belongs to this group AND are still active.
  INSERT INTO public.resync_queue (order_id, reason, triggered_by)
  SELECT DISTINCT o.id,
         'Conjugação de solado alterada',
         TG_TABLE_NAME || '.' || TG_OP
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    JOIN public.products sole_p ON sole_p.id = ts.sole_id
   WHERE sole_p.group_id = v_sole_group_id
     AND LOWER(COALESCE(o.status, '')) IN ('reservado', 'em produção');
  RETURN COALESCE(NEW, OLD);
END;
$$;
