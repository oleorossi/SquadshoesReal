-- 20260429230000_integrity-fixes-locks-constraints.sql

-- ── 1. confirm_picking_reservation: lock pessimista no início ────────────────
CREATE OR REPLACE FUNCTION public.confirm_picking_reservation(
  p_reservation_id uuid,
  p_picked_by text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res RECORD;
  v_current_qty numeric;
BEGIN
  -- Lock pessimista na reserva ANTES de validar status.
  SELECT * INTO v_res
    FROM material_reservations
   WHERE id = p_reservation_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva não encontrada';
  END IF;

  IF v_res.status <> 'reserved' THEN
    RAISE EXCEPTION 'Reserva já consumida ou cancelada (status atual: %)', v_res.status;
  END IF;

  SELECT quantity INTO v_current_qty
    FROM products
   WHERE id = v_res.product_id
     FOR UPDATE;

  IF v_current_qty < v_res.quantity_reserved THEN
    RAISE EXCEPTION 'Estoque insuficiente para confirmar picking: disponivel %, necessario %', v_current_qty, v_res.quantity_reserved;
  END IF;

  UPDATE products
     SET quantity = quantity - v_res.quantity_reserved,
         updated_at = now()
   WHERE id = v_res.product_id;

  INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
  VALUES (v_res.product_id, 'out', v_res.quantity_reserved, v_current_qty, v_current_qty - v_res.quantity_reserved,
          'Debito Picking Confirmado', v_res.order_id);

  UPDATE material_reservations
     SET status = 'consumed',
         quantity_consumed = quantity_reserved,
         consumed_at = now(),
         reservation_type = 'hard',
         updated_at = now()
   WHERE id = p_reservation_id;
END;
$$;

-- ── 2. Trigger: SUM(stock_grade) == quantity ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_grade_quantity_coherence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_grade_sum numeric := 0;
BEGIN
  IF NEW.stock_grade IS NULL OR jsonb_typeof(NEW.stock_grade) <> 'object' THEN
    RETURN NEW;
  END IF;

  IF (SELECT COUNT(*) FROM jsonb_each_text(NEW.stock_grade)) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(GREATEST(0, value::numeric)), 0)
    INTO v_grade_sum
    FROM jsonb_each_text(NEW.stock_grade);

  IF ABS(v_grade_sum - COALESCE(NEW.quantity, 0)) > 0.01 THEN
    RAISE EXCEPTION 'Inconsistência: SUM(stock_grade) = % difere de quantity = % no produto %',
      v_grade_sum, NEW.quantity, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_grade_quantity_coherence ON public.products;
CREATE TRIGGER trg_check_grade_quantity_coherence
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  WHEN (NEW.stock_grade IS DISTINCT FROM OLD.stock_grade
     OR NEW.quantity    IS DISTINCT FROM OLD.quantity)
  EXECUTE FUNCTION public.check_grade_quantity_coherence();

-- ── 3. UNIQUE parcial: 1 OP ativa por sale_order_item_id ─────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_active_per_sale_order_item
  ON public.orders (sale_order_item_id)
  WHERE sale_order_item_id IS NOT NULL AND status <> 'Cancelada';

-- ── 4. UNIQUE em order_number ────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'orders' AND c.conname = 'uq_orders_order_number'
  ) THEN
    BEGIN
      ALTER TABLE public.orders
        ADD CONSTRAINT uq_orders_order_number UNIQUE (order_number);
    EXCEPTION
      WHEN unique_violation THEN
        RAISE NOTICE 'orders.order_number já tem duplicatas — limpe antes de aplicar UNIQUE.';
      WHEN OTHERS THEN
        RAISE NOTICE 'Não foi possível adicionar UNIQUE em orders.order_number: %', SQLERRM;
    END;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'sale_orders' AND c.conname = 'uq_sale_orders_order_number'
  ) THEN
    BEGIN
      ALTER TABLE public.sale_orders
        ADD CONSTRAINT uq_sale_orders_order_number UNIQUE (order_number);
    EXCEPTION
      WHEN unique_violation THEN
        RAISE NOTICE 'sale_orders.order_number já tem duplicatas — limpe antes de aplicar UNIQUE.';
      WHEN OTHERS THEN
        RAISE NOTICE 'Não foi possível adicionar UNIQUE em sale_orders.order_number: %', SQLERRM;
    END;
  END IF;
