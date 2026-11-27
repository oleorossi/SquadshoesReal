-- Apontamento canônico parcial (estado depois ledger) não pode baixar 2×.
-- Recria o contrato da 66300 num Postgres vazio.
BEGIN;

CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  material_reservation_id uuid,
  movement_type text,
  quantity numeric,
  description text
);

CREATE TABLE public.material_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  status text,
  metadata jsonb,
  quantity_consumed numeric DEFAULT 0
);

CREATE TABLE public.order_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  stage_name text,
  stage_order integer,
  quantity_processed numeric
);

CREATE TABLE public.production_pointings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  stage_name text,
  quantity numeric
);

CREATE OR REPLACE FUNCTION public.canonical_stage_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT p; $$;

CREATE OR REPLACE FUNCTION public.sole_grade_already_debited_pairs(p_order_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(sum(sm.quantity), 0)
    FROM public.stock_movements sm
   WHERE sm.order_id = p_order_id
     AND sm.movement_type = 'out'
     AND COALESCE(sm.quantity, 0) > 0
     AND (
       sm.description LIKE 'Baixa Solagem%'
       OR EXISTS (
         SELECT 1
           FROM public.material_reservations mr
          WHERE mr.id = sm.material_reservation_id
            AND COALESCE(mr.metadata->>'kind', '') = 'sole_grade'
       )
     );
$function$;

CREATE OR REPLACE FUNCTION public.debit_sole_grade_for_solagem_pointing(
  p_order_id uuid,
  p_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_res uuid;
BEGIN
  IF COALESCE(p_quantity, 0) <= 0 THEN
    RETURN jsonb_build_object('debited_pairs', 0, 'skipped', true);
  END IF;
  SELECT id INTO v_res
    FROM public.material_reservations
   WHERE order_id = p_order_id AND status = 'reserved'
   LIMIT 1;
  INSERT INTO public.stock_movements (
    order_id, material_reservation_id, movement_type, quantity, description
  ) VALUES (
    p_order_id, v_res, 'out', p_quantity, 'Baixa Solagem — Solado por grade (ensaio)'
  );
  RETURN jsonb_build_object('debited_pairs', p_quantity);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.debit_sole_grade_up_to(
  p_order_id uuid,
  p_target_pairs numeric
)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_already numeric;
  v_take numeric;
BEGIN
  IF p_order_id IS NULL OR COALESCE(p_target_pairs, 0) <= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'requested_pairs', 0);
  END IF;
  v_already := public.sole_grade_already_debited_pairs(p_order_id);
  v_take := GREATEST(0, p_target_pairs - v_already);
  IF v_take <= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'already_debited', v_already, 'requested_pairs', 0);
  END IF;
  RETURN public.debit_sole_grade_for_solagem_pointing(p_order_id, CEIL(v_take)::integer);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.tg_debit_sole_on_solagem_stage_progress()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.stage_name IS DISTINCT FROM 'Solagem' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.quantity_processed, 0) <= COALESCE(OLD.quantity_processed, 0) THEN
    RETURN NEW;
  END IF;
  PERFORM public.debit_sole_grade_up_to(NEW.order_id, NEW.quantity_processed);
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_debit_sole_on_solagem_stage_progress
  AFTER UPDATE OF quantity_processed ON public.order_stages
  FOR EACH ROW
  WHEN (NEW.quantity_processed IS DISTINCT FROM OLD.quantity_processed)
  EXECUTE FUNCTION public.tg_debit_sole_on_solagem_stage_progress();

CREATE OR REPLACE FUNCTION public.tg_debit_sole_on_solagem_pointing()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_processed numeric;
  v_already numeric;
  v_target numeric;
BEGIN
  IF NEW.order_id IS NULL OR COALESCE(NEW.quantity, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.stage_name IS DISTINCT FROM 'Solagem' THEN
    RETURN NEW;
  END IF;

  SELECT os.quantity_processed
    INTO v_processed
    FROM public.order_stages os
   WHERE os.order_id = NEW.order_id
     AND os.stage_name = 'Solagem'
   ORDER BY os.stage_order, os.id
   LIMIT 1;

  v_already := public.sole_grade_already_debited_pairs(NEW.order_id);
  v_processed := COALESCE(v_processed, 0);

  IF v_processed >= NEW.quantity THEN
    v_target := GREATEST(v_processed, v_already);
  ELSE
    v_target := v_already + NEW.quantity;
  END IF;

  PERFORM public.debit_sole_grade_up_to(NEW.order_id, v_target);
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_debit_sole_on_solagem_pointing
  AFTER INSERT ON public.production_pointings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_debit_sole_on_solagem_pointing();

INSERT INTO public.material_reservations (id, order_id, status, metadata)
VALUES (
  '00000000-0000-0000-0000-0000000000aa',
  '00000000-0000-0000-0000-000000000001',
  'reserved',
  '{"kind": "sole_grade"}'::jsonb
);

INSERT INTO public.order_stages (id, order_id, stage_name, stage_order, quantity_processed)
VALUES (
  '00000000-0000-0000-0000-0000000000bb',
  '00000000-0000-0000-0000-000000000001',
  'Solagem', 9, 0
);

-- Caminho canônico: estado 0→30, depois ledger qty=30.
UPDATE public.order_stages
   SET quantity_processed = 30
 WHERE id = '00000000-0000-0000-0000-0000000000bb';

INSERT INTO public.production_pointings (order_id, stage_name, quantity)
VALUES ('00000000-0000-0000-0000-000000000001', 'Solagem', 30);

DO $assert_once$
DECLARE
  v_sum numeric;
  v_n integer;
  v_already numeric;
BEGIN
  SELECT COALESCE(sum(quantity), 0), count(*)
    INTO v_sum, v_n
    FROM public.stock_movements
   WHERE order_id = '00000000-0000-0000-0000-000000000001'
     AND movement_type = 'out';
  IF v_n IS DISTINCT FROM 1 OR v_sum IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'canônico parcial rebaixou: n=% sum=% (esperado n=1 sum=30)', v_n, v_sum;
  END IF;
  v_already := public.sole_grade_already_debited_pairs('00000000-0000-0000-0000-000000000001');
  IF v_already IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'already_debited=% (esperado 30 no movimento físico)', v_already;
  END IF;
END;
$assert_once$;

-- Legado: pointing sem bump do estágio ainda baixa a qty.
INSERT INTO public.material_reservations (id, order_id, status, metadata)
VALUES (
  '00000000-0000-0000-0000-0000000000cc',
  '00000000-0000-0000-0000-000000000002',
  'reserved',
  '{"kind": "sole_grade"}'::jsonb
);

INSERT INTO public.production_pointings (order_id, stage_name, quantity)
VALUES ('00000000-0000-0000-0000-000000000002', 'Solagem', 12);

DO $assert_legacy$
DECLARE
  v_sum numeric;
BEGIN
  SELECT COALESCE(sum(quantity), 0) INTO v_sum
    FROM public.stock_movements
   WHERE order_id = '00000000-0000-0000-0000-000000000002'
     AND movement_type = 'out';
  IF v_sum IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION 'legado pointing-only deveria baixar 12, baixou %', v_sum;
  END IF;
END;
$assert_legacy$;

ROLLBACK;
