-- Estorno não deixa conta pending. Total em aberto = só os pares bons que ficaram.
BEGIN;

CREATE TABLE IF NOT EXISTS public.contractors (
  id uuid PRIMARY KEY,
  name text,
  trade_name text,
  payment_days integer
);

CREATE TABLE IF NOT EXISTS public.service_orders (
  id uuid PRIMARY KEY,
  order_number text,
  quantity numeric,
  status text,
  dispatch_tracked boolean,
  contractor_id uuid,
  unit_price numeric
);

CREATE TABLE IF NOT EXISTS public.service_order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL,
  contractor_id uuid,
  qty_good integer NOT NULL DEFAULT 0,
  qty_defect integer NOT NULL DEFAULT 0,
  qty_loss integer NOT NULL DEFAULT 0,
  adjustment_kind text,
  reverses_return_id uuid,
  returned_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accounts_payable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text,
  supplier_id uuid,
  category text,
  due_date date,
  amount numeric,
  amount_paid numeric DEFAULT 0,
  status text,
  reference_id uuid,
  reference_type text,
  notes text,
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_per_service_order_return_test
  ON public.accounts_payable (reference_id)
  WHERE reference_type = 'service_order_return';

CREATE OR REPLACE FUNCTION public.tg_ap_per_service_order_return()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_amount numeric;
BEGIN
  IF NEW.reverses_return_id IS NOT NULL OR COALESCE(NEW.adjustment_kind, '') = 'reversal' THEN
    UPDATE public.accounts_payable
       SET status = 'cancelled',
           notes = concat_ws(' ', notes, 'Estorno não gera título.')
     WHERE reference_type = 'service_order_return'
       AND reference_id = NEW.id
       AND lower(btrim(status)) IN ('pending', 'pendente', 'open', 'aberto');
    RETURN NEW;
  END IF;
  SELECT * INTO v_so FROM public.service_orders WHERE id = NEW.service_order_id;
  IF NOT FOUND OR NOT COALESCE(v_so.dispatch_tracked, false) OR COALESCE(NEW.qty_good, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  v_amount := NEW.qty_good * COALESCE(v_so.unit_price, 0);
  IF v_amount <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.accounts_payable (
    description, category, due_date, amount, status, reference_id, reference_type
  ) VALUES (
    'conferencia', 'service', CURRENT_DATE, v_amount, 'pending', NEW.id, 'service_order_return'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ap_per_so_return ON public.service_order_returns;
CREATE TRIGGER trg_ap_per_so_return
  AFTER INSERT OR UPDATE ON public.service_order_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_ap_per_service_order_return();

INSERT INTO public.contractors (id, name, payment_days)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'Prestador', 30);

INSERT INTO public.service_orders (id, order_number, quantity, status, dispatch_tracked, contractor_id, unit_price)
VALUES ('00000000-0000-0000-0000-000000000010', 'OS-TESTE', 12, 'Em Andamento', true,
        '00000000-0000-0000-0000-0000000000c1', 5);

INSERT INTO public.service_order_returns (id, service_order_id, qty_good)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000010', 4);

INSERT INTO public.service_order_returns (id, service_order_id, qty_good)
VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000010', 3);

UPDATE public.accounts_payable
   SET status = 'cancelled'
 WHERE reference_id = '00000000-0000-0000-0000-0000000000a2';

INSERT INTO public.service_order_returns (
  id, service_order_id, qty_good, adjustment_kind, reverses_return_id
) VALUES (
  '00000000-0000-0000-0000-0000000000a3',
  '00000000-0000-0000-0000-000000000010',
  3, 'reversal', '00000000-0000-0000-0000-0000000000a2'
);

INSERT INTO public.accounts_payable (
  id, description, category, due_date, amount, status, reference_id, reference_type
) VALUES (
  '00000000-0000-0000-0000-000000006fbc',
  'estorno reaberto', 'service', CURRENT_DATE, 15, 'pending',
  '00000000-0000-0000-0000-0000000000a3', 'service_order_return'
);

UPDATE public.service_order_returns
   SET qty_good = qty_good
 WHERE id = '00000000-0000-0000-0000-0000000000a3';

DO $assert_ap$
DECLARE
  v_pending numeric;
  v_reversal text;
BEGIN
  SELECT COALESCE(sum(amount), 0) INTO v_pending
    FROM public.accounts_payable
   WHERE lower(btrim(status)) = 'pending';
  IF v_pending <> 20 THEN
    RAISE EXCEPTION 'pendente deveria ser 20 e foi %', v_pending;
  END IF;
  SELECT status INTO v_reversal
    FROM public.accounts_payable
   WHERE reference_id = '00000000-0000-0000-0000-0000000000a3';
  IF v_reversal IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'conta do estorno ficou %', COALESCE(v_reversal, 'ausente');
  END IF;
END;
$assert_ap$;

ROLLBACK;
