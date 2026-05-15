-- FIX: stages "pendente" em OPs já "Finalizado" (auditoria — 296 stages, 29.484 pares-fantasma)
-- A transição OP -> Finalizado (via NF emitida, mudança manual, ou
-- trg_finalize_orders_on_sale_order_billed) não fechava os order_stages.
-- Resultado: relatórios de "produção pendente" mostravam stages de OPs
-- já concluídas.

-- 1) Backfill histórico
UPDATE public.order_stages
   SET status = 'concluido',
       quantity_processed = COALESCE(quantity_total, quantity_processed),
       updated_at = now()
 WHERE status = 'pendente'
   AND order_id IN (SELECT id FROM public.orders WHERE status IN ('Finalizado','Concluído','Concluido'));

-- 2) Trigger preventivo
CREATE OR REPLACE FUNCTION public.tg_close_stages_on_op_finalize()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('Finalizado','Concluído','Concluido')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.order_stages
       SET status = 'concluido',
           quantity_processed = COALESCE(quantity_total, quantity_processed),
           updated_at = now()
     WHERE order_id = NEW.id
       AND status = 'pendente';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_close_stages_on_op_finalize ON public.orders;
CREATE TRIGGER trg_close_stages_on_op_finalize
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_close_stages_on_op_finalize();
