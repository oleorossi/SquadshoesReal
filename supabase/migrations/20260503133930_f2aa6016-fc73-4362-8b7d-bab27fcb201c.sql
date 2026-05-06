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
    UPDATE production_wave_stages
       SET status = 'in_progress'
     WHERE wave_id = v_wave.id AND stage = 'corte_palmilha';

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