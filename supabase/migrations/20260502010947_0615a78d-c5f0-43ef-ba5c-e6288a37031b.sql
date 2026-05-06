
DROP FUNCTION IF EXISTS public.fn_enqueue_resync_for_sole_conjugation() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_enqueue_resync_for_sole_conjugation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sole_group_id uuid;
BEGIN
  v_sole_group_id := COALESCE(NEW.sole_group_id, OLD.sole_group_id);

  INSERT INTO public.resync_queue (order_id, reason, triggered_by)
  SELECT DISTINCT o.id,
         'Conjugação de solado alterada',
         TG_TABLE_NAME || '.' || TG_OP
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    JOIN public.products sole_p ON sole_p.id = ts.primary_sole_id
   WHERE sole_p.group_id = v_sole_group_id
     AND LOWER(COALESCE(o.status, '')) IN ('reservado', 'em produção');
  RETURN COALESCE(NEW, OLD);
END;
$$;
