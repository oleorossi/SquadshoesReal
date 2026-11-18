-- Defeito, retrabalho, retorno sem conta, recebimento final e conclusão.
-- Contas a pagar = só os pares bons originais × tarifa.
BEGIN;

CREATE TABLE public.service_orders (
  id uuid PRIMARY KEY,
  quantity numeric NOT NULL,
  status text NOT NULL,
  dispatch_tracked boolean NOT NULL,
  unit_price numeric NOT NULL
);

CREATE TABLE public.service_order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL,
  qty_good integer NOT NULL DEFAULT 0,
  qty_defect integer NOT NULL DEFAULT 0,
  qty_loss integer NOT NULL DEFAULT 0,
  adjustment_kind text,
  reverses_return_id uuid
);

CREATE TABLE public.accounts_payable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount numeric NOT NULL,
  status text NOT NULL,
  reference_id uuid,
  reference_type text
);

CREATE OR REPLACE FUNCTION public.tg_ap_per_service_order_return()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_price numeric;
BEGIN
  IF NEW.reverses_return_id IS NOT NULL
     OR COALESCE(NEW.adjustment_kind, '') IN ('reversal', 'rework_return') THEN
    UPDATE public.accounts_payable
       SET status = 'cancelled'
     WHERE reference_type = 'service_order_return'
       AND reference_id = NEW.id
       AND status = 'pending';
    RETURN NEW;
  END IF;
  SELECT unit_price INTO v_price FROM public.service_orders WHERE id = NEW.service_order_id;
  IF COALESCE(NEW.qty_good, 0) <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.accounts_payable (amount, status, reference_id, reference_type)
  VALUES (NEW.qty_good * v_price, 'pending', NEW.id, 'service_order_return');
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_ap
  AFTER INSERT OR UPDATE ON public.service_order_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_ap_per_service_order_return();

INSERT INTO public.service_orders (id, quantity, status, dispatch_tracked, unit_price)
VALUES ('00000000-0000-0000-0000-000000000010', 12, 'Em Andamento', true, 5);

INSERT INTO public.service_order_returns (service_order_id, qty_good, qty_defect)
VALUES ('00000000-0000-0000-0000-000000000010', 4, 1);

INSERT INTO public.service_order_returns (service_order_id, qty_good, adjustment_kind)
VALUES ('00000000-0000-0000-0000-000000000010', 1, 'rework_return');

INSERT INTO public.accounts_payable (amount, status, reference_id, reference_type)
SELECT 5, 'pending', id, 'service_order_return'
  FROM public.service_order_returns
 WHERE adjustment_kind = 'rework_return';

UPDATE public.service_order_returns
   SET qty_good = qty_good
 WHERE adjustment_kind = 'rework_return';

INSERT INTO public.service_order_returns (service_order_id, qty_good, qty_loss)
VALUES ('00000000-0000-0000-0000-000000000010', 3, 1);

INSERT INTO public.service_order_returns (service_order_id, qty_good)
VALUES ('00000000-0000-0000-0000-000000000010', 3);

DO $assert_close$
DECLARE
  v_pending numeric;
  v_good integer;
  v_loss integer;
  v_rework_ap integer;
BEGIN
  SELECT COALESCE(sum(amount), 0) INTO v_pending
    FROM public.accounts_payable WHERE status = 'pending';
  IF v_pending <> 50 THEN
    RAISE EXCEPTION 'a pagar deveria ser 50 (10 bons × 5) e foi %', v_pending;
  END IF;
  SELECT count(*) INTO v_rework_ap
    FROM public.accounts_payable ap
    JOIN public.service_order_returns r ON r.id = ap.reference_id
   WHERE r.adjustment_kind = 'rework_return' AND ap.status = 'pending';
  IF v_rework_ap <> 0 THEN
    RAISE EXCEPTION 'retrabalho gerou conta pending';
  END IF;
  SELECT COALESCE(sum(qty_good), 0), COALESCE(sum(qty_loss), 0)
    INTO v_good, v_loss
    FROM public.service_order_returns
   WHERE COALESCE(adjustment_kind, '') IS DISTINCT FROM 'reversal';
  IF v_good + v_loss <> 12 THEN
    RAISE EXCEPTION 'bons + perda = % , a OS não fecha em 12', v_good + v_loss;
  END IF;
  UPDATE public.service_orders SET status = 'Concluído'
   WHERE id = '00000000-0000-0000-0000-000000000010';
END;
$assert_close$;

ROLLBACK;
