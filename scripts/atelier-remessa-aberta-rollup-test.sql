-- Conferência com a OS ainda aceitando remessa não pode concluir.
-- Duas partes na mesma OS: o estorno da segunda não zera a primeira.
BEGIN;

CREATE TABLE IF NOT EXISTS public.service_orders (
  id uuid PRIMARY KEY,
  order_number text,
  quantity numeric,
  status text,
  total_value numeric,
  accepting_shipments boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.service_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid,
  atelier_job_id uuid,
  atelier_part_id uuid,
  quantity numeric,
  delivered_qty numeric DEFAULT 0,
  total_value numeric DEFAULT 0,
  meters numeric DEFAULT 0,
  line_status text DEFAULT 'Pendente',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS accepting_shipments boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.tg_service_order_rollup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_os      uuid;
  v_total   numeric;
  v_meters  numeric;
  v_pend    integer;
  v_active  integer;
  v_cur     text;
  v_open    boolean;
BEGIN
  v_os := COALESCE(NEW.service_order_id, OLD.service_order_id);
  IF v_os IS NULL THEN RETURN NULL; END IF;

  SELECT
    COALESCE(SUM(total_value) FILTER (WHERE line_status <> 'Cancelado'), 0),
    COALESCE(SUM(meters)      FILTER (WHERE line_status <> 'Cancelado'), 0),
    COUNT(*) FILTER (WHERE line_status = 'Pendente'),
    COUNT(*) FILTER (WHERE line_status <> 'Cancelado')
  INTO v_total, v_meters, v_pend, v_active
  FROM public.service_order_items
  WHERE service_order_id = v_os;

  SELECT status, COALESCE(accepting_shipments, false)
    INTO v_cur, v_open
    FROM public.service_orders WHERE id = v_os;

  UPDATE public.service_orders
     SET total_value = v_total,
         status = CASE
           WHEN v_active > 0 AND v_pend = 0
                AND NOT COALESCE(v_open, false)
                AND lower(btrim(v_cur)) NOT IN ('cancelado','cancelada','cancelled','concluído','concluido','finalizado')
             THEN 'Concluído'
           ELSE status END,
         updated_at = now()
   WHERE id = v_os;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_soi_rollup ON public.service_order_items;
CREATE TRIGGER trg_soi_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.service_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_order_rollup();

INSERT INTO public.service_orders (id, order_number, quantity, status, accepting_shipments)
VALUES ('00000000-0000-0000-0000-000000000010', 'OS-ABERTA', 20, 'Em Andamento', true);

INSERT INTO public.service_order_items (
  id, service_order_id, atelier_job_id, atelier_part_id, quantity, delivered_qty, total_value, line_status, created_at
) VALUES (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-0000000000j1',
  '00000000-0000-0000-0000-0000000000p1',
  10, 0, 50, 'Pendente', '2026-11-19 10:00:00+00'
);

UPDATE public.service_order_items
   SET delivered_qty = 10, line_status = 'Entregue'
 WHERE id = '00000000-0000-0000-0000-0000000000a1';

DO $assert_open$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.service_orders
   WHERE id = '00000000-0000-0000-0000-000000000010';
  IF v_status IS DISTINCT FROM 'Em Andamento' THEN
    RAISE EXCEPTION 'OS aberta fechou na conferência: %', v_status;
  END IF;
END;
$assert_open$;

INSERT INTO public.service_order_items (
  id, service_order_id, atelier_job_id, atelier_part_id, quantity, delivered_qty, total_value, line_status, created_at
) VALUES (
  '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-0000000000j1',
  '00000000-0000-0000-0000-0000000000p2',
  10, 10, 50, 'Entregue', '2026-11-19 11:00:00+00'
);

DO $assert_still_open$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.service_orders
   WHERE id = '00000000-0000-0000-0000-000000000010';
  IF v_status IS DISTINCT FROM 'Em Andamento' THEN
    RAISE EXCEPTION 'segunda remessa fechou a OS aberta: %', v_status;
  END IF;
END;
$assert_still_open$;

-- Estorno da parte 2 tem que achar a linha da parte 2, não a primeira do job.
DO $assert_line$
DECLARE
  v_part uuid := '00000000-0000-0000-0000-0000000000p2';
  v_job uuid := '00000000-0000-0000-0000-0000000000j1';
  v_os uuid := '00000000-0000-0000-0000-000000000010';
  v_wrong uuid;
  v_right uuid;
BEGIN
  SELECT i.id INTO v_wrong FROM public.service_order_items i
   WHERE i.service_order_id = v_os
     AND (i.atelier_job_id = v_job OR i.atelier_part_id = v_part)
   ORDER BY i.created_at
   LIMIT 1;
  SELECT i.id INTO v_right FROM public.service_order_items i
   WHERE i.service_order_id = v_os
     AND (
       CASE
         WHEN v_part IS NOT NULL THEN i.atelier_part_id = v_part
         ELSE i.atelier_job_id = v_job
       END
     )
   ORDER BY i.created_at
   LIMIT 1;
  IF v_wrong IS DISTINCT FROM '00000000-0000-0000-0000-0000000000a1' THEN
    RAISE EXCEPTION 'o seletor velho deveria pegar a primeira linha e pegou %', v_wrong;
  END IF;
  IF v_right IS DISTINCT FROM '00000000-0000-0000-0000-0000000000a2' THEN
    RAISE EXCEPTION 'o seletor novo deveria pegar a parte 2 e pegou %', v_right;
  END IF;
END;
$assert_line$;

UPDATE public.service_orders
   SET accepting_shipments = false
 WHERE id = '00000000-0000-0000-0000-000000000010';

UPDATE public.service_order_items
   SET updated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000000a2';

DO $assert_closed$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.service_orders
   WHERE id = '00000000-0000-0000-0000-000000000010';
  IF v_status IS DISTINCT FROM 'Concluído' THEN
    RAISE EXCEPTION 'depois de Encerrar envios a OS deveria concluir e ficou %', v_status;
  END IF;
END;
$assert_closed$;

ROLLBACK;
