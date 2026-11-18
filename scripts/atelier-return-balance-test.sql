-- Cenário do Ateliê num Postgres vazio: parcial, estorno, receber de novo,
-- defeito, retrabalho, voltar bom. O estorno entra positivo e o saldo subtrai.
BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_service_order_status(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(COALESCE(p, '')))
    WHEN 'concluído' THEN 'Concluído'
    WHEN 'concluido' THEN 'Concluído'
    WHEN 'cancelado' THEN 'Cancelado'
    ELSE COALESCE(p, '')
  END;
$$;

CREATE OR REPLACE FUNCTION public.service_order_return_physical_sign(p_kind text, p_reverses uuid)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_reverses IS NOT NULL OR p_kind = 'reversal' THEN -1
    WHEN p_kind = 'scrap' THEN 0
    ELSE 1
  END;
$$;

CREATE TABLE IF NOT EXISTS public.service_orders (
  id uuid PRIMARY KEY,
  order_number text,
  quantity numeric NOT NULL,
  status text,
  dispatch_tracked boolean,
  contractor_id uuid,
  unit_price numeric
);

CREATE TABLE IF NOT EXISTS public.service_order_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL,
  contractor_id uuid,
  qty_dispatched integer NOT NULL
);

CREATE TABLE IF NOT EXISTS public.service_order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL,
  contractor_id uuid,
  qty_good integer NOT NULL DEFAULT 0,
  qty_defect integer NOT NULL DEFAULT 0,
  qty_defect_scrapped integer NOT NULL DEFAULT 0,
  qty_loss integer NOT NULL DEFAULT 0,
  adjustment_kind text,
  reverses_return_id uuid
);

CREATE TABLE IF NOT EXISTS public.atelier_job_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  pairs integer NOT NULL DEFAULT 0,
  qty_defect integer NOT NULL DEFAULT 0,
  qty_loss integer NOT NULL DEFAULT 0,
  reversed_at timestamptz,
  rework_resolution_id uuid
);

CREATE OR REPLACE FUNCTION public.tg_validate_service_order_return()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_dispatched bigint := 0;
  v_returned bigint := 0;
  v_sign integer;
  v_new_total bigint;
BEGIN
  IF NEW.reverses_return_id IS NOT NULL OR COALESCE(NEW.adjustment_kind, '') IN ('reversal', 'scrap') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_so FROM public.service_orders WHERE id = NEW.service_order_id;
  SELECT COALESCE(sum(d.qty_dispatched), 0) INTO v_dispatched
    FROM public.service_order_dispatches d WHERE d.service_order_id = NEW.service_order_id;
  SELECT COALESCE(sum(
           public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id)
           * (r.qty_good + r.qty_defect + r.qty_loss)
         ), 0) INTO v_returned
    FROM public.service_order_returns r WHERE r.service_order_id = NEW.service_order_id;
  v_sign := public.service_order_return_physical_sign(NEW.adjustment_kind, NEW.reverses_return_id);
  v_new_total := v_sign * (NEW.qty_good + NEW.qty_defect + NEW.qty_loss);
  IF v_returned + v_new_total > v_dispatched THEN
    RAISE EXCEPTION
      'Retorno excede o despacho do prestador: % devolvidos após o lançamento, % enviados',
      v_returned + v_new_total, v_dispatched;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_test_return ON public.service_order_returns;
CREATE TRIGGER trg_test_return
  BEFORE INSERT ON public.service_order_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_service_order_return();

CREATE OR REPLACE FUNCTION public.atelier_job_open_received(p_job_id uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(r.pairs + r.qty_defect + r.qty_loss), 0)
    FROM public.atelier_job_receipts r
   WHERE r.job_id = p_job_id
     AND r.reversed_at IS NULL
     AND r.rework_resolution_id IS NULL;
$$;

INSERT INTO public.service_orders (id, order_number, quantity, status, dispatch_tracked, unit_price)
VALUES ('00000000-0000-0000-0000-000000000010', 'OS-TESTE', 12, 'Em Andamento', true, 5);

INSERT INTO public.service_order_dispatches (service_order_id, qty_dispatched)
VALUES ('00000000-0000-0000-0000-000000000010', 12);

INSERT INTO public.service_order_returns (id, service_order_id, qty_good, qty_defect)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000010', 4, 1);

INSERT INTO public.service_order_returns (id, service_order_id, qty_good, qty_loss)
VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000010', 3, 1);

INSERT INTO public.service_order_returns (
  service_order_id, qty_good, qty_loss, adjustment_kind, reverses_return_id
) VALUES (
  '00000000-0000-0000-0000-000000000010', 3, 1, 'reversal', '00000000-0000-0000-0000-0000000000a2'
);

INSERT INTO public.service_order_returns (service_order_id, qty_good)
VALUES ('00000000-0000-0000-0000-000000000010', 7);

DO $expect_block$
BEGIN
  INSERT INTO public.service_order_returns (service_order_id, qty_good)
  VALUES ('00000000-0000-0000-0000-000000000010', 1);
  RAISE EXCEPTION 'o par acima do despacho foi aceito';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%excede o despacho%' THEN
      RAISE;
    END IF;
END;
$expect_block$;

INSERT INTO public.service_order_dispatches (service_order_id, qty_dispatched)
VALUES ('00000000-0000-0000-0000-000000000010', 1);

INSERT INTO public.service_order_returns (service_order_id, qty_good)
VALUES ('00000000-0000-0000-0000-000000000010', 1);

DO $assert_net$
DECLARE
  v_net bigint;
BEGIN
  SELECT COALESCE(sum(
           public.service_order_return_physical_sign(adjustment_kind, reverses_return_id)
           * (qty_good + qty_defect + qty_loss)
         ), 0)
    INTO v_net
    FROM public.service_order_returns
   WHERE service_order_id = '00000000-0000-0000-0000-000000000010';
  IF v_net <> 13 THEN
    RAISE EXCEPTION 'saldo líquido deveria ser 13 e foi %', v_net;
  END IF;
END;
$assert_net$;

INSERT INTO public.atelier_job_receipts (job_id, pairs, qty_defect)
VALUES ('00000000-0000-0000-0000-000000000020', 4, 1);
INSERT INTO public.atelier_job_receipts (job_id, pairs, rework_resolution_id)
VALUES ('00000000-0000-0000-0000-000000000020', 1, '00000000-0000-0000-0000-000000000030');

DO $assert_job$
DECLARE
  v_open numeric;
BEGIN
  SELECT public.atelier_job_open_received('00000000-0000-0000-0000-000000000020') INTO v_open;
  IF v_open <> 5 THEN
    RAISE EXCEPTION 'retrabalho somou no job: %', v_open;
  END IF;
END;
$assert_job$;

ROLLBACK;
