-- AUDITORIA PV 2026-06-10 (F1 — CRÍTICO): faturar nunca baixava o estoque
-- soft-reservado. O claim 'Faturado' finalizava as OPs via trigger, disparando
-- o release-on-terminal que CANCELAVA (sem consumir) as reservas — o passo de
-- conversão do front virava letra morta. Produção: 746 reservas canceladas
-- com consumo=0; 55 OPs de solado sem NENHUM stock_movement 'out'.
-- Fix: converter (baixa física) ANTES de finalizar.
CREATE OR REPLACE FUNCTION public.finalize_orders_on_sale_order_billed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
BEGIN
  IF NEW.status IN ('Faturado','Finalizado s/ NF')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    FOR v_order IN
      SELECT id FROM public.orders
       WHERE sale_order_id = NEW.id
         AND COALESCE(status, '') NOT IN ('Finalizado','cancelada','Cancelada','cancelled')
    LOOP
      PERFORM public.convert_reservation_to_out(v_order.id);
    END LOOP;

    UPDATE public.orders
       SET status = 'Finalizado', updated_at = now()
     WHERE sale_order_id = NEW.id
       AND COALESCE(status, '') NOT IN ('Finalizado','cancelada','Cancelada','cancelled');
  END IF;
  RETURN NEW;
END;
$function$;
