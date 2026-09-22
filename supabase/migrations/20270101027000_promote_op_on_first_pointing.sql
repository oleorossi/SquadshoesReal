-- Promote OP Reservado → Em Produção on the first real pointing.
--
-- Until this, apontar_producao_setor / execute_production_pointing_command never
-- flipped orders.status. tg_sync_production_queue only maps
-- 'Em Produção' → queue_status 'em_producao', so a reserved OP stayed na_fila
-- forever after the first drag/apontamento from the Fila tab.
--
-- Trigger on production_pointings (qty > 0): same transaction as the command,
-- so the queue flips before the client invalidates production_queue_detail.

CREATE OR REPLACE FUNCTION public.tg_promote_op_on_first_pointing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 OR NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.orders o
     SET status = 'Em Produção',
         updated_at = pg_catalog.now()
   WHERE o.id = NEW.order_id
     AND o.deleted_at IS NULL
     AND o.status = 'Reservado';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_op_on_first_pointing ON public.production_pointings;
CREATE TRIGGER trg_promote_op_on_first_pointing
  AFTER INSERT ON public.production_pointings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_promote_op_on_first_pointing();

COMMENT ON FUNCTION public.tg_promote_op_on_first_pointing() IS
  'No 1º apontamento (qty>0) de OP Reservada, promove pra Em Produção → fila em_producao.';

REVOKE ALL ON FUNCTION public.tg_promote_op_on_first_pointing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_promote_op_on_first_pointing() TO authenticated, service_role;
