DROP FUNCTION IF EXISTS public.advance_wave_stage(p_wave_id uuid, p_stage   production_stage_enum) CASCADE;
CREATE OR REPLACE FUNCTION public.advance_wave_stage(
  p_wave_id uuid,
  p_stage   production_stage_enum DEFAULT NULL
)
RETURNS production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current   production_stage_enum;
  v_target    production_stage_enum;
  v_next      production_stage_enum;
  v_now       timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Lock pessimista para evitar concorrência
  SELECT current_stage
    INTO v_current
    FROM public.production_waves
   WHERE id = p_wave_id
     FOR UPDATE;

  IF v_current IS NULL AND p_stage IS NULL THEN
    RAISE EXCEPTION 'Onda % não iniciada. Chame start_wave() primeiro.', p_wave_id;
  END IF;

  v_target := COALESCE(p_stage, v_current);

  -- 1. Marcar estágio da onda como concluído
  UPDATE public.production_wave_stages
     SET status      = 'completed',
         finished_at = COALESCE(finished_at, v_now),
         progress_pct = 100,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND stage   = v_target;

  -- 2. Sincronização Onda -> Kanban (order_stages)
  -- Encontra todos os setores do Kanban que correspondem a este estágio da onda e os conclui
  UPDATE public.order_stages os
     SET status           = 'concluido',
         completed_at     = COALESCE(os.completed_at, v_now),
         quantity_processed = os.quantity_total,
         updated_at       = v_now
    FROM public.orders o
    JOIN public.production_wave_item_sources pwis ON pwis.sale_order_id = o.sale_order_id
    JOIN public.production_wave_items pwi         ON pwi.id = pwis.wave_item_id
   WHERE pwi.wave_id = p_wave_id
     AND os.order_id  = o.id
     AND lower(trim(os.stage_name)) = ANY(public.wave_stage_to_kanban_stages(v_target))
     AND os.status NOT IN ('concluido', 'completed', 'done');

  -- 3. Verificar se ainda existem estágios pendentes no mesmo nível de ordem
  IF EXISTS (
    SELECT 1
      FROM public.production_wave_stages
     WHERE wave_id = p_wave_id
       AND public.stage_order(stage) = public.stage_order(v_target)
       AND status <> 'completed'
       AND stage <> v_target
  ) THEN
    RETURN v_current;
  END IF;

  -- 4. Avançar para o próximo nível de estágio
  SELECT pws.stage
    INTO v_next
    FROM public.production_wave_stages pws
   WHERE pws.wave_id = p_wave_id
     AND public.stage_order(pws.stage) = public.stage_order(v_target) + 1
     AND pws.status <> 'completed'
   ORDER BY pws.stage
   LIMIT 1;

  IF v_next IS NULL THEN
    -- Se não há mais nada, finaliza a onda
    IF NOT EXISTS (
      SELECT 1
        FROM public.production_wave_stages
       WHERE wave_id = p_wave_id
         AND status <> 'completed'
    ) THEN
      UPDATE public.production_waves
         SET status      = 'finished',
             finished_at = v_now,
             current_stage = NULL
       WHERE id = p_wave_id;
      RETURN NULL;
    END IF;
    RETURN v_current;
  END IF;

  -- 5. Iniciar o próximo estágio
  UPDATE public.production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = COALESCE(started_at, v_now),
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND stage   = v_next;

  UPDATE public.production_waves
     SET current_stage = v_next,
         updated_at = v_now
   WHERE id = p_wave_id;

  -- Acionamento automático do setor de acabamento
  IF v_next = 'acabamento' THEN
    PERFORM public.split_wave_to_finishing(p_wave_id);
  END IF;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_wave_stage(uuid, production_stage_enum) TO authenticated;