END $$;

-- ── 5. UNIQUE em nfe_emitidas (company_id, numero, serie) — só autorizadas ───
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname = 'uq_nfe_company_numero_serie_authorized'
  ) THEN
    BEGIN
      EXECUTE $sql$
        CREATE UNIQUE INDEX uq_nfe_company_numero_serie_authorized
          ON public.nfe_emitidas (company_id, numero, serie)
          WHERE status = 'autorizada' AND numero <> '' AND serie <> ''
      $sql$;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE NOTICE 'nfe_emitidas tem duplicatas (company_id, numero, serie) — limpe antes de aplicar.';
      WHEN OTHERS THEN
        RAISE NOTICE 'Não foi possível criar índice nfe_emitidas: %', SQLERRM;
    END;
  END IF;
END $$;

-- ── 6. Trigger: ao cancelar OP, libera reservas ──────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_release_reservations_on_op_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Cancelada' AND OLD.status <> 'Cancelada' THEN
    UPDATE material_reservations
       SET status = 'cancelled',
           updated_at = now()
     WHERE order_id = NEW.id
       AND status IN ('reserved', 'partially_consumed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_release_reservations_on_op_cancel ON public.orders;
CREATE TRIGGER trg_auto_release_reservations_on_op_cancel
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'Cancelada' AND OLD.status IS DISTINCT FROM 'Cancelada')
  EXECUTE FUNCTION public.auto_release_reservations_on_op_cancel();

-- ── 7. advance_wave_stage: FOR UPDATE na wave ────────────────────────────────
CREATE OR REPLACE FUNCTION public.advance_wave_stage(
  p_wave_id uuid,
  p_stage   production_stage_enum
)
RETURNS production_stage_enum
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage_ord int;
  v_next_ord  int;
  v_next      production_stage_enum;
  v_now       timestamptz := now();
  v_wave_id   uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Lock pessimista na onda.
  SELECT id INTO v_wave_id
    FROM production_waves
   WHERE id = p_wave_id
     FOR UPDATE;

  IF v_wave_id IS NULL THEN
    RAISE EXCEPTION 'Onda % não encontrada', p_wave_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM production_wave_stages
    WHERE wave_id = p_wave_id AND stage = p_stage AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Setor % não está em execução na onda %', p_stage, p_wave_id;
  END IF;

  v_stage_ord := stage_order(p_stage);

  UPDATE production_wave_stages
     SET status = 'completed', finished_at = v_now, updated_at = v_now
   WHERE wave_id = p_wave_id AND stage = p_stage;

  IF EXISTS (
    SELECT 1 FROM production_wave_stages
    WHERE wave_id = p_wave_id
      AND stage_order(stage) = v_stage_ord
      AND status NOT IN ('completed', 'blocked')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT MIN(stage_order(stage)) INTO v_next_ord
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) > v_stage_ord
     AND status NOT IN ('completed', 'blocked');

  IF v_next_ord IS NULL THEN
    UPDATE production_waves
       SET status = 'finished', finished_at = v_now, current_stage = NULL
     WHERE id = p_wave_id;
    RETURN NULL;
  END IF;

  UPDATE production_wave_stages
     SET status = 'in_progress', operator_id = auth.uid(),
         started_at = v_now, updated_at = v_now
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = v_next_ord
     AND status = 'pending';

  SELECT stage INTO v_next
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = v_next_ord
     AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves SET current_stage = v_next WHERE id = p_wave_id;

  -- Verifica se existe uma função split_wave_to_finishing definida (para ondas com itens múltiplos)
  -- Se não existir, o erro será capturado.
  BEGIN
    IF EXISTS (
      SELECT 1 FROM production_wave_stages
      WHERE wave_id = p_wave_id AND stage = 'acabamento' AND status = 'in_progress'
    ) THEN
      PERFORM public.split_wave_to_finishing(p_wave_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Silenciosamente ignora se a função não existir (opcional, dependendo do design)
    NULL;
  END;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_wave_stage(uuid, production_stage_enum) TO authenticated;