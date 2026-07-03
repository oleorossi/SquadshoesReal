-- P0.2 / C3 — consumo registrado automaticamente na finalização da OP.
--
-- Choke point: AFTER UPDATE OF status → 'Finalizado' pega os DOIS caminhos reais
-- (finalize_orders_on_sale_order_billed no faturamento — que converte reservas
-- ANTES de setar o status, então os 'out' já existem — e finalize_production_sector
-- do apontamento). EXCEPTION→WARNING: o ledger NUNCA aborta faturamento/produção.
-- Quando o apontamento de Corte entrar em uso operacional, a mesma função
-- (re-entrante via supersede) pode ser chamada também na conclusão do Corte.

CREATE OR REPLACE FUNCTION public.tg_record_consumption_on_finalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM public.record_order_consumption(NEW.id, 'finalizacao');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'record_order_consumption falhou para OP %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tg_record_consumption_on_finalize() FROM public, anon;

DROP TRIGGER IF EXISTS trg_record_consumption_on_finalize ON public.orders;
CREATE TRIGGER trg_record_consumption_on_finalize
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'Finalizado' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_record_consumption_on_finalize();
