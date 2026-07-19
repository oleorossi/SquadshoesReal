-- =============================================================================
-- EQUIPE & CAPACIDADE — ETAPA 2: ligar a medição no motor + planejamento
-- (specs/equipe-e-capacidade-fonte-unica.md, R21, R28, R29, R30, R10)
--
--   R29 sector_rh_hourly_rate()   — custo-hora = média dos salários do setor ÷ 220
--   R21/R30 get_model_productivity v5 — camada 'medido' entre última referência e
--           padrão da categoria: a ficha MANDA quando tem valor (escala do RH não
--           achata a diferença entre modelos)
--   R28 medido não sofre efficiency_pct (já embute a ineficiência real)
--   R10 capacity_planning_comparison() — lado a lado antes de trocar a fonte do
--       Planejamento Diário, e apply_capacity_to_planning() para aplicar
-- =============================================================================

-- 1) Custo-hora derivado do RH (R29) ------------------------------------------
-- Se o roster do RH define a capacidade, tem que definir a taxa também — senão o
-- denominador vem do RH e o numerador de cadastro manual desatualizado.
-- Fallback em sector_labor_rates quando o setor não tem gente no RH.
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
BEGIN
  SELECT round(avg(e.salary) / 220.0, 4), count(*)::integer
    INTO v_avg, v_n
    FROM employees e
   WHERE e.active
     AND coalesce(e.payment_type, 'mensalista') <> 'producao'
     AND coalesce(e.salary, 0) > 0
     AND public.capacity_sector_key(e.department) = public.capacity_sector_key(p_sector);

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

-- 2) Comparativo do Planejamento Diário (R10) ---------------------------------
-- O planejamento lê technical_sheets.*_capacity_per_day com fallback em
-- sector_settings.daily_capacity_pairs (600 liso). Esta função mostra, por setor,
-- o que ele usa hoje × o que a capacidade derivada diria — para conferir o
-- impacto ANTES de trocar (a troca move as datas de toda a fábrica).
CREATE OR REPLACE FUNCTION public.capacity_planning_comparison()
RETURNS TABLE (
  setor            text,
  capacidade_atual integer,
  capacidade_nova  numeric,
  fonte_nova       text,
  variacao_pct     numeric,
  detalhe          text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_ss      record;
  v_med     jsonb;
  v_team    record;
  v_params  record;
  v_nova    numeric;
  v_fonte   text;
  v_min     numeric;
  v_det     text;
BEGIN
  SELECT * INTO v_params FROM capacity_parameters LIMIT 1;

  FOR v_ss IN SELECT s.sector, s.daily_capacity_pairs FROM sector_settings s
               WHERE s.enabled ORDER BY s.flow_order
  LOOP
    v_med := public.sector_measured_capacity(v_ss.sector, 3650);
    v_nova := NULL; v_fonte := 'sem_dado'; v_det := NULL;

    IF (v_med->>'pairs_per_day') IS NOT NULL THEN
      -- Capacidade MEDIDA: soma das pessoas. Não sofre eficiência (R28).
      v_nova := (v_med->>'pairs_per_day')::numeric;
      v_fonte := 'medido';
      v_det := format('%s de %s pessoa(s) medida(s) · %s min-pessoa/par',
                      v_med->>'pessoas_medidas', v_med->>'pessoas_total',
                      v_med->>'min_person_per_pair');
    ELSE
      -- Sem medição: teórico pela equipe efetiva e pelo tempo médio do setor.
      SELECT * INTO v_team FROM public.sector_effective_team(v_ss.sector);
      SELECT round(avg(bo.standard_time_minutes), 4) INTO v_min
        FROM bom_operations bo JOIN technical_sheets ts ON ts.id = bo.sheet_id
       WHERE bo.active AND bo.standard_time_minutes > 0 AND ts.status = 'Ativo'
         AND public.capacity_sector_key(bo.stage) = public.capacity_sector_key(v_ss.sector);

      IF v_team.valor IS NOT NULL AND coalesce(v_min, 0) > 0 THEN
        v_nova := floor(v_team.valor * v_params.journey_minutes
                        * (v_params.efficiency_pct / 100.0) / v_min);
        v_fonte := 'teorico';
        v_det := format('equipe %s (%s) × %s min ÷ %s min/par médio',
                        v_team.valor, v_team.origem, v_params.journey_minutes, v_min);
      ELSE
        v_det := CASE WHEN v_team.valor IS NULL
                      THEN 'sem equipe informada — setor não dimensionado'
                      ELSE 'sem tempo de operação neste setor' END;
      END IF;
    END IF;

    RETURN QUERY SELECT
      v_ss.sector,
      v_ss.daily_capacity_pairs,
      CASE WHEN v_nova IS NULL THEN NULL ELSE round(v_nova, 0) END,
      v_fonte,
      CASE WHEN v_nova IS NULL OR coalesce(v_ss.daily_capacity_pairs, 0) = 0 THEN NULL
           ELSE round((v_nova - v_ss.daily_capacity_pairs) * 100.0 / v_ss.daily_capacity_pairs, 1) END,
      v_det;
  END LOOP;
END;
$$;

-- Aplica a capacidade derivada no Planejamento Diário. NÃO roda sozinha: o dono
-- confere o comparativo e aciona. Só troca setores com número derivado — os
-- "não dimensionado" ficam como estão (nunca vira 0/600 silencioso).
CREATE OR REPLACE FUNCTION public.apply_capacity_to_planning()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_rec     record;
  v_changes jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'não autorizado';
  END IF;

  FOR v_rec IN SELECT * FROM public.capacity_planning_comparison()
                WHERE capacidade_nova IS NOT NULL AND capacidade_nova > 0
  LOOP
    UPDATE sector_settings
       SET daily_capacity_pairs = v_rec.capacidade_nova::integer,
           updated_at = now()
     WHERE sector = v_rec.setor
       AND daily_capacity_pairs IS DISTINCT FROM v_rec.capacidade_nova::integer;

    IF FOUND THEN
      v_changes := v_changes || jsonb_build_object(
        'setor', v_rec.setor,
        'de',    v_rec.capacidade_atual,
        'para',  v_rec.capacidade_nova,
        'fonte', v_rec.fonte_nova);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('alterados', jsonb_array_length(v_changes), 'mudancas', v_changes);
END;
$$;

REVOKE ALL ON FUNCTION public.sector_rh_hourly_rate(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capacity_planning_comparison() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_capacity_to_planning() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sector_rh_hourly_rate(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capacity_planning_comparison() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_capacity_to_planning() TO authenticated, service_role;
