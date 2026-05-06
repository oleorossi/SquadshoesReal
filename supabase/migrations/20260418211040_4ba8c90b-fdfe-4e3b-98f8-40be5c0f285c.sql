-- Auto-finalize sale orders when all OPs finish Acabamento.
-- Also when sale_order is set to Faturado, mark child OPs as Finalizado.

DROP FUNCTION IF EXISTS public.auto_bill_sale_order_on_finishing() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_bill_sale_order_on_finishing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sale_order_id UUID;
  v_current_status TEXT;
  v_pending_count INT;
BEGIN
  -- React only when an Acabamento stage transitions to "concluido"
  IF NEW.stage_name <> 'Acabamento' THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'concluido' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Find parent sale_order through the OP
  SELECT o.sale_order_id INTO v_sale_order_id
  FROM public.orders o
  WHERE o.id = NEW.order_id;

  IF v_sale_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_current_status
  FROM public.sale_orders
  WHERE id = v_sale_order_id;

  -- Skip if already faturado/cancelado/rascunho
  IF v_current_status IN ('Faturado', 'Cancelado', 'Rascunho') THEN
    RETURN NEW;
  END IF;

  -- Count OPs from this sale_order that have NOT finished Acabamento
  -- An OP is considered acabamento-finalizado when it has a stage_name='Acabamento'
  -- with status='concluido'. OPs that are themselves cancelled don't block.
  SELECT COUNT(*) INTO v_pending_count
  FROM public.orders o
  WHERE o.sale_order_id = v_sale_order_id
    AND COALESCE(o.status, '') NOT IN ('cancelada', 'Cancelada', 'cancelled')
    AND NOT EXISTS (
      SELECT 1 FROM public.order_stages s
      WHERE s.order_id = o.id
        AND s.stage_name = 'Acabamento'
        AND s.status = 'concluido'
    );

  IF v_pending_count = 0 THEN
    UPDATE public.sale_orders
    SET status = 'Faturado', updated_at = NOW()
    WHERE id = v_sale_order_id
      AND status NOT IN ('Faturado', 'Cancelado');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_bill_sale_order_on_finishing ON public.order_stages;
CREATE TRIGGER trg_auto_bill_sale_order_on_finishing
AFTER INSERT OR UPDATE ON public.order_stages
FOR EACH ROW
EXECUTE FUNCTION public.auto_bill_sale_order_on_finishing();


-- When a sale_order is manually flipped to Faturado, finalize all its child OPs
DROP FUNCTION IF EXISTS public.finalize_orders_on_sale_order_billed() CASCADE;
CREATE OR REPLACE FUNCTION public.finalize_orders_on_sale_order_billed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'Faturado' AND (OLD.status IS DISTINCT FROM 'Faturado') THEN
    UPDATE public.orders
    SET status = 'Finalizado', updated_at = NOW()
    WHERE sale_order_id = NEW.id
      AND COALESCE(status, '') NOT IN ('Finalizado', 'cancelada', 'Cancelada', 'cancelled');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finalize_orders_on_sale_order_billed ON public.sale_orders;
CREATE TRIGGER trg_finalize_orders_on_sale_order_billed
AFTER UPDATE OF status ON public.sale_orders
FOR EACH ROW
EXECUTE FUNCTION public.finalize_orders_on_sale_order_billed();