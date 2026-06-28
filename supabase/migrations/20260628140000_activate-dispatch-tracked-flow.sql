-- Ativa o fluxo remessa→retorno→AP da terceirização (auditoria 2026-06-28).
--
-- Registrar uma remessa (service_order_dispatches) passa a marcar a OS como
-- dispatch_tracked=true. A partir daí a conta a pagar nasce do RETORNO
-- (tg_ap_per_service_order_return: qty_good × unit_price) e o caminho por status
-- (tg_create_ap_for_service_order) pula sozinho (já tem o guard dispatch_tracked),
-- evitando dobro. OS nunca despachada segue no modo simples (AP = total_value ao
-- finalizar). Antes desta flag o subsistema de despacho/retorno (tabelas, views,
-- diálogos) existia mas nunca gerava AP — era "pronto e desligado".
--
-- Aplicada via Supabase MCP em 2026-06-28 (GitHub Action de migrations quebrada).
CREATE OR REPLACE FUNCTION public.tg_apply_service_order_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.service_orders
     SET status = CASE WHEN COALESCE(status,'') IN ('Pendente','pendente')
                       THEN 'Em Andamento' ELSE status END,
         dispatch_tracked = true,
         updated_at = now()
   WHERE id = NEW.service_order_id;
  RETURN NEW;
END;
$function$;
