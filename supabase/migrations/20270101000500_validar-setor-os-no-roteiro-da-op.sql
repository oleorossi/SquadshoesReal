-- Segurança/integridade: uma OS vinculada a OP só pode apontar para um setor
-- que realmente exista no roteiro daquela OP. A enumeração isolada não basta:
-- sem este check seria possível terceirizar uma etapa que a referência não usa.
CREATE OR REPLACE FUNCTION public.tg_guard_service_order_from_op()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_order_qty numeric;
  v_stage_name text;
BEGIN
  IF NEW.order_id IS NULL OR NEW.source_sale_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT quantity INTO v_order_qty FROM public.orders WHERE id = NEW.order_id;
  IF v_order_qty IS NULL THEN
    RAISE EXCEPTION 'OP de origem não encontrada';
  END IF;
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 OR NEW.quantity > v_order_qty THEN
    RAISE EXCEPTION 'Quantidade da OS (%) deve estar entre 1 e a quantidade da OP (%)', NEW.quantity, v_order_qty;
  END IF;

  v_stage_name := CASE COALESCE(NEW.target_sector, '')
    WHEN 'corte_cabedal' THEN 'Corte Cabedal'
    WHEN 'costura' THEN 'Costura'
    WHEN 'corte_palmilha' THEN 'Corte Palmilha'
    WHEN 'corte_forracao' THEN 'Corte Forração'
    WHEN 'silk' THEN 'Silk'
    WHEN 'montagem' THEN 'Montagem'
    WHEN 'solagem' THEN 'Solagem'
    WHEN 'acabamento' THEN 'Acabamento'
    ELSE NULL
  END;
  IF v_stage_name IS NULL THEN
    RAISE EXCEPTION 'Setor de terceirização inválido: %', NEW.target_sector;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_stages
     WHERE order_id = NEW.order_id
       AND lower(trim(stage_name)) = lower(v_stage_name)
  ) THEN
    RAISE EXCEPTION 'Setor % não pertence ao roteiro da OP', v_stage_name;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_service_order_from_op ON public.service_orders;
CREATE TRIGGER trg_guard_service_order_from_op
  BEFORE INSERT OR UPDATE OF order_id, source_sale_order_id, quantity, target_sector
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_service_order_from_op();

-- As duas rotinas são detalhes da implementação da consolidação. O endpoint
-- público compact_sale_order já executa ambas como SECURITY DEFINER e valida
-- administrador; elas não devem aparecer como RPCs navegáveis pela API.
REVOKE ALL ON FUNCTION public.compact_sale_order_items(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compact_orders_by_ref_color(uuid) FROM PUBLIC, anon, authenticated;
