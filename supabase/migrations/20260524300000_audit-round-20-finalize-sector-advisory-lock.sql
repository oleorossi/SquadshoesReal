-- =============================================================================
-- AUDIT ROUND 20 — finalize_production_sector com advisory lock
-- =============================================================================
-- Bug real: 2 operadores finalizando setores diferentes da MESMA OP
-- simultaneamente: UPDATEs em orders.production_step competem e o último
-- vence. notification duplicada quando 2 threads chegam pro mesmo setor.
--
-- Fix:
--   - pg_advisory_xact_lock(hashtext('finalize_op_'||p_order_id)) no
--     início serializa transições por OP. Lock é por transação, libera
--     no COMMIT. Outras OPs continuam paralelizando normalmente.
--   - GET DIAGNOSTICS após UPDATE em order_stages: se 0 rows updated
--     (já estava concluido), retorna early com already_finalized=true,
--     sem duplicar notification nem mexer em orders/production_orders.
-- =============================================================================

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
  v_rows_updated INTEGER;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finalize_op_' || p_order_id::text));

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
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_finalized', true,
      'message', 'Setor já estava concluído (idempotente)',
      'actual_time_minutes', v_actual_minutes
    );
  END IF;

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
