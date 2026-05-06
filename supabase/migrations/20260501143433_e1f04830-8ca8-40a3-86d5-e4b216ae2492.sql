
-- Trigger: recalcula purchase_orders.total_value automaticamente
-- sempre que um item é inserido, atualizado ou excluído.

CREATE OR REPLACE FUNCTION public.sync_purchase_order_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po_id uuid;
  v_total numeric;
BEGIN
  -- Determina qual PO foi afetada
  IF TG_OP = 'DELETE' THEN
    v_po_id := OLD.purchase_order_id;
  ELSE
    v_po_id := NEW.purchase_order_id;
  END IF;

  SELECT COALESCE(SUM(quantity * unit_price), 0)
    INTO v_total
    FROM public.purchase_order_items
   WHERE purchase_order_id = v_po_id;

  UPDATE public.purchase_orders
     SET total_value = v_total,
         updated_at  = now()
   WHERE id = v_po_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_po_total ON public.purchase_order_items;

CREATE TRIGGER trg_sync_po_total
  AFTER INSERT OR UPDATE OF quantity, unit_price OR DELETE
  ON public.purchase_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_purchase_order_total();

-- Se o item muda de PO (raro, mas seguro), atualiza a PO antiga também
CREATE OR REPLACE FUNCTION public.sync_purchase_order_total_on_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF OLD.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id THEN
    SELECT COALESCE(SUM(quantity * unit_price), 0)
      INTO v_total
      FROM public.purchase_order_items
     WHERE purchase_order_id = OLD.purchase_order_id;

    UPDATE public.purchase_orders
       SET total_value = v_total,
           updated_at  = now()
     WHERE id = OLD.purchase_order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_po_total_on_move ON public.purchase_order_items;

CREATE TRIGGER trg_sync_po_total_on_move
  AFTER UPDATE OF purchase_order_id
  ON public.purchase_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_purchase_order_total_on_move();
