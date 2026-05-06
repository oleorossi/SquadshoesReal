-- =============================================================================
-- Add is_approved_user() guard to SECURITY DEFINER stock-mutation RPCs
-- =============================================================================
-- Audit-30 finding [3]: the following RPCs were SECURITY DEFINER + GRANT TO
-- authenticated but had no is_approved_user() check, letting any authenticated
-- user (including unapproved signups) mutate inventory arbitrarily:
--   adjust_stock, restore_product_stocks_for_order, restore_sole_grade_for_order,
--   release_order_reservations, finalize_production_sector, complete_order_stages_bulk
--
-- Mirrors the pattern from 20260507180000, 20260519170000, 20260520120000,
-- 20260520130000.
-- =============================================================================

-- 1. adjust_stock
DROP FUNCTION IF EXISTS public.adjust_stock(p_product_id UUID, p_expected_previous_qty NUMERIC, p_new_qty NUMERIC, p_delta NUMERIC, p_reason TEXT, p_new_grade JSONB, p_order_id UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.adjust_stock(
    p_product_id UUID,
    p_expected_previous_qty NUMERIC,
    p_new_qty NUMERIC,
    p_delta NUMERIC,
    p_reason TEXT,
    p_new_grade JSONB DEFAULT NULL,
    p_order_id UUID DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    current_db_qty NUMERIC,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actual_qty NUMERIC;
    v_movement_type TEXT;
    v_actual_delta NUMERIC;
BEGIN
    IF NOT public.is_approved_user() THEN
        RAISE EXCEPTION 'Permission denied: usuário não aprovado';
    END IF;

    IF p_new_qty < 0 THEN
        RETURN QUERY SELECT false, p_expected_previous_qty, 'NEGATIVE_QTY_NOT_ALLOWED'::TEXT;
        RETURN;
    END IF;

    SELECT quantity INTO v_actual_qty
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0::NUMERIC, 'Produto não encontrado'::TEXT;
        RETURN;
    END IF;

    IF v_actual_qty != p_expected_previous_qty THEN
        RETURN QUERY SELECT false, v_actual_qty, 'CONCURRENCY_ERROR'::TEXT;
        RETURN;
    END IF;

    v_actual_delta := p_new_qty - v_actual_qty;
    v_movement_type := CASE WHEN v_actual_delta >= 0 THEN 'in' ELSE 'out' END;

    UPDATE public.products
    SET quantity      = p_new_qty,
        current_stock = p_new_qty,
        stock_grade   = COALESCE(p_new_grade, stock_grade),
        updated_at    = NOW()
    WHERE id = p_product_id;

    INSERT INTO public.stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
    ) VALUES (
        p_product_id, v_movement_type, ABS(v_actual_delta),
        v_actual_qty, p_new_qty, p_reason, p_order_id
    );

    RETURN QUERY SELECT true, p_new_qty, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, numeric, numeric, numeric, text, jsonb, uuid) TO authenticated;


-- 2. restore_product_stocks_for_order
DROP FUNCTION IF EXISTS public.restore_product_stocks_for_order(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec RECORD;
  v_current_qty numeric;
  v_net_credit numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOR v_rec IN
    SELECT
      product_id,
      COALESCE(SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN movement_type = 'in'  THEN quantity ELSE 0 END), 0) AS net_debit
    FROM public.stock_movements
    WHERE order_id = p_order_id
    GROUP BY product_id
  LOOP
    v_net_credit := v_rec.net_debit;
    IF v_net_credit <= 0 THEN CONTINUE; END IF;

    SELECT quantity INTO v_current_qty FROM public.products WHERE id = v_rec.product_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    UPDATE public.products
      SET quantity = v_current_qty + v_net_credit, updated_at = now()
      WHERE id = v_rec.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock, description, order_id
    ) VALUES (
      v_rec.product_id, 'in', v_net_credit,
      v_current_qty, v_current_qty + v_net_credit,
      'Restauração de estoque (cancelamento de OP)', p_order_id
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_product_stocks_for_order(uuid) TO authenticated;


-- 3. restore_sole_grade_for_order
DROP FUNCTION IF EXISTS public.restore_sole_grade_for_order(
  p_order_id uuid
) CASCADE;
CREATE OR REPLACE FUNCTION public.restore_sole_grade_for_order(
  p_order_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD;
  v_ref_id uuid;
  v_color text;
  v_grade jsonb;
  v_target_product_id uuid;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_total_restored numeric := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT reference_id, color, grade
    INTO v_ref_id, v_color, v_grade
    FROM public.orders
   WHERE id = p_order_id;

  IF NOT FOUND OR v_grade IS NULL OR jsonb_typeof(v_grade) <> 'object' THEN
    RETURN;
  END IF;

  SELECT tsc.sole_product_id INTO v_target_product_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = v_ref_id
     AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(v_color, '')))
   LIMIT 1;

  IF v_target_product_id IS NULL THEN
    SELECT p.id INTO v_target_product_id
      FROM public.products p
      JOIN public.technical_sheets ts ON ts.id = v_ref_id
     WHERE p.active = true
       AND (p.group_id = ts.sole_group_id OR ts.primary_sole_id = p.id)
     ORDER BY
       CASE WHEN UPPER(TRIM(COALESCE(p.color,''))) = UPPER(TRIM(COALESCE(v_color,'')))
            THEN 0 ELSE 1 END,
       p.updated_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_target_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT stock_grade INTO v_stock_grade
    FROM public.products WHERE id = v_target_product_id;

  v_new_grade := COALESCE(v_stock_grade, '{}'::jsonb);

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
      FROM jsonb_each_text(v_grade)
     WHERE value::numeric > 0
  LOOP
    v_new_grade := jsonb_set(
      v_new_grade,
      ARRAY[v_size],
      to_jsonb(COALESCE((v_new_grade ->> v_size)::numeric, 0) + v_size_qty)
    );
    v_total_restored := v_total_restored + v_size_qty;
  END LOOP;

  IF v_total_restored > 0 THEN
    UPDATE public.products
       SET stock_grade = v_new_grade, updated_at = now()
     WHERE id = v_target_product_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_sole_grade_for_order(uuid) TO authenticated;


