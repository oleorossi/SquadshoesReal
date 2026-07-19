-- =============================================================================
-- Correções restantes do review (2ª rodada) — 2026-07-19
--  [#21 R12] 'medido' é escala do SETOR, não capacidade informada DO MODELO.
--            Aplicado em 20260719160100 (motor). Efeito: modelos com índice
--            passaram de 50 empatados em 100 para 11 de fato medidos.
--  [#26 R29/R24] diarista/horista contava na equipe mas ficava fora do
--            custo-hora — numerador e denominador de conjuntos diferentes.
--  [#25 R15] team_size deixa de ser fonte gravável: vira espelho de headcount
--            por trigger (mantida porque useProductionEngine ainda a declara).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sector_rh_hourly_rate(p_sector text)
RETURNS TABLE (hourly_rate numeric, origem text, pessoas integer)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_avg   numeric;
  v_n     integer;
  v_fixed numeric;
  v_jorn  numeric;
BEGIN
  SELECT journey_minutes INTO v_jorn FROM capacity_parameters LIMIT 1;
  v_jorn := coalesce(v_jorn, 540);

  -- Custo-hora equivalente por regime: mensalista usa salário ÷ 220; diarista usa
  -- a diária dividida pela jornada; quem tem hourly_rate cadastrado usa o próprio.
  SELECT round(avg(taxa), 4), count(*)::integer
    INTO v_avg, v_n
    FROM (
      SELECT CASE
               WHEN coalesce(e.hourly_rate, 0) > 0 THEN e.hourly_rate
               WHEN coalesce(e.payment_type, 'mensalista') = 'diarista'
                    AND coalesce(e.daily_rate, 0) > 0 THEN e.daily_rate / (v_jorn / 60.0)
               WHEN coalesce(e.salary, 0) > 0 THEN e.salary / 220.0
               ELSE NULL END AS taxa
        FROM employees e
       WHERE e.active
         AND coalesce(e.payment_type, 'mensalista') <> 'producao'
         AND public.capacity_sector_key(e.department) = public.capacity_sector_key(p_sector)
    ) t
   WHERE taxa IS NOT NULL;

  SELECT slr.hourly_rate INTO v_fixed
    FROM sector_labor_rates slr
   WHERE slr.sector_key = public.capacity_sector_key(p_sector);

  IF coalesce(v_avg, 0) > 0 THEN
    RETURN QUERY SELECT v_avg, 'rh'::text, v_n;
  ELSE
    RETURN QUERY SELECT coalesce(v_fixed, 0), 'cadastro'::text, 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_sector_team_size_mirror()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.team_size := CASE WHEN NEW.headcount IS NULL THEN NULL
                        ELSE floor(NEW.headcount)::integer END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_sector_team_size_mirror ON public.sector_settings;
CREATE TRIGGER tg_sector_team_size_mirror
  BEFORE INSERT OR UPDATE ON public.sector_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_sector_team_size_mirror();

UPDATE public.sector_settings
   SET team_size = CASE WHEN headcount IS NULL THEN NULL ELSE floor(headcount)::integer END
 WHERE team_size IS DISTINCT FROM (CASE WHEN headcount IS NULL THEN NULL ELSE floor(headcount)::integer END);

REVOKE ALL ON FUNCTION public.sector_rh_hourly_rate(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sector_rh_hourly_rate(text) TO authenticated, service_role;
