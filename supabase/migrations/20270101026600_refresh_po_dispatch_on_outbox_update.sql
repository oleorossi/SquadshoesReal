-- Após UPDATE do outbox (commercial_revision++), recalcular purchase_by_date
-- com setup + source_pv_labels mesmo quando source_pv_ids não muda.
-- Fecha o gap apontado na auditoria do writer (só o INSERT trigger cobria datas).

CREATE OR REPLACE FUNCTION public.tg_refresh_po_dispatch_on_commercial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.auto_generated
     AND NEW.source_type = 'per_pv'
     AND NEW.status IN ('suggested', 'draft', 'pending')
     AND NEW.exported_at IS NULL THEN
    PERFORM public.refresh_purchase_order_dispatch_fields(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_po_dispatch_on_commercial ON public.purchase_orders;
CREATE TRIGGER trg_refresh_po_dispatch_on_commercial
  AFTER UPDATE OF commercial_revision
  ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_refresh_po_dispatch_on_commercial();

COMMENT ON FUNCTION public.tg_refresh_po_dispatch_on_commercial() IS
  'Outbox shortages bumpa commercial_revision a cada reaplicação; daí refresca datas/setup/labels.';
