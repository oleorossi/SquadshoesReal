-- O planejamento de uma OP e um efeito derivado do PV. Ele pode mudar durante
-- o salvamento de uma ficha tecnica, mas nao pode criar o primeiro fato de
-- demanda de tiras nem bloquear a transacao que originou essa mudanca.
--
-- A primeira demanda continua sendo criada pelos eventos autoritativos do PV
-- (approved/direct_production/item_updated). Depois que ela existe, mudancas no
-- planejamento seguem publicando schedule_changed normalmente.

CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_schedule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_sale_order_id uuid;
  v_status text;
BEGIN
  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  SELECT o.sale_order_id, so.status
    INTO v_sale_order_id, v_status
    FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE o.id = v_order_id;

  IF v_sale_order_id IS NULL
     OR v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- schedule_changed somente revisa um fato ja materializado. Sem demanda
  -- corrente, o PV ainda nao possui baseline autoritativa; o evento derivado e
  -- um no-op e o proximo save do PV continua obrigado a resolver os blockers.
  IF NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
     WHERE d.sale_order_id = v_sale_order_id
       AND d.is_current
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  PERFORM public.enqueue_sale_order_strap_demands(
    v_sale_order_id,
    'schedule_changed',
    gen_random_uuid()
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enqueue_strap_demands_on_schedule_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enqueue_strap_demands_on_schedule_change
  ON public.production_schedule;

CREATE CONSTRAINT TRIGGER trg_enqueue_strap_demands_on_schedule_change
  AFTER INSERT OR UPDATE OR DELETE ON public.production_schedule
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enqueue_strap_demands_on_schedule_change();

COMMENT ON FUNCTION public.tg_enqueue_strap_demands_on_schedule_change() IS
  'Publica schedule_changed apenas para PV com demanda de tiras corrente; a primeira demanda nasce exclusivamente do save autoritativo do PV.';

