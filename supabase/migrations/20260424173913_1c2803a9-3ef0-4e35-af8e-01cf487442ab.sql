-- ============================================================
-- Fix finalize_production_sector:
--
-- Problems found in the previous version:
-- 1. Hardcoded sector flow (Corte→Aviamento→Solagem→Acabamento) meant
--    any OP with additional sectors (e.g. Costura, Montagem) defined in
--    the ficha técnica would get stuck when finalized.
-- 2. Intermediate status was set to 'EM_SETOR' (e.g. 'EM_AVIAMENTO')
--    breaking all queries that filter on status = 'Em Produção'.
-- 3. actual_time_minutes was already being computed correctly from
--    started_at, but only populated when the trigger set started_at.
--
-- Fixes:
-- 1. Next sector is determined dynamically from order_stages (stage_order).
-- 2. status stays 'Em Produção' throughout production; 'Pronto' on completion.
-- 3. No change to actual_time_minutes logic (already correct).
-- ============================================================

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
  -- Get started_at for duration calculation
  SELECT started_at, stage_order
    INTO v_started_at, v_current_stage_order
  FROM public.order_stages
  WHERE order_id = p_order_id AND stage_name = p_current_sector;

  IF v_started_at IS NOT NULL THEN
    v_actual_minutes := EXTRACT(EPOCH FROM (NOW() - v_started_at)) / 60;
  ELSE
    v_actual_minutes := 0;
  END IF;

  -- Mark current stage as completed
  UPDATE public.order_stages
  SET
    status = 'concluido',
    completed_at = NOW(),
    actual_time_minutes = v_actual_minutes,
    updated_at = NOW()
  WHERE order_id = p_order_id
    AND stage_name = p_current_sector
    AND status != 'concluido';

  -- Find next pending sector dynamically via stage_order
  SELECT stage_name INTO v_next_sector
  FROM public.order_stages
  WHERE order_id = p_order_id
    AND stage_order > COALESCE(v_current_stage_order, -1)
    AND status NOT IN ('concluido', 'cancelado')
  ORDER BY stage_order ASC
  LIMIT 1;

  IF v_next_sector IS NOT NULL THEN
    -- Advance production_step; keep status = 'Em Produção'.
    -- The trigger sync_order_stages_with_kanban will set started_at on the next stage.
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
    -- All sectors done: mark OP as Pronto
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

-- Also fix any existing orders that ended up with stale 'EM_*' status values.
-- Restore them to 'Em Produção' so they show up in standard production queries.
UPDATE public.orders
SET status = 'Em Produção', updated_at = NOW()
WHERE status LIKE 'EM_%'
  AND production_step IS NOT NULL
  AND production_step NOT IN ('Pronto', 'Pendente', 'Finalizado');