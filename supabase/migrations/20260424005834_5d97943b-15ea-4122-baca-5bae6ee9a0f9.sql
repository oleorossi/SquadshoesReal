-- 1. Update finalize_production_sector to calculate actual_time_minutes
CREATE OR REPLACE FUNCTION public.finalize_production_sector(p_order_id uuid, p_current_sector text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next_sector TEXT;
  v_next_status TEXT;
  v_result JSONB;
  v_started_at TIMESTAMPTZ;
  v_actual_minutes NUMERIC;
BEGIN
  -- Get started_at for duration calculation
  SELECT started_at INTO v_started_at 
  FROM public.order_stages 
  WHERE order_id = p_order_id AND stage_name = p_current_sector;

  IF v_started_at IS NOT NULL THEN
    v_actual_minutes := EXTRACT(EPOCH FROM (NOW() - v_started_at)) / 60;
  ELSE
    v_actual_minutes := 0;
  END IF;

  CASE p_current_sector
    WHEN 'Corte' THEN v_next_sector := 'Aviamento';
    WHEN 'Aviamento' THEN v_next_sector := 'Solagem';
    WHEN 'Solagem' THEN v_next_sector := 'Acabamento';
    WHEN 'Acabamento' THEN v_next_sector := 'Pronto';
    ELSE 
      v_next_sector := NULL;
  END CASE;

  UPDATE public.order_stages
  SET 
    status = 'concluido',
    completed_at = NOW(),
    actual_time_minutes = v_actual_minutes,
    updated_at = NOW()
  WHERE order_id = p_order_id 
    AND stage_name = p_current_sector
    AND status != 'concluido';

  IF v_next_sector IS NOT NULL THEN
    v_next_status := CASE 
      WHEN v_next_sector = 'Pronto' THEN 'Pronto'
      ELSE 'EM_' || UPPER(v_next_sector)
    END;
    
    UPDATE public.orders
    SET 
      status = v_next_status,
      production_step = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.production_orders
    SET 
      status = v_next_status,
      current_sector = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    INSERT INTO public.notifications (sector, message)
    VALUES (v_next_sector, 'Nova carga de trabalho disponível: OP #' || p_order_id);

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', v_next_sector,
      'status', v_next_status,
      'actual_time_minutes', v_actual_minutes
    );
  ELSE
    UPDATE public.orders
    SET 
      status = 'FINALIZADO',
      production_step = 'Pronto',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', NULL,
      'status', 'FINALIZADO',
      'actual_time_minutes', v_actual_minutes
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- 2. Update advance_wave_stage to record started_at and finished_at
CREATE OR REPLACE FUNCTION public.advance_wave_stage(p_wave_id uuid)
 RETURNS production_stage_enum
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current production_stage_enum;
  v_next production_stage_enum;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  SELECT current_stage INTO v_current FROM production_waves WHERE id = p_wave_id;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Onda % não iniciada. Chame start_wave() primeiro.', p_wave_id;
  END IF;

  -- Complete current stage
  UPDATE production_wave_stages
  SET 
    status = 'completed',
    finished_at = v_now,
    updated_at = v_now
  WHERE wave_id = p_wave_id AND stage = v_current;

  -- Determine next stage
  SELECT stage INTO v_next FROM (
    SELECT 'corte'::production_stage_enum AS stage, 1 AS ord
    UNION ALL SELECT 'costura', 2
    UNION ALL SELECT 'montagem', 3
    UNION ALL SELECT 'solagem', 4
    UNION ALL SELECT 'acabamento', 5
  ) s WHERE s.ord = stage_order(v_current) + 1;

  IF v_next IS NULL THEN
    UPDATE production_waves
    SET status = 'finished', finished_at = v_now, current_stage = NULL
    WHERE id = p_wave_id;
    RETURN NULL;
  END IF;

  -- Start next stage
  UPDATE production_wave_stages
  SET 
    status = 'in_progress', 
    operator_id = auth.uid(),
    started_at = v_now,
    updated_at = v_now
  WHERE wave_id = p_wave_id AND stage = v_next;

  UPDATE production_waves SET current_stage = v_next WHERE id = p_wave_id;

  IF v_next = 'acabamento' THEN
    PERFORM split_wave_to_finishing(p_wave_id);
  END IF;

  RETURN v_next;
END;
$function$;

-- 3. Update start_wave to record started_at on the first stage
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  UPDATE production_wave_stages
  SET 
    status = 'in_progress', 
    operator_id = COALESCE(operator_id, auth.uid()),
    started_at = v_now,
    updated_at = v_now
  WHERE wave_id = p_wave_id AND stage = 'corte';

  UPDATE production_waves SET
    status = 'running',
    current_stage = 'corte',
    started_at = COALESCE(started_at, v_now)
  WHERE id = p_wave_id;
END;
$function$;
