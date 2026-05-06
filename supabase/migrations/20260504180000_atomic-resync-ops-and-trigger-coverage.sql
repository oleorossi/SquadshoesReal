-- ---------------------------------------------------------------
-- 20260504180000_atomic-resync-ops-and-trigger-coverage.sql
--
-- Corrige cenários onde alteração de dados técnicos em referências
-- com OPs ATIVAS (Reservado / Em Produção) deixava o estoque dessincronizado
-- com a nova ficha:
--
-- BUG #1 — Triggers ausentes
--   Resync automático só roda quando se altera technical_sheets ou
--   sheet_materials. Mas essas outras mudanças TAMBÉM impactam consumo
--   e NÃO disparavam resync:
--     - sole_size_conjugations (conjugação 23/24) → débito de solado
--     - technical_sheet_palmilha_colors → débito de palmilha quando
--       insole_has_lining=false
--     - artisanal_recipes (yield_per_meter, labor_cost) → consumo de
--       MP base em OSs artesanais
--   Solução: triggers AFTER UPDATE/INSERT/DELETE nessas tabelas
--   marcam as OPs/OSs afetadas em uma fila (`resync_queue`) que o
--   frontend consulta periodicamente.
--
-- BUG #2 — Resync não-atômico no TS
--   src/lib/resyncOPs.ts faz 7 passos sem transação. Crash entre passo 1
--   (estorno) e passo 4 (re-débito) deixa estoque devolvido sem novo
--   débito. Solução: RPC `resync_op_atomic(op_id)` que faz tudo numa
--   única transação SQL. Lock na linha da OP previne concorrência.
--
-- BUG #3 — production_consumptions deletado
--   Resync deletava production_consumptions, perdendo histórico de quem
--   consumiu. Solução: marca como `superseded_at = now()` em vez de
--   DELETE, preservando auditoria.
-- ---------------------------------------------------------------

-- =====================================================================
-- 1) Fila de resync — OPs/OSs marcadas para resync pelo trigger
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.resync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  artisanal_order_id uuid,
  reason text NOT NULL,
  triggered_by text NOT NULL,         -- ex: 'sole_size_conjugations.update'
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

-- =====================================================================
-- 2) production_consumptions: campo superseded_at (preserva auditoria)
-- =====================================================================
ALTER TABLE public.production_consumptions
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text;

CREATE INDEX IF NOT EXISTS idx_prod_cons_active
  ON public.production_consumptions (order_id)
  WHERE superseded_at IS NULL;

-- =====================================================================
-- 3) Triggers que enfileiram resync quando dados técnicos mudam
-- =====================================================================

-- 3a) sole_size_conjugations — afeta débito de solado por grade
CREATE OR REPLACE FUNCTION public.fn_enqueue_resync_for_sole_conjugation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sole_group_id uuid;
BEGIN
  v_sole_group_id := COALESCE(NEW.sole_group_id, OLD.sole_group_id);

  -- Find OPs whose sole product belongs to this group AND are still active.
  INSERT INTO public.resync_queue (order_id, reason, triggered_by)
  SELECT DISTINCT o.id,
         'Conjugação de solado alterada',
         TG_TABLE_NAME || '.' || TG_OP
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    JOIN public.products sole_p ON sole_p.id = ts.sole_id
   WHERE sole_p.group_id = v_sole_group_id
     AND LOWER(COALESCE(o.status, '')) IN ('reservado', 'em produção', 'em produção');
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_resync_for_sole_conjugation ON public.sole_size_conjugations;
CREATE TRIGGER trg_resync_for_sole_conjugation
  AFTER INSERT OR UPDATE OR DELETE ON public.sole_size_conjugations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_resync_for_sole_conjugation();

-- 3b) technical_sheet_palmilha_colors — afeta débito de palmilha quando insole_has_lining=false
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

-- 3c) artisanal_recipes — afeta consumo de MP base em OSs artesanais
-- Apenas dispara se a tabela artisanal_orders existir (pode não existir
-- em ambientes que não têm o módulo artesanal habilitado).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'artisanal_orders') THEN

    EXECUTE $f$
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

-- =====================================================================
-- 4) RPC atômica que faz o resync de uma única OP em transação
-- =====================================================================
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
  -- Lock the order row to prevent concurrent resyncs of the same OP.
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
    -- OPs finalizadas/canceladas ficam congeladas; resync não se aplica.
    RETURN jsonb_build_object('skipped', true, 'reason', 'OP not active', 'status', v_op.status);
  END IF;

  v_grade := COALESCE(v_op.grade, '{}'::jsonb);

  -- 1) Estorno: para cada movement_type='out' anterior, cria um 'in' compensatório
  --    e atualiza products.quantity. Tudo dentro da mesma transação.
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

  -- 2) Marca production_consumptions como superseded (preserva auditoria)
  UPDATE public.production_consumptions
     SET superseded_at = now(),
         superseded_reason = 'resync_op_atomic'
   WHERE order_id = p_order_id
     AND superseded_at IS NULL;

  -- 3) Reservas e estágios são recriados — podem ser hard-deleted
  DELETE FROM public.material_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_stages WHERE order_id = p_order_id;

  -- 4) Invalida snapshot da PV/item (força recálculo com ficha atual)
  IF v_op.sale_order_id IS NOT NULL THEN
    DELETE FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_op.sale_order_id;
  END IF;

  -- 5) Detach old movements para que próximo débito não seja confundido
  UPDATE public.stock_movements
     SET order_id = NULL
   WHERE order_id = p_order_id
     AND movement_type = 'out';

  -- 6) Restaura grade do solado se função existir (ambiente legado pode não ter)
  BEGIN
    PERFORM public.restore_sole_grade_for_order(p_order_id);
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  -- 7) Re-débito principal (cabedal/forração/etc)
  PERFORM public.hybrid_debit_stock_for_order(
    v_op.reference_id,
    v_op.quantity,
    COALESCE(v_op.color, ''),
    p_order_id,
    CASE WHEN v_grade <> '{}'::jsonb THEN v_grade ELSE NULL END
  );

  -- 8) Re-débito do solado por grade (se houver grade)
  IF v_grade <> '{}'::jsonb THEN
    BEGIN
      PERFORM public.debit_sole_stock_by_grade(
        v_op.reference_id, p_order_id, COALESCE(v_op.color, ''), v_grade
      );
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END IF;

  -- 9) Recria estágios de produção a partir da ficha técnica atual
  --    (mantém o comportamento antigo de DEFAULT_STAGES como fallback).
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
             FROM technical_sheets ts,
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

-- =====================================================================
-- 5) RPC para processar a fila — batch processor
-- =====================================================================
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
       AND order_id IS NOT NULL  -- Artisanal handler not yet implemented in SQL
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
