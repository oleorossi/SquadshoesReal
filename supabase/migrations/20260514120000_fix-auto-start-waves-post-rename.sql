-- =============================================================================
-- Corrige auto_start_due_waves() após rename de setores (Grupos 13+24):
--   - production_waves.corte_start_date    → corte_palmilha_start_date
--   - production_wave_stages.stage = 'corte' → 'corte_palmilha'
--   - production_waves.current_stage = 'corte' → 'corte_palmilha'
--
-- Sem esta correção a função não encontra nenhuma onda (coluna inexistente
-- dispara exceção silenciosa) e o auto-start nunca ocorre.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.auto_start_due_waves()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave  record;
  v_count int := 0;
BEGIN
  FOR v_wave IN
    SELECT id
      FROM production_waves
     WHERE status IN ('draft', 'planning')
       AND corte_palmilha_start_date IS NOT NULL
       AND corte_palmilha_start_date <= CURRENT_DATE
  LOOP
    -- Mark first stage (corte_palmilha) as in_progress
    UPDATE production_wave_stages
       SET status = 'in_progress'
     WHERE wave_id = v_wave.id AND stage = 'corte_palmilha';

    -- Transition wave to running, flag as auto-started
    UPDATE production_waves
       SET status        = 'running',
           current_stage = 'corte_palmilha',
           started_at    = COALESCE(started_at, now()),
           start_mode    = 'auto'
     WHERE id = v_wave.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_start_due_waves() TO authenticated;
