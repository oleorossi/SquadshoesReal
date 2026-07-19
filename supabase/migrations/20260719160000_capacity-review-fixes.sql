-- =============================================================================
-- CORREÇÕES DO REVIEW ADVERSARIAL (27 achados confirmados) — 2026-07-19
-- specs/equipe-e-capacidade-fonte-unica.md
--
--  [#0/#7 ALTA]  sector_effective_team casava sector_settings por TEXTO CRU
--                enquanto o resto da camada casa por capacity_sector_key —
--                setor criado pela UI com acento ('Preparação' → label
--                'Preparacao') perdia a equipe informada dentro do motor.
--  [#9 BAIXA]    escala que vira o dia (22:00→06:00) dava jornada NEGATIVA,
--                propagando min/par e capacidade negativos.
--  [#6 MEDIA]    RAISE do trigger tinha 3 argumentos para 1 placeholder — o
--                erro de formatação substituía a mensagem útil.
--  [#4/#22 ALTA] a alocação no 2º setor era ignorada (só o department contava):
--                a fração descontava capacidade do setor de origem sem creditar
--                em lugar nenhum.
--  [#8 MEDIA]    regime por par era excluído da MEDIÇÃO, mas é justamente quem
--                alimenta a Chamada do Dia — passa a contar na produção
--                observada (segue fora do headcount e do custo-hora, R3).
--  [#3 MEDIA]    janela de medição unificada entre painel e motor.
--  [#5 ALTA]     setor criado "em paralelo" a setor sequencial caía no grupo
--                'preparacao' e era antecipado para o início do fluxo.
--  [#10/#18 ALTA] set_model_sector_capacity lia headcount CRU e exigia > 0:
--                quebrava justamente onde a equipe vem do RH (a Costura, que
--                motivou o spec). Agora usa a equipe EFETIVA.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sector_effective_team(p_sector text)
RETURNS TABLE (valor numeric, origem text, rh_count integer)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_override numeric;
  v_found    boolean;
  v_rh       integer;
BEGIN
  SELECT ss.headcount, true INTO v_override, v_found
    FROM sector_settings ss
   WHERE public.capacity_sector_key(ss.sector) = public.capacity_sector_key(p_sector)
   ORDER BY (ss.sector = p_sector) DESC, ss.flow_order
   LIMIT 1;

  v_rh := public.sector_rh_headcount(p_sector);

  IF v_override IS NOT NULL THEN
    RETURN QUERY SELECT v_override,
                        CASE WHEN v_rh > 0 AND v_override = v_rh THEN 'rh' ELSE 'manual' END,
                        v_rh;
  ELSIF v_rh > 0 THEN
    RETURN QUERY SELECT v_rh::numeric, 'rh'::text, v_rh;
  ELSE
    RETURN QUERY SELECT NULL::numeric, 'nao_informado'::text, v_rh;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_journey_minutes(p_employee_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT NULLIF(
       CASE WHEN j.m < 0 THEN j.m + 1440 ELSE j.m END, 0)
       FROM (
         SELECT round(extract(epoch from (ws.exit_time - ws.entry_time
                  - coalesce(ws.lunch_end - ws.lunch_start, interval '0'))) / 60) AS m
           FROM employees e JOIN work_schedules ws ON ws.id = e.work_schedule_id
          WHERE e.id = p_employee_id
       ) j
      WHERE CASE WHEN j.m < 0 THEN j.m + 1440 ELSE j.m END BETWEEN 60 AND 720),
    (SELECT journey_minutes FROM capacity_parameters LIMIT 1),
    540)
$$;

CREATE OR REPLACE FUNCTION public.tg_check_allocation_sum()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_total numeric;
  v_nome  text;
BEGIN
  SELECT coalesce(sum(allocation_fraction), 0) INTO v_total
    FROM employee_sector_allocation
   WHERE employee_id = NEW.employee_id
     AND public.capacity_sector_key(sector) <> public.capacity_sector_key(NEW.sector);

  IF v_total + NEW.allocation_fraction > 1.0001 THEN
    SELECT name INTO v_nome FROM employees WHERE id = NEW.employee_id;
    RAISE EXCEPTION 'Alocação de % ultrapassa 100%%: já alocado %%%, tentando somar %%%',
      coalesce(v_nome, '(funcionário)'),
      round(v_total * 100, 0),
      round(NEW.allocation_fraction * 100, 0);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sector_measured_capacity(
  p_sector text,
  p_window_days integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_rec         record;
  v_prod        record;
  v_members     jsonb := '[]'::jsonb;
  v_sum_pairs   numeric := 0;
  v_sum_journey numeric := 0;
  v_total       integer := 0;
  v_medidos     integer := 0;
  v_media       numeric;
  v_cobertura   text;
  v_janela      integer;
BEGIN
  v_janela := coalesce(p_window_days, 3650);

  SELECT round(avg(p.pairs_per_day), 2), count(*)::integer
    INTO v_media, v_medidos
    FROM employees e
    CROSS JOIN LATERAL public.employee_productivity(e.id, p_sector, v_janela) p
   WHERE e.active
     AND (public.capacity_sector_key(e.department) = public.capacity_sector_key(p_sector)
          OR EXISTS (SELECT 1 FROM employee_sector_allocation a
                      WHERE a.employee_id = e.id
                        AND public.capacity_sector_key(a.sector) = public.capacity_sector_key(p_sector)))
     AND p.pairs_per_day IS NOT NULL;

  FOR v_rec IN
    SELECT e.id, e.name,
           coalesce(a.allocation_fraction, 1) AS fracao,
           public.employee_journey_minutes(e.id) AS jornada
      FROM employees e
      LEFT JOIN employee_sector_allocation a
             ON a.employee_id = e.id
            AND public.capacity_sector_key(a.sector) = public.capacity_sector_key(p_sector)
     WHERE e.active
       AND (public.capacity_sector_key(e.department) = public.capacity_sector_key(p_sector)
            OR a.employee_id IS NOT NULL)
     ORDER BY e.name
  LOOP
    v_total := v_total + 1;
    SELECT * INTO v_prod FROM public.employee_productivity(v_rec.id, p_sector, v_janela);

    IF v_prod.pairs_per_day IS NULL AND v_media IS NOT NULL THEN
      v_prod.pairs_per_day := v_media;
      v_prod.fonte := 'estimado_media';
    END IF;

    IF v_prod.pairs_per_day IS NOT NULL THEN
      v_sum_pairs   := v_sum_pairs + v_prod.pairs_per_day * v_rec.fracao;
      v_sum_journey := v_sum_journey + v_rec.jornada * v_rec.fracao;
    END IF;

    v_members := v_members || jsonb_build_object(
      'employee_id',  v_rec.id,
      'nome',         v_rec.name,
      'fracao',       v_rec.fracao,
      'jornada_min',  v_rec.jornada,
      'pares_dia',    v_prod.pairs_per_day,
      'fonte',        v_prod.fonte,
      'dias_medidos', v_prod.dias
    );
  END LOOP;

  v_cobertura := CASE
    WHEN v_total = 0 THEN 'sem_pessoas'
    WHEN v_medidos = 0 THEN 'nenhum'
    WHEN v_medidos < v_total THEN 'parcial'
    ELSE 'total' END;

  RETURN jsonb_build_object(
    'sector',              public.capacity_sector_label(public.capacity_sector_key(p_sector)),
    'pessoas_total',       v_total,
    'pessoas_medidas',     v_medidos,
    'cobertura',           v_cobertura,
    'media_medidos',       v_media,
    'pairs_per_day',       CASE WHEN v_medidos = 0 OR v_sum_pairs <= 0 THEN NULL
                                ELSE round(v_sum_pairs, 2) END,
    'min_person_per_pair', CASE WHEN v_medidos = 0 OR v_sum_pairs <= 0 THEN NULL
                                ELSE round(v_sum_journey / v_sum_pairs, 4) END,
    'jornada_total_min',   round(v_sum_journey, 2),
    'membros',             v_members
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_production_sector(
  p_sector       text,
  p_after_sector text DEFAULT NULL,
  p_parallel     boolean DEFAULT false,
  p_hourly_rate  numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nome  text;
  v_key   text;
  v_after record;
  v_order integer;
  v_group text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'não autorizado';
  END IF;

  v_nome := trim(coalesce(p_sector, ''));
  IF v_nome = '' THEN
    RAISE EXCEPTION 'Informe o nome do setor';
  END IF;
  IF p_hourly_rate IS NULL OR p_hourly_rate < 0 THEN
    RAISE EXCEPTION 'Custo-hora inválido';
  END IF;

  v_key := public.capacity_sector_key(v_nome);

  IF EXISTS (SELECT 1 FROM sector_settings ss
              WHERE public.capacity_sector_key(ss.sector) = v_key) THEN
    RAISE EXCEPTION 'Já existe um setor de produção com esse nome';
  END IF;

  IF p_after_sector IS NOT NULL AND trim(p_after_sector) <> '' THEN
    SELECT flow_order, parallel_group INTO v_after
      FROM sector_settings
     WHERE public.capacity_sector_key(sector) = public.capacity_sector_key(p_after_sector);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Setor de referência % não encontrado', p_after_sector;
    END IF;

    IF p_parallel THEN
      v_order := v_after.flow_order;
      -- Paralelo a setor que JÁ está num grupo herda o grupo; paralelo a setor
      -- sequencial ganha grupo próprio (não pode cair em 'preparacao' e ser
      -- antecipado para o início do fluxo).
      v_group := coalesce(v_after.parallel_group,
                          'par_' || lower(regexp_replace(v_key, '[^a-z0-9]+', '_', 'g')));
    ELSE
      v_order := v_after.flow_order + 5;
      v_group := NULL;
    END IF;
  ELSE
    SELECT coalesce(max(flow_order), 0) + 10 INTO v_order FROM sector_settings;
    v_group := NULL;
  END IF;

  INSERT INTO sector_settings (sector, flow_order, parallel_group, enabled, daily_capacity_pairs)
  VALUES (v_nome, v_order, v_group, true, 600);

  IF p_hourly_rate > 0 THEN
    INSERT INTO sector_labor_rates (sector_key, hourly_rate, monthly_salary)
    VALUES (v_key, p_hourly_rate, round(p_hourly_rate * 220, 2))
    ON CONFLICT (sector_key) DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate;
  END IF;

  RETURN jsonb_build_object(
    'sector', v_nome, 'flow_order', v_order,
    'parallel_group', v_group, 'hourly_rate', p_hourly_rate);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_model_sector_capacity(
  p_sheet_id uuid,
  p_sector text,
  p_pairs_per_day numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_key          text;
  v_label        text;
  v_sheet        record;
  v_team         record;
  v_hc           numeric;
  v_journey      numeric;
  v_rate         numeric;
  v_min          numeric;
  v_target       record;
  v_manual_count integer;
  v_action       text;
BEGIN
  IF p_sheet_id IS NULL THEN
    RAISE EXCEPTION 'p_sheet_id obrigatório';
  END IF;
  IF p_pairs_per_day IS NULL OR p_pairs_per_day <= 0 OR p_pairs_per_day > 100000 THEN
    RAISE EXCEPTION 'Capacidade inválida: informe pares/dia maior que zero';
  END IF;

  v_key := public.capacity_sector_key(p_sector);
  v_label := public.capacity_sector_label(v_key);

  SELECT id, name, production_sectors INTO v_sheet
    FROM technical_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha % não encontrada', p_sheet_id;
  END IF;

  IF jsonb_typeof(v_sheet.production_sectors) = 'array'
     AND jsonb_array_length(v_sheet.production_sectors) > 0 THEN
    IF NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(v_sheet.production_sectors) s
          WHERE public.capacity_sector_key(s) = v_key) THEN
      RAISE EXCEPTION '% não é setor de produção da ficha % — se existe linha desse setor no BOM, é órfã (ver aba Operações / report de capacidade)',
        v_label, v_sheet.name;
    END IF;
  ELSIF NOT EXISTS (
       SELECT 1 FROM bom_operations bo
        WHERE bo.sheet_id = p_sheet_id
          AND public.capacity_sector_key(bo.stage) = v_key) THEN
    RAISE EXCEPTION '% não é setor de produção da ficha %', v_label, v_sheet.name;
  END IF;

  -- Equipe EFETIVA (ajuste manual > contagem do RH), a mesma que o motor usa.
  SELECT * INTO v_team FROM public.sector_effective_team(v_label);
  v_hc := v_team.valor;
  IF coalesce(v_hc, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe a equipe de % primeiro (painel Equipe) — converter pares/dia em min/par exige o número de pessoas do setor', v_label;
  END IF;

  SELECT journey_minutes INTO v_journey FROM capacity_parameters LIMIT 1;
  IF v_journey IS NULL THEN
    RAISE EXCEPTION 'capacity_parameters sem linha — aplicar migration 20260719120000';
  END IF;

  v_min := round(v_hc * v_journey / p_pairs_per_day, 4);
  IF v_min <= 0 THEN
    RAISE EXCEPTION 'Conversão deu 0 min/par — capacidade alta demais pra equipe informada';
  END IF;

  SELECT count(*) INTO v_manual_count FROM bom_operations
   WHERE sheet_id = p_sheet_id AND active
     AND time_source IN ('manual', 'cronoanalise')
     AND public.capacity_sector_key(stage) = v_key;
  IF v_manual_count > 1 THEN
    RAISE EXCEPTION '% tem % operações manuais/cronoanálise em % — edite os tempos na aba Operações da ficha',
      v_sheet.name, v_manual_count, v_label;
  END IF;

  SELECT r.hourly_rate INTO v_rate FROM public.sector_rh_hourly_rate(v_label) r;

  SELECT id INTO v_target FROM bom_operations
   WHERE sheet_id = p_sheet_id
     AND public.capacity_sector_key(stage) = v_key
   ORDER BY CASE WHEN time_source IN ('manual', 'cronoanalise') THEN 0 ELSE 1 END,
            created_at
   LIMIT 1;

  IF v_target.id IS NOT NULL THEN
    UPDATE bom_operations
       SET standard_time_minutes = v_min,
           time_source = 'manual',
           active = true,
           cost_per_hour = CASE WHEN coalesce(cost_per_hour, 0) > 0
                                THEN cost_per_hour ELSE coalesce(v_rate, 0) END,
           notes = format('capacidade_dia:%s pares (equipe %s × %s min)',
                          p_pairs_per_day, v_hc, v_journey),
           updated_at = now()
     WHERE id = v_target.id;
    DELETE FROM bom_operations
     WHERE sheet_id = p_sheet_id AND id <> v_target.id
       AND time_source IN ('capacidade', 'default', 'pendente')
       AND public.capacity_sector_key(stage) = v_key;
    v_action := 'updated';
  ELSE
    INSERT INTO bom_operations
      (sheet_id, operation_name, stage, standard_time_minutes, cost_per_hour,
       sort_order, active, notes, time_source)
    VALUES
      (p_sheet_id, v_label, v_label, v_min, coalesce(v_rate, 0),
       999, true,
       format('capacidade_dia:%s pares (equipe %s × %s min)',
              p_pairs_per_day, v_hc, v_journey),
       'manual');
    v_action := 'inserted';
  END IF;

  RETURN jsonb_build_object(
    'action',           v_action,
    'sector',           v_label,
    'pairs_per_day',    p_pairs_per_day,
    'headcount',        v_hc,
    'team_source',      v_team.origem,
    'journey_minutes',  v_journey,
    'minutes_per_pair', v_min,
    'hourly_rate',      coalesce(v_rate, 0),
    'mo_per_pair',      round(v_min * coalesce(v_rate, 0) / 60.0, 4)
  );
END;
$$;