-- 4. release_order_reservations
DROP FUNCTION IF EXISTS public.release_order_reservations(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.release_order_reservations(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  UPDATE material_reservations SET status = 'cancelled', updated_at = now()
  WHERE order_id = p_order_id AND status IN ('reserved', 'partially_consumed');
  DELETE FROM reservation_batches WHERE order_id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_order_reservations(uuid) TO authenticated;


-- 5. finalize_production_sector
DROP FUNCTION IF EXISTS public.finalize_production_sector(p_order_id uuid, p_current_sector text) CASCADE;
CREATE OR REPLACE FUNCTION public.finalize_production_sector(p_order_id uuid, p_current_sector text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 AS $function$
DECLARE
  v_next_sector TEXT;
  v_result JSONB;
  v_started_at TIMESTAMPTZ;
  v_actual_minutes NUMERIC;
  v_current_stage_order INTEGER;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT started_at, stage_order
    INTO v_started_at, v_current_stage_order
  FROM public.order_stages
  WHERE order_id = p_order_id AND stage_name = p_current_sector;

  IF v_started_at IS NOT NULL THEN
    v_actual_minutes := EXTRACT(EPOCH FROM (NOW() - v_started_at)) / 60;
  ELSE
    v_actual_minutes := 0;
  END IF;

  UPDATE public.order_stages
  SET
    status = 'concluido',
    completed_at = NOW(),
    actual_time_minutes = v_actual_minutes,
    quantity_processed = GREATEST(quantity_processed, quantity_total),
    updated_at = NOW()
  WHERE order_id = p_order_id
    AND stage_name = p_current_sector
    AND status != 'concluido';

  SELECT stage_name INTO v_next_sector
  FROM public.order_stages
  WHERE order_id = p_order_id
    AND stage_order > COALESCE(v_current_stage_order, -1)
    AND status NOT IN ('concluido', 'cancelado')
  ORDER BY stage_order ASC
  LIMIT 1;

  IF v_next_sector IS NOT NULL THEN
    UPDATE public.orders
    SET
      status = 'Em Produção',
      production_step = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.production_orders
    SET
      current_sector = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    INSERT INTO public.notifications (sector, message)
    VALUES (v_next_sector, 'Nova carga de trabalho disponível: OP #' || p_order_id);

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', v_next_sector,
      'status', 'Em Produção',
      'actual_time_minutes', v_actual_minutes
    );
  ELSE
    UPDATE public.orders
    SET
      status = 'Pronto',
      production_step = 'Pronto',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.production_orders
    SET
      status = 'Pronto',
      current_sector = 'Pronto',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', NULL,
      'status', 'Pronto',
      'actual_time_minutes', v_actual_minutes
    );
  END IF;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.finalize_production_sector(uuid, text) TO authenticated;


-- 6. complete_order_stages_bulk
DROP FUNCTION IF EXISTS public.complete_order_stages_bulk(
  p_order_id uuid,
  p_stage_names text[]
) CASCADE;
CREATE OR REPLACE FUNCTION public.complete_order_stages_bulk(
  p_order_id uuid,
  p_stage_names text[]
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
  v_now   timestamptz := now();
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  UPDATE public.order_stages
     SET status              = 'concluido',
         quantity_processed  = GREATEST(quantity_processed, quantity_total),
         completed_at        = COALESCE(completed_at, v_now),
         started_at          = COALESCE(started_at, v_now),
         updated_at          = v_now
   WHERE order_id = p_order_id
     AND stage_name = ANY(p_stage_names)
     AND status <> 'concluido';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_order_stages_bulk(uuid, text[]) TO authenticated;

COMMENT ON FUNCTION public.complete_order_stages_bulk(uuid, text[]) IS
  'Marks the listed order_stages as concluded and sets quantity_processed=quantity_total. Requires approved user.';
