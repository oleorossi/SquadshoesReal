-- Quando start_wave() é chamado, atualiza as OPs dos PVs da onda para
-- status 'Em Produção', para que o sistema de etiquetas (LabelProductionTab)
-- exiba o status correto. OPs criadas pelo fluxo 'Aprovado → WaveBuilder'
-- ficavam em 'Reservado' mesmo durante a execução da onda.

DROP FUNCTION IF EXISTS public.start_wave(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now         timestamptz := now();
  v_first_stage production_stage_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Inicia estágios ord=1 (Corte) + Mesa independente
  UPDATE production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = v_now,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND status = 'pending'
     AND (stage_order(stage) = 1 OR stage = 'mesa');

  SELECT stage INTO v_first_stage
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = 1
     AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves
     SET status        = 'running',
         current_stage  = v_first_stage,
         started_at     = COALESCE(started_at, v_now)
   WHERE id = p_wave_id;

  -- Promove as OPs dos PVs desta onda para 'Em Produção'
  -- (OPs criadas no fluxo Aprovado ficam em 'Reservado' até aqui)
  UPDATE orders o
     SET status     = 'Em Produção',
         updated_at = v_now
   WHERE o.sale_order_id IN (
     SELECT DISTINCT pwis.sale_order_id
       FROM production_wave_item_sources pwis
       JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
      WHERE pwi.wave_id = p_wave_id
   )
     AND o.status NOT IN ('Em Produção', 'Finalizado', 'Cancelada');
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_wave(uuid) TO authenticated;
