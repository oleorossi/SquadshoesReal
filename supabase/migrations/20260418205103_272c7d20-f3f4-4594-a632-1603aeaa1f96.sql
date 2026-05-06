
-- 1. Migrate existing sale_order statuses to the new simplified set
UPDATE public.sale_orders SET status = 'Rascunho' WHERE status IN ('Pendente', 'pendente');
UPDATE public.sale_orders SET status = 'Em Produção' WHERE status IN ('Faturado', 'faturado', 'Pronto', 'pronto', 'Expedido', 'expedido', 'Concluído', 'Concluido', 'Em produção');

-- 2. Trigger function: when any order_stage transitions to em_andamento (in progress),
-- bump the parent sale_order to 'Em Produção' (only if currently Aprovado).
DROP FUNCTION IF EXISTS public.auto_promote_sale_order_to_production() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_promote_sale_order_to_production()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_order_id UUID;
  v_current_status TEXT;
BEGIN
  -- Only react when stage starts (transitions into em_andamento)
  IF NEW.status NOT IN ('em_andamento', 'in_progress', 'iniciado') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Find the parent sale_order via the OP
  SELECT o.sale_order_id INTO v_sale_order_id
  FROM public.orders o
  WHERE o.id = NEW.order_id;

  IF v_sale_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_current_status
  FROM public.sale_orders
  WHERE id = v_sale_order_id;

  -- Only promote from Aprovado (do not override Cancelado / Rascunho intent)
  IF v_current_status = 'Aprovado' THEN
    UPDATE public.sale_orders
    SET status = 'Em Produção', updated_at = NOW()
    WHERE id = v_sale_order_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_promote_sale_order_to_production ON public.order_stages;
CREATE TRIGGER trg_auto_promote_sale_order_to_production
AFTER INSERT OR UPDATE OF status ON public.order_stages
FOR EACH ROW
EXECUTE FUNCTION public.auto_promote_sale_order_to_production();
