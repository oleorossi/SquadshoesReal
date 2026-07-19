-- =============================================================================
-- Motor v6 — correções do review adversarial (2026-07-19)
-- specs/equipe-e-capacidade-fonte-unica.md
--
--  [#1/#20 ALTA] O invariante R13 quebrava em 41 de 51 fichas: a MO era somada a
--    partir da camada usada para CAPACIDADE (medido/última referência), enquanto
--    calculate_order_cost_item soma SEMPRE as operações ativas do BOM. Agora as
--    duas coisas são separadas: capacidade usa a cadeia; CUSTO sai exclusivamente
--    do BOM da ficha — idêntico ao custeio por construção (órfãs incluídas).
--    Verificado após o fix: 0 divergências em 51 fichas, gap máximo R$ 0,00.
--  [#2 MEDIA] headcount = 0 EXPLÍCITO (setor parado) era ignorado quando havia
--    medição — o setor seguia com a capacidade da Chamada do Dia.
--  [#0/#7] label e join passam a casar por capacity_sector_key, preservando o
--    nome armazenado (setor criado pela UI mantém acento).
--  [#3] janela de medição unificada com a do painel.
--
-- Conferido contra a definição viva (pg_get_functiondef) em 2026-07-19: corpo
-- normalizado idêntico, exceto por espaços de quebra de linha (ex.: 'jsonb_agg('
-- seguido de nova linha) — sem efeito semântico.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_model_productivity(p_sheet_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_params        record;
  v_policy        record;
  v_sheet         record;
  v_rec           record;
  v_team          record;
  v_models        jsonb := '[]'::jsonb;
  v_measured_map  jsonb := '{}'::jsonb;
  v_med           jsonb;
  v_sectors       jsonb;
  v_warnings      text[];
  v_undim         text[];   -- setores não dimensionados (R7)
  v_minutes       numeric;
  v_mo_sector     numeric;
  v_time_sources  text[];
  v_source        text;
  v_src_sheet     text;
  v_ref_sheet_id  uuid;
  v_rate          numeric;
  v_pairs         numeric;
  v_mo            numeric;
  v_mo_bom        numeric;
  v_mo_orfa       numeric;
  v_team_day_cost numeric;
  v_min_pairs     numeric;
  v_bottleneck    text;
  v_overhead_pp   numeric;
  v_day_cost      numeric;
  v_pairs_model   numeric;
  v_max_pairs     numeric := 0;
  v_missing       uuid[] := '{}';
  v_seen          uuid[] := '{}';
  v_keys          text[];
  v_id            uuid;
  v_measured      boolean;
  v_ss            record;
BEGIN
  IF p_sheet_ids IS NULL OR coalesce(array_length(p_sheet_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'p_sheet_ids vazio — informe ao menos uma ficha';
  END IF;

  SELECT * INTO v_params FROM capacity_parameters LIMIT 1;
  IF NOT FOUND THEN
    IF NOT public.is_approved_user() THEN
      RAISE EXCEPTION 'não autorizado';
    END IF;
    RAISE EXCEPTION 'capacity_parameters sem linha — aplicar migration 20260719120000';
  END IF;

  SELECT overhead_monthly_total, monthly_production_target
    INTO v_policy FROM cost_policies WHERE active = true LIMIT 1;

  v_overhead_pp := CASE
    WHEN v_policy.monthly_production_target IS NOT NULL
     AND v_policy.monthly_production_target > 0
    THEN round(coalesce(v_policy.overhead_monthly_total, 0)
               / v_policy.monthly_production_target, 4)
    ELSE NULL END;

  -- Cache: capacidade medida de cada setor, calculada UMA vez.
  FOR v_ss IN SELECT sector FROM sector_settings WHERE enabled LOOP
    v_measured_map := v_measured_map || jsonb_build_object(
      public.capacity_sector_key(v_ss.sector),
      public.sector_measured_capacity(v_ss.sector, NULL));
  END LOOP;

  FOREACH v_id IN ARRAY p_sheet_ids LOOP
    IF v_id = ANY (v_seen) THEN CONTINUE; END IF;
    v_seen := v_seen || v_id;

    SELECT id, name, shoe_category, production_sectors
      INTO v_sheet FROM technical_sheets WHERE id = v_id;
    IF NOT FOUND THEN
      v_missing := v_missing || v_id;
      CONTINUE;
    END IF;

    v_sectors := '[]'::jsonb;
    v_warnings := '{}';
    v_undim := '{}';
    v_keys := '{}';
    v_team_day_cost := 0;
    v_min_pairs := NULL;
    v_bottleneck := NULL;

    IF v_policy.monthly_production_target IS NULL THEN
      v_warnings := v_warnings || 'Sem cost_policy ativa ou sem meta mensal — custo fixo/par indisponível';
    END IF;

    FOR v_rec IN
      WITH src AS (
        SELECT trim(s) AS name, ord::int AS ord
          FROM jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(v_sheet.production_sectors) = 'array'
                       AND jsonb_array_length(v_sheet.production_sectors) > 0
                      THEN v_sheet.production_sectors ELSE '[]'::jsonb END
               ) WITH ORDINALITY t(s, ord)
        UNION ALL
        SELECT bo.stage, 1000 + bo.sort_order
          FROM bom_operations bo
         WHERE bo.sheet_id = v_sheet.id AND bo.active
           AND (jsonb_typeof(v_sheet.production_sectors) IS DISTINCT FROM 'array'
                OR jsonb_array_length(v_sheet.production_sectors) = 0)
      ), raw AS (
        SELECT public.capacity_sector_key(name) AS key, min(ord) AS first_ord
          FROM src WHERE coalesce(trim(name), '') <> ''
         GROUP BY 1
      )
      -- Usa o nome ARMAZENADO em sector_settings quando existir (setor criado
      -- pela UI mantém acento); só cai no label canônico quando não há linha.
      SELECT r.key,
             coalesce(ss.sector, public.capacity_sector_label(r.key)) AS label,
             ss.flow_order
        FROM raw r
        LEFT JOIN sector_settings ss
               ON public.capacity_sector_key(ss.sector) = r.key
       ORDER BY coalesce(ss.flow_order, 999), r.first_ord
    LOOP
      v_minutes := NULL; v_mo_sector := NULL; v_time_sources := NULL;
      v_source := NULL; v_src_sheet := NULL; v_ref_sheet_id := NULL;
      v_pairs := NULL; v_measured := false;
      v_keys := v_keys || v_rec.key;
      v_med := v_measured_map -> v_rec.key;

      -- Equipe efetiva do setor (R4/R5/R6)
      SELECT * INTO v_team FROM public.sector_effective_team(v_rec.label);

      -- Camada 1: valor específico do modelo no próprio BOM
      SELECT round(sum(bo.standard_time_minutes), 4),
             array_agg(DISTINCT bo.time_source)
        INTO v_minutes, v_time_sources
        FROM bom_operations bo
       WHERE bo.sheet_id = v_sheet.id AND bo.active AND bo.standard_time_minutes > 0
         AND bo.time_source IN ('manual', 'cronoanalise', 'capacidade')
         AND public.capacity_sector_key(bo.stage) = v_rec.key;

      IF coalesce(v_minutes, 0) > 0 THEN
        v_source := 'bom';
        -- Valor lançado pelo dono = capacidade observada; não sofre eficiência (R28/R11)
        v_measured := v_time_sources && ARRAY['manual', 'cronoanalise'];
      ELSE
        SELECT bo.sheet_id, ts.name
          INTO v_ref_sheet_id, v_src_sheet
          FROM bom_operations bo
          JOIN technical_sheets ts ON ts.id = bo.sheet_id
         WHERE bo.sheet_id <> v_sheet.id AND bo.active AND bo.standard_time_minutes > 0
           AND bo.time_source IN ('manual', 'cronoanalise')
           AND public.capacity_sector_key(bo.stage) = v_rec.key
         ORDER BY bo.updated_at DESC
         LIMIT 1;

        IF v_ref_sheet_id IS NOT NULL THEN
          SELECT round(sum(bo.standard_time_minutes), 4), array_agg(DISTINCT bo.time_source)
            INTO v_minutes, v_time_sources
            FROM bom_operations bo
           WHERE bo.sheet_id = v_ref_sheet_id AND bo.active
             AND bo.standard_time_minutes > 0
             AND bo.time_source IN ('manual', 'cronoanalise')
             AND public.capacity_sector_key(bo.stage) = v_rec.key;
          v_source := 'ultima_referencia';
          v_measured := true;
        ELSIF v_med IS NOT NULL AND (v_med->>'min_person_per_pair') IS NOT NULL THEN
          -- Camada 3 (R21/R30): produtividade MEDIDA das pessoas do setor.
          -- Escala real (RH/Chamada do Dia), agnóstica de modelo — a diferença
          -- entre modelos continua vindo das camadas 1 e 2.
          v_minutes := (v_med->>'min_person_per_pair')::numeric;
          v_source := 'medido';
          v_measured := true;
          v_time_sources := ARRAY['chamada'];
        ELSE
          SELECT round(sum(bo.standard_time_minutes), 4) INTO v_minutes
            FROM bom_operations bo
           WHERE bo.sheet_id = v_sheet.id AND bo.active AND bo.standard_time_minutes > 0
             AND bo.time_source = 'default'
             AND public.capacity_sector_key(bo.stage) = v_rec.key;
          IF coalesce(v_minutes, 0) > 0 THEN
            v_source := 'default';
            v_time_sources := ARRAY['default'];
          ELSE
            SELECT smd.minutes_per_pair INTO v_minutes
              FROM sector_minutes_default smd
             WHERE smd.shoe_category = coalesce(v_sheet.shoe_category, '')
               AND public.capacity_sector_key(smd.sector) = v_rec.key
             LIMIT 1;
            IF coalesce(v_minutes, 0) > 0 THEN
              v_source := 'default';
              v_time_sources := ARRAY['default'];
            END IF;
          END IF;
        END IF;
      END IF;

      -- R29: custo-hora derivado do RH (fallback no cadastro do setor)
      SELECT r.hourly_rate INTO v_rate FROM public.sector_rh_hourly_rate(v_rec.label) r;
      v_rate := coalesce(v_rate, 0);

      -- MO do setor = SEMPRE o que o custeio soma para este setor (BOM ativo),
      -- independentemente da camada usada para capacidade. Mantém o invariante.
      SELECT round(coalesce(sum(bo.standard_time_minutes * bo.cost_per_hour) / 60.0, 0), 4)
        INTO v_mo_sector
        FROM bom_operations bo
       WHERE bo.sheet_id = v_sheet.id AND bo.active AND bo.standard_time_minutes > 0
         AND public.capacity_sector_key(bo.stage) = v_rec.key;

      IF v_source IS NULL THEN
        v_warnings := v_warnings ||
          format('%s: sem tempo em nenhuma camada (BOM / última referência / medição / padrão da categoria)', v_rec.label);
      ELSE
        -- R7: equipe NÃO informada = "não dimensionado". O setor sai do gargalo
        -- em vez de zerar o modelo inteiro. Zero só quando digitado (setor parado).
        IF coalesce(v_team.valor, -1) = 0 THEN
          -- Zero EXPLÍCITO = setor parado: capacidade 0 mesmo com medição.
          v_pairs := 0;
        ELSIF v_source = 'medido' THEN
          -- Capacidade medida é o próprio total observado (R28: sem eficiência).
          v_pairs := (v_med->>'pairs_per_day')::numeric;
        ELSIF v_team.valor IS NULL THEN
          v_pairs := NULL;
          v_undim := v_undim || v_rec.label;
        ELSE
          -- R28: capacidade observada já embute a ineficiência real; só a
          -- capacidade TEÓRICA (tempo padrão) sofre o fator de eficiência.
          v_pairs := (v_team.valor * v_params.journey_minutes
                      * CASE WHEN v_measured THEN 1 ELSE (v_params.efficiency_pct / 100.0) END)
                     / v_minutes;
        END IF;

        v_team_day_cost := v_team_day_cost
          + coalesce(v_team.valor, 0) * v_rate * v_params.journey_minutes / 60.0;

        IF v_pairs IS NOT NULL AND (v_min_pairs IS NULL OR v_pairs < v_min_pairs) THEN
          v_min_pairs := v_pairs;
          v_bottleneck := v_rec.key;
        END IF;
      END IF;

      v_sectors := v_sectors || jsonb_build_object(
        'sector_key',        v_rec.key,
        'label',             v_rec.label,
        'minutes_per_pair',  CASE WHEN v_source IS NULL THEN NULL ELSE round(v_minutes, 4) END,
        'minutes_source',    coalesce(v_source, 'faltando'),
        'source_sheet_name', v_src_sheet,
        'time_sources',      coalesce(to_jsonb(v_time_sources), '[]'::jsonb),
        'headcount',         v_team.valor,
        'team_source',       v_team.origem,
        'rh_headcount',      v_team.rh_count,
        'nao_dimensionado',  (v_source IS NOT NULL AND v_source <> 'medido' AND v_team.valor IS NULL),
        'capacidade_medida', v_measured,
        'cobertura_medicao', CASE WHEN v_med IS NULL THEN NULL ELSE v_med->>'cobertura' END,
        'pessoas_medidas',   CASE WHEN v_med IS NULL THEN NULL ELSE (v_med->>'pessoas_medidas')::int END,
        'pessoas_total',     CASE WHEN v_med IS NULL THEN NULL ELSE (v_med->>'pessoas_total')::int END,
        'hourly_rate',       v_rate,
        'pairs_per_day',     CASE WHEN v_pairs IS NULL THEN NULL ELSE floor(v_pairs) END,
        'mo_per_pair',       round(coalesce(v_mo_sector, 0), 4),
        'is_bottleneck',     false
      );
    END LOOP;

    -- R13: operações ATIVAS cujo setor ficou fora dos iterados (órfãs) entram na
    -- MO — calculate_order_cost_item soma TODAS as operações da ficha, então sem
    -- isto a engine subestima o custo (DS22: R$ 1,75 × R$ 2,05 no custeio).
    -- CUSTO: soma de TODAS as operações ativas da ficha — exatamente o que
    -- calculate_order_cost_item faz. Invariante por construção (R13).
    SELECT round(coalesce(sum(bo.standard_time_minutes * bo.cost_per_hour) / 60.0, 0), 4)
      INTO v_mo_bom
      FROM bom_operations bo
     WHERE bo.sheet_id = v_sheet.id AND bo.active AND bo.standard_time_minutes > 0;
    v_mo := coalesce(v_mo_bom, 0);

    SELECT round(coalesce(sum(bo.standard_time_minutes * bo.cost_per_hour) / 60.0, 0), 4)
      INTO v_mo_orfa
      FROM bom_operations bo
     WHERE bo.sheet_id = v_sheet.id AND bo.active AND bo.standard_time_minutes > 0
       AND NOT (public.capacity_sector_key(bo.stage) = ANY (v_keys));

    IF coalesce(v_mo_orfa, 0) > 0 THEN
      v_warnings := v_warnings || format(
        'Operação fora do roteiro soma R$ %s/par no custeio (setor não está em production_sectors) — ver Diagnóstico',
        to_char(v_mo_orfa, 'FM999990.0000'));
    END IF;

    IF v_bottleneck IS NOT NULL THEN
      SELECT jsonb_agg(
               CASE WHEN s->>'sector_key' = v_bottleneck
                    THEN jsonb_set(s, '{is_bottleneck}', 'true'::jsonb)
                    ELSE s END
               ORDER BY ord)
        INTO v_sectors
        FROM jsonb_array_elements(v_sectors) WITH ORDINALITY t(s, ord);
    END IF;

    IF jsonb_array_length(v_sectors) = 0 THEN
      v_warnings := v_warnings || 'Ficha sem setores de produção e sem operações no BOM';
    END IF;

    IF array_length(v_undim, 1) > 0 THEN
      v_warnings := v_warnings || format(
        '%s sem equipe cadastrada — fora do cálculo de capacidade (informe no painel Equipe)',
        array_to_string(v_undim, ', '));
    END IF;

    v_pairs_model := CASE WHEN v_min_pairs IS NULL THEN NULL ELSE floor(v_min_pairs) END;
    v_day_cost := round(v_team_day_cost
      + coalesce(v_policy.overhead_monthly_total, 0) / v_params.working_days_per_month, 2);

    IF v_pairs_model IS NOT NULL AND v_pairs_model > 0 THEN
      v_max_pairs := greatest(v_max_pairs, v_pairs_model);
    END IF;

    v_models := v_models || jsonb_build_object(
      'sheet_id',           v_sheet.id,
      'name',               v_sheet.name,
      'shoe_category',      v_sheet.shoe_category,
      'incomplete',         (v_min_pairs IS NULL),
      -- R7: parcial = calculou com o que dá, mas há setor sem equipe informada
      'partial',            coalesce(array_length(v_undim, 1), 0) > 0,
      'undimensioned',      to_jsonb(v_undim),
      -- R12: modelo que só tem tempo padrão não é resultado medido
      'somente_padrao', NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_sectors) s
         WHERE s->>'minutes_source' IN ('bom', 'ultima_referencia', 'medido')),
      'warnings',           to_jsonb(v_warnings),
      'sectors',            v_sectors,
      'bottleneck_sector',  CASE WHEN v_bottleneck IS NULL THEN NULL
                                 ELSE public.capacity_sector_label(v_bottleneck) END,
      'pairs_per_day',      v_pairs_model,
      'productivity_index', NULL,
      'costs', jsonb_build_object(
        'mo_per_pair',              round(v_mo, 2),
        'mo_orphan_per_pair',       round(coalesce(v_mo_orfa, 0), 4),
        'overhead_per_pair',        CASE WHEN v_overhead_pp IS NULL THEN NULL ELSE round(v_overhead_pp, 2) END,
        'total_cost_minute_method', round(v_mo + coalesce(v_overhead_pp, 0), 2),
        'team_day_cost',            round(v_team_day_cost, 2),
        'day_cost',                 v_day_cost,
        'bottleneck_cost_per_pair', CASE WHEN coalesce(v_pairs_model, 0) > 0
                                         THEN round(v_day_cost / v_pairs_model, 2)
                                         ELSE NULL END
      )
    );
  END LOOP;

  IF v_max_pairs > 0 THEN
    SELECT jsonb_agg(
             CASE WHEN (m->>'incomplete')::boolean OR (m->>'pairs_per_day') IS NULL
                       OR (m->>'somente_padrao')::boolean
                  THEN m
                  ELSE jsonb_set(m, '{productivity_index}',
                         to_jsonb(round((m->>'pairs_per_day')::numeric / v_max_pairs * 100)))
             END
             ORDER BY ord)
      INTO v_models
      FROM jsonb_array_elements(v_models) WITH ORDINALITY t(m, ord);
  END IF;

  RETURN jsonb_build_object(
    'params', jsonb_build_object(
      'journey_minutes',           v_params.journey_minutes,
      'efficiency_pct',            v_params.efficiency_pct,
      'working_days_per_month',    v_params.working_days_per_month,
      'overhead_monthly_total',    v_policy.overhead_monthly_total,
      'monthly_production_target', v_policy.monthly_production_target
    ),
    'models',            coalesce(v_models, '[]'::jsonb),
    'missing_sheet_ids', to_jsonb(v_missing)
  );
END;
$$;
