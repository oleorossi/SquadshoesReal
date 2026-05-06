-- ---------------------------------------------------------------
-- 20260504180000_atomic-resync-ops-and-trigger-coverage.sql
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  artisanal_order_id uuid,
  reason text NOT NULL,
  triggered_by text NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_result jsonb,
  CHECK (order_id IS NOT NULL OR artisanal_order_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_resync_queue_pending
  ON public.resync_queue (enqueued_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resync_queue_order
  ON public.resync_queue (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE public.resync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resync_queue_select ON public.resync_queue;
CREATE POLICY resync_queue_select ON public.resync_queue
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS resync_queue_insert ON public.resync_queue;
CREATE POLICY resync_queue_insert ON public.resync_queue
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS resync_queue_update ON public.resync_queue;
CREATE POLICY resync_queue_update ON public.resync_queue
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

ALTER TABLE public.production_consumptions
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text;

CREATE INDEX IF NOT EXISTS idx_prod_cons_active
  ON public.production_consumptions (order_id)
  WHERE superseded_at IS NULL;

DROP FUNCTION IF EXISTS public.fn_enqueue_resync_for_sole_conjugation() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_enqueue_resync_for_sole_conjugation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sole_group_id uuid;
BEGIN
  v_sole_group_id := COALESCE(NEW.sole_group_id, OLD.sole_group_id);

  INSERT INTO public.resync_queue (order_id, reason, triggered_by)
  SELECT DISTINCT o.id,
         'Conjugação de solado alterada',
         TG_TABLE_NAME || '.' || TG_OP
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    JOIN public.products sole_p ON sole_p.id = ts.sole_id
   WHERE sole_p.group_id = v_sole_group_id
     AND LOWER(COALESCE(o.status, '')) IN ('reservado', 'em produção');
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_resync_for_sole_conjugation ON public.sole_size_conjugations;
CREATE TRIGGER trg_resync_for_sole_conjugation
  AFTER INSERT OR UPDATE OR DELETE ON public.sole_size_conjugations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_resync_for_sole_conjugation();

DROP FUNCTION IF EXISTS public.fn_enqueue_resync_for_palmilha_colors() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_enqueue_resync_for_palmilha_colors()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sheet_id uuid;
BEGIN
  v_sheet_id := COALESCE(NEW.sheet_id, OLD.sheet_id);
  INSERT INTO public.resync_queue (order_id, reason, triggered_by)
  SELECT DISTINCT o.id,
         'Mapeamento cabedal × palmilha alterado',
         TG_TABLE_NAME || '.' || TG_OP
    FROM public.orders o
   WHERE o.reference_id = v_sheet_id
     AND LOWER(COALESCE(o.status, '')) IN ('reservado', 'em produção');
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_resync_for_palmilha_colors ON public.technical_sheet_palmilha_colors;
CREATE TRIGGER trg_resync_for_palmilha_colors
  AFTER INSERT OR UPDATE OR DELETE ON public.technical_sheet_palmilha_colors
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_resync_for_palmilha_colors();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'artisanal_orders') THEN

    EXECUTE $f$
      DROP FUNCTION IF EXISTS public.fn_enqueue_resync_for_artisanal_recipe() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_enqueue_resync_for_artisanal_recipe()
      RETURNS trigger LANGUAGE plpgsql AS $g$
      DECLARE
        v_recipe_id uuid;
      BEGIN
        v_recipe_id := COALESCE(NEW.id, OLD.id);
        INSERT INTO public.resync_queue (artisanal_order_id, reason, triggered_by)
        SELECT DISTINCT ao.id,
               'Receita artesanal alterada (yield/custo)',
               TG_TABLE_NAME || '.' || TG_OP
          FROM public.artisanal_orders ao
         WHERE ao.recipe_id = v_recipe_id
           AND LOWER(COALESCE(ao.status, '')) NOT IN
               ('finalizado','finalizada','cancelado','cancelada','entregue');
        RETURN COALESCE(NEW, OLD);
      END;
      $g$;
    $f$;

    EXECUTE $f$
      DROP TRIGGER IF EXISTS trg_resync_for_artisanal_recipe ON public.artisanal_recipes;
      CREATE TRIGGER trg_resync_for_artisanal_recipe
        AFTER UPDATE ON public.artisanal_recipes
        FOR EACH ROW
        WHEN (
          NEW.yield_per_meter IS DISTINCT FROM OLD.yield_per_meter OR
          NEW.labor_cost_per_meter IS DISTINCT FROM OLD.labor_cost_per_meter OR
          NEW.base_time_minutes IS DISTINCT FROM OLD.base_time_minutes
        )
        EXECUTE FUNCTION public.fn_enqueue_resync_for_artisanal_recipe();
    $f$;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.resync_op_atomic(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op record;
  v_mov record;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_grade jsonb;
  v_status text;
  v_errors text[] := '{}';
BEGIN
  SELECT id, reference_id, quantity, color, grade, sale_order_id, order_number, status
    INTO v_op
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada: %', p_order_id;
  END IF;

  v_status := LOWER(COALESCE(v_op.status, ''));
  IF v_status NOT IN ('reservado', 'em produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'OP not active', 'status', v_op.status);
  END IF;

  v_grade := COALESCE(v_op.grade, '{}'::jsonb);

  FOR v_mov IN
    SELECT product_id, quantity
      FROM public.stock_movements
     WHERE order_id = p_order_id AND movement_type = 'out'
  LOOP
    SELECT quantity INTO v_prev_stock
      FROM public.products
     WHERE id = v_mov.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      v_errors := v_errors || ('Produto não encontrado: ' || v_mov.product_id::text);
      CONTINUE;
    END IF;

    v_new_stock := v_prev_stock + v_mov.quantity;
    UPDATE public.products SET quantity = v_new_stock, updated_at = now()
     WHERE id = v_mov.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_mov.product_id, 'in', v_mov.quantity, v_prev_stock, v_new_stock,
      'Estorno automático - resync_op_atomic', p_order_id
    );
  END LOOP;

  UPDATE public.production_consumptions
     SET superseded_at = now(),
         superseded_reason = 'resync_op_atomic'
   WHERE order_id = p_order_id
     AND superseded_at IS NULL;

  DELETE FROM public.material_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_stages WHERE order_id = p_order_id;

  IF v_op.sale_order_id IS NOT NULL THEN
    DELETE FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_op.sale_order_id;
  END IF;

  UPDATE public.stock_movements
     SET order_id = NULL
   WHERE order_id = p_order_id
     AND movement_type = 'out';

  BEGIN
    PERFORM public.restore_sole_grade_for_order(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM public.hybrid_debit_stock_for_order(
    v_op.reference_id,
    v_op.quantity,
    COALESCE(v_op.color, ''),
    p_order_id,
    CASE WHEN v_grade <> '{}'::jsonb THEN v_grade ELSE NULL END
  );

  IF v_grade <> '{}'::jsonb THEN
    BEGIN
      PERFORM public.debit_sole_stock_by_grade(
        v_op.reference_id, p_order_id, COALESCE(v_op.color, ''), v_grade
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  SELECT p_order_id,
         stage_name,
         stage_order,
         'pendente',
         v_op.quantity,
         0
    FROM (
      SELECT
        COALESCE(
          (SELECT array_agg(value::text ORDER BY ordinality)
             FROM public.technical_sheets ts,
                  jsonb_array_elements_text(ts.production_sectors) WITH ORDINALITY
            WHERE ts.id = v_op.reference_id
              AND ts.production_sectors IS NOT NULL
              AND jsonb_array_length(ts.production_sectors) > 0),
          ARRAY['Corte','Forração','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento']
        ) AS names
    ) s,
    LATERAL (
      SELECT name AS stage_name, ord AS stage_order
        FROM unnest(s.names) WITH ORDINALITY AS u(name, ord)
    ) lat;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_op.order_number,
    'errors', v_errors,
    'resynced_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resync_op_atomic(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.process_resync_queue(p_limit integer) CASCADE;
CREATE OR REPLACE FUNCTION public.process_resync_queue(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_processed integer := 0;
  v_failed integer := 0;
  v_result jsonb;
BEGIN
  FOR v_row IN
    SELECT id, order_id, artisanal_order_id, reason
      FROM public.resync_queue
     WHERE processed_at IS NULL
       AND order_id IS NOT NULL
     ORDER BY enqueued_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_result := public.resync_op_atomic(v_row.order_id);
      UPDATE public.resync_queue
         SET processed_at = now(),
             processed_result = v_result
       WHERE id = v_row.id;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.resync_queue
         SET processed_at = now(),
             processed_result = jsonb_build_object('error', SQLERRM)
       WHERE id = v_row.id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'failed', v_failed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_resync_queue(integer) TO authenticated;

-- ---------------------------------------------------------------
-- 20260504170000_backfill-order-costs-with-packaging.sql
-- ---------------------------------------------------------------

DO $$
DECLARE
  v_oc record;
  v_processed integer := 0;
  v_skipped   integer := 0;
  v_failed    integer := 0;
BEGIN
  FOR v_oc IN
    SELECT oc.sale_order_id, oc.sale_order_item_id, so.status
      FROM public.order_costs oc
      JOIN public.sale_orders so ON so.id = oc.sale_order_id
     ORDER BY oc.calculated_at NULLS FIRST
  LOOP
    IF LOWER(COALESCE(v_oc.status, '')) IN (
         'cancelado', 'cancelada', 'cancelled',
         'entregue', 'delivered',
         'finalizado', 'finalizada', 'finished', 'completed',
         'faturado', 'faturada', 'invoiced'
       ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.calculate_order_cost(
        v_oc.sale_order_id,
        v_oc.sale_order_item_id,
        true
      );
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'Falhou ao recalcular order_cost para (%, %): %',
        v_oc.sale_order_id, v_oc.sale_order_item_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Backfill order_costs: % recalculados, % pulados (finalizados/cancelados), % falharam.',
    v_processed, v_skipped, v_failed;
END;
$$;