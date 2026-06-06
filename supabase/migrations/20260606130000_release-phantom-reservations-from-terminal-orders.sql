-- Fix #6 (auditoria JIT 2026-06-06): 97,7% do reserved_stock era fantasma — 113 reservas
-- 'reserved' (quantity_consumed=0) de 58 OPs Finalizadas, nunca liberadas. Como o trigger
-- de sync só cobre INSERT (não UPDATE), reserved_stock ficava inflado (38/41 produtos com
-- disponível negativo), distorcendo disponibilidade e o plano semanal de compras.

-- 1) BACKFILL: cancela reservas órfãs de OPs em status terminal e ressincroniza os produtos.
DO $$
DECLARE r RECORD;
BEGIN
  CREATE TEMP TABLE _affected_products ON COMMIT DROP AS
    SELECT DISTINCT mr.product_id
      FROM material_reservations mr
      JOIN orders o ON o.id = mr.order_id
     WHERE mr.status = 'reserved'
       AND COALESCE(mr.quantity_consumed, 0) = 0
       AND o.status IN ('Finalizado','Faturado','Cancelado','FINALIZADO');

  UPDATE material_reservations mr
     SET status = 'cancelled', updated_at = now()
    FROM orders o
   WHERE o.id = mr.order_id
     AND mr.status = 'reserved'
     AND COALESCE(mr.quantity_consumed, 0) = 0
     AND o.status IN ('Finalizado','Faturado','Cancelado','FINALIZADO');

  FOR r IN SELECT product_id FROM _affected_products LOOP
    PERFORM sync_product_reserved_stock(r.product_id);
  END LOOP;
END $$;

-- 2) PREVENÇÃO (causa-raiz): quando a OP entra em status terminal, libera as reservas soft
-- remanescentes (não consumidas) e ressincroniza. Antes, OPs que passavam por 'Em Produção'
-- (baixa hard no Kanban) deixavam a reserva soft original órfã ao finalizar.
CREATE OR REPLACE FUNCTION public.tg_release_reservations_on_order_terminal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r RECORD;
BEGIN
  IF NEW.status IN ('Finalizado','Faturado','Cancelado','FINALIZADO')
     AND COALESCE(OLD.status, '') IS DISTINCT FROM NEW.status THEN
    FOR r IN
      UPDATE public.material_reservations
         SET status = 'cancelled', updated_at = now()
       WHERE order_id = NEW.id
         AND status = 'reserved'
         AND COALESCE(quantity_consumed, 0) = 0
      RETURNING product_id
    LOOP
      PERFORM public.sync_product_reserved_stock(r.product_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_release_reservations_on_order_terminal ON public.orders;
CREATE TRIGGER trg_release_reservations_on_order_terminal
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_release_reservations_on_order_terminal();

-- 3) RECONCILIAÇÃO: helper de auditoria (deve retornar 0 linhas após o backfill).
CREATE OR REPLACE FUNCTION public.list_orphan_reservations()
 RETURNS TABLE(reservation_id uuid, order_id uuid, order_number text, order_status text,
               product_id uuid, product_name text, residual numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT mr.id, mr.order_id, o.order_number, o.status, mr.product_id, p.name,
         mr.quantity_reserved - COALESCE(mr.quantity_consumed, 0)
    FROM material_reservations mr
    JOIN orders o ON o.id = mr.order_id
    LEFT JOIN products p ON p.id = mr.product_id
   WHERE mr.status = 'reserved'
     AND COALESCE(mr.quantity_consumed, 0) = 0
     AND o.status IN ('Finalizado','Faturado','Cancelado','FINALIZADO');
$function$;
