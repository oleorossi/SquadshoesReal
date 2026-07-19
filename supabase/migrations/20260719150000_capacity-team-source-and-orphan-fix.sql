-- =============================================================================
-- EQUIPE & CAPACIDADE — FONTE ÚNICA (specs/equipe-e-capacidade-fonte-unica.md)
-- ETAPA 0 — destravar: equipe derivada do RH, "não dimensionado" ≠ zero,
-- operação órfã somada, guard de drift funcional.
--
--   R2/R3  sector_rh_headcount()      — contagem viva de funcionários ativos
--   R4/R5/R6 sector_effective_team()  — override manual > RH > não informado
--   R7     get_model_productivity v4  — headcount ausente sai do gargalo em vez
--                                       de virar 0 (hoje zera 45 de 51 modelos)
--   R13    MO da engine soma operações ÓRFÃS (setor fora de production_sectors),
--          fechando o gap de R$ 0,2941/par do DS22 contra order_costs
--   R14    headcount_drift compara com o RH (team_size é NULL em 10/10 → inerte)
-- =============================================================================

-- 1) Contagem viva do RH (R2/R3) ----------------------------------------------
-- Conta funcionários ATIVOS cujo department casa com o setor pela mesma
-- normalização do resto do sistema. Exclui regime por par: eles produzem, mas o
-- custo sai por par na folha — contá-los na equipe duplicaria a MO (R3).
CREATE OR REPLACE FUNCTION public.sector_rh_headcount(p_sector text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT count(*)::integer
    FROM employees e
   WHERE e.active
     AND coalesce(e.payment_type, 'mensalista') <> 'producao'
     AND public.capacity_sector_key(e.department) = public.capacity_sector_key(p_sector)
$$;

-- 2) Equipe efetiva + origem (R4/R5/R6) ---------------------------------------
-- Precedência: ajuste manual (sector_settings.headcount) > contagem do RH >
-- não informado. NUNCA devolve 0 por ausência de funcionário — 0 só existe
-- quando o usuário digita 0 (setor parado). Origem é explícita, não inferida.
CREATE OR REPLACE FUNCTION public.sector_effective_team(p_sector text)
RETURNS TABLE (valor numeric, origem text, rh_count integer)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_override numeric;
  v_rh       integer;
BEGIN
  SELECT ss.headcount INTO v_override FROM sector_settings ss WHERE ss.sector = p_sector;
  v_rh := public.sector_rh_headcount(p_sector);

  IF v_override IS NOT NULL THEN
    -- Override igual à contagem do RH não polui a UI: exibe como 'rh'.
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

