-- Trigger automático: quando TODAS as etapas de uma OP estão 'concluido', marca a OP como 'Finalizado'
-- Isso garante consistência independente de qual módulo atualize order_stages (Kanban, RPC, página de setor, etc.)

DROP FUNCTION IF EXISTS public.auto_finalize_order_on_all_stages_done() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_finalize_order_on_all_stages_done()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_done INT;
  v_order_id UUID;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'concluido')
    INTO v_total, v_done
  FROM public.order_stages
  WHERE order_id = v_order_id;

  IF v_total > 0 AND v_done = v_total THEN
    UPDATE public.orders
    SET status = 'Finalizado',
        production_step = 'Acabamento',
        updated_at = NOW()
    WHERE id = v_order_id
      AND status NOT IN ('Finalizado', 'Cancelada', 'Cancelado');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_finalize_order ON public.order_stages;
CREATE TRIGGER trg_auto_finalize_order
AFTER INSERT OR UPDATE OF status ON public.order_stages
FOR EACH ROW
EXECUTE FUNCTION public.auto_finalize_order_on_all_stages_done();

-- Backfill: corrige qualquer OP que já tenha todas as etapas concluídas mas status ≠ Finalizado
UPDATE public.orders o
SET status = 'Finalizado',
    production_step = 'Acabamento',
    updated_at = NOW()
WHERE o.status NOT IN ('Finalizado', 'Cancelada', 'Cancelado')
  AND EXISTS (SELECT 1 FROM public.order_stages s WHERE s.order_id = o.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.order_stages s
    WHERE s.order_id = o.id AND s.status <> 'concluido'
  );