-- 3) Motor v4 (R7 + R13) ------------------------------------------------------
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
    v_mo := 0;
    v_mo_orfa := 0;
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
      SELECT r.key,
             public.capacity_sector_label(r.key) AS label,
             ss.flow_order
        FROM raw r
        LEFT JOIN sector_settings ss ON ss.sector = public.capacity_sector_label(r.key)
       ORDER BY coalesce(ss.flow_order, 999), r.first_ord
    LOOP
      v_minutes := NULL; v_mo_sector := NULL; v_time_sources := NULL;
      v_source := NULL; v_src_sheet := NULL; v_ref_sheet_id := NULL;
      v_pairs := NULL; v_measured := false;
      v_keys := v_keys || v_rec.key;

      -- Equipe efetiva do setor (R4/R5/R6)
      SELECT * INTO v_team FROM public.sector_effective_team(v_rec.label);

      -- Camada 1: valor específico do modelo no próprio BOM
      SELECT round(sum(bo.standard_time_minutes), 4),
             round(sum(bo.standard_time_minutes * bo.cost_per_hour) / 60.0, 4),
             array_agg(DISTINCT bo.time_source)
        INTO v_minutes, v_mo_sector, v_time_sources
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
          SELECT round(sum(bo.standard_time_minutes), 4),
                 round(sum(bo.standard_time_minutes * bo.cost_per_hour) / 60.0, 4),
                 array_agg(DISTINCT bo.time_source)
            INTO v_minutes, v_mo_sector, v_time_sources
            FROM bom_operations bo
           WHERE bo.sheet_id = v_ref_sheet_id AND bo.active
             AND bo.standard_time_minutes > 0
             AND bo.time_source IN ('manual', 'cronoanalise')
             AND public.capacity_sector_key(bo.stage) = v_rec.key;
          v_source := 'ultima_referencia';
          v_measured := true;
        ELSE
          SELECT round(sum(bo.standard_time_minutes), 4),
                 round(sum(bo.standard_time_minutes * bo.cost_per_hour) / 60.0, 4)
            INTO v_minutes, v_mo_sector
            FROM bom_operations bo
           WHERE bo.sheet_id = v_sheet.id AND bo.active AND bo.standard_time_minutes > 0
             AND bo.time_source = 'default'
             AND public.capacity_sector_key(bo.stage) = v_rec.key;
          IF coalesce(v_minutes, 0) > 0 THEN
            v_source := 'default';
            v_time_sources := ARRAY['default'];
          ELSE
            v_mo_sector := NULL;
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

      SELECT hourly_rate INTO v_rate FROM sector_labor_rates WHERE sector_key = v_rec.key;
      v_rate := coalesce(v_rate, 0);

      IF v_source IS NULL THEN
        v_warnings := v_warnings ||
          format('%s: sem tempo em nenhuma camada (BOM / última referência / padrão da categoria)', v_rec.label);
      ELSE
        IF v_source = 'default' THEN
          v_mo_sector := round(v_minutes * v_rate / 60.0, 4);
        END IF;
        IF v_rate = 0 AND coalesce(v_mo_sector, 0) = 0 THEN
          v_warnings := v_warnings ||
            format('%s: sem custo-hora em sector_labor_rates — MO do setor ficou R$ 0', v_rec.label);
        END IF;

        -- R7: equipe NÃO informada = "não dimensionado". O setor sai do gargalo
        -- em vez de zerar o modelo inteiro. Zero só quando digitado (setor parado).
        IF v_team.valor IS NULL THEN
          v_pairs := NULL;
          v_undim := v_undim || v_rec.label;
        ELSE
          -- R28: capacidade observada já embute a ineficiência real; só a
          -- capacidade TEÓRICA (tempo padrão) sofre o fator de eficiência.
          v_pairs := (v_team.valor * v_params.journey_minutes
                      * CASE WHEN v_measured THEN 1 ELSE (v_params.efficiency_pct / 100.0) END)
                     / v_minutes;
        END IF;

        v_mo := v_mo + coalesce(v_mo_sector, 0);
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
        'nao_dimensionado',  (v_source IS NOT NULL AND v_team.valor IS NULL),
        'capacidade_medida', v_measured,
        'hourly_rate',       v_rate,
        'pairs_per_day',     CASE WHEN v_pairs IS NULL THEN NULL ELSE floor(v_pairs) END,
        'mo_per_pair',       CASE WHEN v_source IS NULL THEN NULL ELSE round(coalesce(v_mo_sector, 0), 4) END,
        'is_bottleneck',     false
      );
    END LOOP;

    -- R13: operações ATIVAS cujo setor ficou fora dos iterados (órfãs) entram na
    -- MO — calculate_order_cost_item soma TODAS as operações da ficha, então sem
    -- isto a engine subestima o custo (DS22: R$ 1,75 × R$ 2,05 no custeio).
    SELECT round(coalesce(sum(bo.standard_time_minutes * bo.cost_per_hour) / 60.0, 0), 4)
      INTO v_mo_orfa
      FROM bom_operations bo
     WHERE bo.sheet_id = v_sheet.id AND bo.active AND bo.standard_time_minutes > 0
       AND NOT (public.capacity_sector_key(bo.stage) = ANY (v_keys));

    IF coalesce(v_mo_orfa, 0) > 0 THEN
      v_mo := v_mo + v_mo_orfa;
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
      'partial',            (array_length(v_undim, 1) > 0),
      'undimensioned',      to_jsonb(v_undim),
      'warnings',           to_jsonb(v_warnings),
      'sectors',            v_sectors,
      'bottleneck_sector',  CASE WHEN v_bottleneck IS NULL THEN NULL
                                 ELSE public.capacity_sector_label(v_bottleneck) END,
      'pairs_per_day',      v_pairs_model,
      'productivity_index', NULL,
      'costs', jsonb_build_object(
        'mo_per_pair',              CASE WHEN v_min_pairs IS NULL THEN NULL ELSE round(v_mo, 2) END,
        'mo_orphan_per_pair',       round(coalesce(v_mo_orfa, 0), 4),
        'overhead_per_pair',        CASE WHEN v_overhead_pp IS NULL THEN NULL ELSE round(v_overhead_pp, 2) END,
        'total_cost_minute_method', CASE WHEN v_min_pairs IS NULL THEN NULL
                                         ELSE round(v_mo + coalesce(v_overhead_pp, 0), 2) END,
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

-- 4) Guard de drift funcional (R14) -------------------------------------------
-- Antes comparava com team_size (NULL em 10/10 → nunca disparava). Agora compara
-- o ajuste manual em uso com a contagem viva do RH.
CREATE OR REPLACE FUNCTION public.capacity_consistency_report()
RETURNS TABLE (categoria text, severidade text, referencia text, detalhe text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT 'tempo_faltando', 'alta', ts.name,
         format('Setor %s sem tempo: sem BOM ativo, sem valor manual/cronoanálise em outra referência e sem padrão da categoria %L',
                trim(s.sector_name), coalesce(ts.shoe_category, '(vazia)'))
    FROM technical_sheets ts
   CROSS JOIN LATERAL (
     SELECT trim(x) AS sector_name
       FROM jsonb_array_elements_text(ts.production_sectors) x
      WHERE jsonb_typeof(ts.production_sectors) = 'array'
   ) s
   WHERE ts.status = 'Ativo'
     AND NOT EXISTS (
       SELECT 1 FROM bom_operations bo
        WHERE bo.sheet_id = ts.id AND bo.active AND bo.standard_time_minutes > 0
          AND public.capacity_sector_key(bo.stage) = public.capacity_sector_key(s.sector_name))
     AND NOT EXISTS (
       SELECT 1 FROM bom_operations bo
        WHERE bo.sheet_id <> ts.id AND bo.active AND bo.standard_time_minutes > 0
          AND bo.time_source IN ('manual', 'cronoanalise')
          AND public.capacity_sector_key(bo.stage) = public.capacity_sector_key(s.sector_name))
     AND NOT EXISTS (
       SELECT 1 FROM sector_minutes_default smd
        WHERE smd.shoe_category = coalesce(ts.shoe_category, '')
          AND public.capacity_sector_key(smd.sector) = public.capacity_sector_key(s.sector_name)
          AND smd.minutes_per_pair > 0)

  UNION ALL
  SELECT 'operacao_pendente', 'media', ts.name,
         format('Operação %L (stage %s) com time_source=pendente — MO R$ 0 no custeio',
                bo.operation_name, bo.stage)
    FROM bom_operations bo JOIN technical_sheets ts ON ts.id = bo.sheet_id
   WHERE bo.time_source = 'pendente'

  UNION ALL
  -- R7: severidade cai pra media — setor sem equipe não zera mais o modelo,
  -- mas continua fora do cálculo até ser informado.
  SELECT 'setor_sem_equipe', 'media', ss.sector,
         format('Sem equipe informada (RH tem %s funcionário(s) mapeado(s)) — setor fica fora do cálculo de capacidade',
                public.sector_rh_headcount(ss.sector))
    FROM sector_settings ss
   WHERE ss.enabled AND (SELECT valor FROM public.sector_effective_team(ss.sector)) IS NULL

  UNION ALL
  SELECT 'divergencia_capacidade', 'media', ts.name,
         format('%s: ficha diz %s pares/dia; minutos do BOM × equipe dão %s — conferir qual está certo',
                ss.sector, d.ficha_cap, d.engine_pairs)
    FROM technical_sheets ts
   CROSS JOIN sector_settings ss
   CROSS JOIN LATERAL (
     SELECT CASE ss.ficha_capacity_column
              WHEN 'sewing_capacity_per_day'     THEN ts.sewing_capacity_per_day
              WHEN 'cutting_capacity_per_day'    THEN ts.cutting_capacity_per_day
              WHEN 'costura_capacity_per_day'    THEN ts.costura_capacity_per_day
              WHEN 'mesa_daily_capacity'         THEN ts.mesa_daily_capacity
              WHEN 'silk_capacity_per_day'       THEN ts.silk_capacity_per_day
              WHEN 'gluing_capacity_per_day'     THEN ts.gluing_capacity_per_day
              WHEN 'assembly_capacity_per_day'   THEN ts.assembly_capacity_per_day
              WHEN 'soling_capacity_per_day'     THEN ts.soling_capacity_per_day
              WHEN 'finishing_capacity_per_day'  THEN ts.finishing_capacity_per_day
              WHEN 'expedition_capacity_per_day' THEN ts.expedition_capacity_per_day
            END AS ficha_cap,
            (SELECT floor(coalesce((SELECT valor FROM public.sector_effective_team(ss.sector)), 0)
                    * (SELECT journey_minutes * efficiency_pct / 100.0 FROM capacity_parameters LIMIT 1)
                    / nullif(sum(bo.standard_time_minutes), 0))
               FROM bom_operations bo
              WHERE bo.sheet_id = ts.id AND bo.active AND bo.standard_time_minutes > 0
                AND public.capacity_sector_key(bo.stage) = public.capacity_sector_key(ss.sector)
            ) AS engine_pairs
   ) d
   WHERE ts.status = 'Ativo'
     AND coalesce(d.ficha_cap, 0) > 0
     AND d.engine_pairs IS NOT NULL AND d.engine_pairs > 0
     AND (d.engine_pairs > d.ficha_cap * 1.2 OR d.engine_pairs < d.ficha_cap * 0.8)

  UNION ALL
  SELECT 'taxa_orfa', 'info', slr.sector_key,
         format('sector_labor_rates tem R$ %s/h mas nenhuma bom_operation usa esse setor',
                slr.hourly_rate)
    FROM sector_labor_rates slr
   WHERE NOT EXISTS (
     SELECT 1 FROM bom_operations bo
      WHERE public.capacity_sector_key(bo.stage) = slr.sector_key)

  UNION ALL
  SELECT 'operacao_orfa', 'media', ts.name,
         format('Operação %L ativa no stage %s mas o setor saiu de production_sectors — entra no custeio e na MO da engine, porém fora da capacidade',
                bo.operation_name, bo.stage)
    FROM bom_operations bo JOIN technical_sheets ts ON ts.id = bo.sheet_id
   WHERE bo.active AND bo.standard_time_minutes > 0
     AND jsonb_typeof(ts.production_sectors) = 'array'
     AND jsonb_array_length(ts.production_sectors) > 0
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(ts.production_sectors) s
        WHERE public.capacity_sector_key(s) = public.capacity_sector_key(bo.stage))

  UNION ALL
  -- R14: drift entre o ajuste manual em uso e a contagem viva do RH.
  SELECT 'headcount_drift', 'media', ss.sector,
         format('Ajuste manual usa %s pessoa(s), mas o RH tem %s funcionário(s) ativo(s) neste setor — conferir qual está certo',
                ss.headcount, public.sector_rh_headcount(ss.sector))
    FROM sector_settings ss
   WHERE ss.headcount IS NOT NULL
     AND public.sector_rh_headcount(ss.sector) > 0
     AND ss.headcount <> public.sector_rh_headcount(ss.sector)

  UNION ALL
  -- Funcionário ativo cujo setor não casa com nenhum setor canônico (R8).
  SELECT 'funcionario_sem_setor', 'media', e.name,
         format('Setor %L não corresponde a nenhum setor de produção — não entra em nenhuma contagem de equipe',
                coalesce(nullif(trim(e.department), ''), '(em branco)'))
    FROM employees e
   WHERE e.active
     AND NOT EXISTS (
       SELECT 1 FROM sector_settings ss
        WHERE public.capacity_sector_key(ss.sector) = public.capacity_sector_key(e.department))
     AND public.capacity_sector_key(e.department) NOT IN ('administrativo', 'comercial', 'terceirizado')

  UNION ALL
  SELECT 'default_incompleto', 'media', coalesce(nullif(ts.shoe_category, ''), '(vazia)'),
         format('%s ficha(s) ativas desta categoria e sector_minutes_default cobre só %s setor(es)',
                count(DISTINCT ts.id),
                (SELECT count(*) FROM sector_minutes_default smd
                  WHERE smd.shoe_category = coalesce(ts.shoe_category, '')))
    FROM technical_sheets ts
   WHERE ts.status = 'Ativo'
     AND (SELECT count(*) FROM sector_minutes_default smd
           WHERE smd.shoe_category = coalesce(ts.shoe_category, '')) < 10
   GROUP BY ts.shoe_category
$$;

REVOKE ALL ON FUNCTION public.sector_rh_headcount(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sector_effective_team(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sector_rh_headcount(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sector_effective_team(text) TO authenticated, service_role;
