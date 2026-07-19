-- =============================================================================
-- ENGINE DE CAPACIDADE & PRODUTIVIDADE POR MODELO (specs/produtividade-por-modelo.md)
-- PARTE 2/3: motor de cálculo.
--
--   • capacity_sector_key(text)   — normalização stage/display → key canônica,
--     MESMA regra do generate_bom_operations (translate + aviamento→mesa).
--   • capacity_sector_label(text) — key → nome de exibição (= sector_settings.sector).
--   • get_model_productivity(uuid[]) — por ficha: minutos por setor (cadeia
--     BOM próprio > última referência preenchida pelo dono > padrão da categoria),
--     pares/dia, gargalo, índice e custo/par pelos métodos custo-minuto e gargalo.
--   • capacity_consistency_report() — gaps de cadastro (exposta em /diagnostics).
--
-- CONCEITO (anti-drift): esta engine responde THROUGHPUT em regime permanente
-- (pares/dia sustentados pela equipe). As ondas/production engine respondem
-- LEAD TIME/agenda. O gargalo daqui (min de capacidade por minutos×headcount)
-- pode legitimamente diferir da severidade de v_sector_bottlenecks (carga de
-- pedidos ÷ *_capacity_per_day). Nenhuma coluna *_capacity_per_day é lida ou
-- escrita aqui — divergências são EXPOSTAS no report, não escondidas.
-- =============================================================================

-- 0) Normalização de setor (espelho SQL de src/lib/sectors.ts) -----------------
CREATE OR REPLACE FUNCTION public.capacity_sector_key(p_sector text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE k
    WHEN 'corte'      THEN 'corte_palmilha'
    WHEN 'palmilha'   THEN 'corte_palmilha'
    WHEN 'forracao'   THEN 'corte_forracao'
    WHEN 'aviamento'  THEN 'mesa'
    WHEN 'serigrafia' THEN 'silk'
    ELSE k END
  FROM (SELECT lower(translate(replace(trim(coalesce(p_sector, '')), ' ', '_'),
    'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ', 'aaaaeeiooouucAAAAEEIOOOUUC'))) t(k)
$$;

CREATE OR REPLACE FUNCTION public.capacity_sector_label(p_key text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_key
    WHEN 'corte_palmilha' THEN 'Corte Palmilha'
    WHEN 'corte_forracao' THEN 'Corte Forração'
    WHEN 'mesa'           THEN 'Aviamento'
    WHEN 'costura'        THEN 'Costura'
    WHEN 'silk'           THEN 'Silk'
    WHEN 'colagem'        THEN 'Colagem'
    WHEN 'montagem'       THEN 'Montagem'
    WHEN 'solagem'        THEN 'Solagem'
    WHEN 'acabamento'     THEN 'Acabamento'
    WHEN 'expedicao'      THEN 'Expedição'
    ELSE initcap(coalesce(p_key, ''))
  END
$$;

-- 1) Motor --------------------------------------------------------------------
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
  v_models        jsonb := '[]'::jsonb;
  v_sectors       jsonb;
  v_warnings      text[];
  v_minutes       numeric;
  v_mo_sector     numeric;
  v_time_sources  text[];
  v_source        text;
  v_src_sheet     text;
  v_ref_sheet_id  uuid;
  v_rate          numeric;
  v_pairs         numeric;
  v_mo            numeric;
  v_team_day_cost numeric;
  v_min_pairs     numeric;
  v_bottleneck    text;   -- key do setor gargalo
  v_overhead_pp   numeric;
  v_day_cost      numeric;
  v_pairs_model   numeric;
  v_max_pairs     numeric := 0;
  v_missing       uuid[] := '{}';
  v_seen          uuid[] := '{}';
  v_id            uuid;
BEGIN
  IF p_sheet_ids IS NULL OR coalesce(array_length(p_sheet_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'p_sheet_ids vazio — informe ao menos uma ficha';
  END IF;

  SELECT * INTO v_params FROM capacity_parameters LIMIT 1;
  IF NOT FOUND THEN
    -- SECURITY INVOKER + RLS: usuário authenticated mas não-aprovado vê 0 linhas
    -- aqui — sem este check ele receberia um erro enganoso de "migration faltando".
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
    v_mo := 0;
    v_team_day_cost := 0;
    v_min_pairs := NULL;
    v_bottleneck := NULL;

    IF v_policy.monthly_production_target IS NULL THEN
      v_warnings := v_warnings || 'Sem cost_policy ativa ou sem meta mensal — custo fixo/par indisponível';
    END IF;

    -- Setores da ficha (production_sectors); fallback: stages do próprio BOM.
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
             ss.headcount,
             ss.flow_order
        FROM raw r
        LEFT JOIN sector_settings ss ON ss.sector = public.capacity_sector_label(r.key)
       ORDER BY coalesce(ss.flow_order, 999), r.first_ord
    LOOP
      v_minutes := NULL; v_mo_sector := NULL; v_time_sources := NULL;
      v_source := NULL; v_src_sheet := NULL; v_ref_sheet_id := NULL;
      v_pairs := NULL;

      -- Camada 1: BOM da própria ficha com valor ESPECÍFICO do modelo
      -- (manual/cronoanálise = preenchido pelo dono; capacidade = derivado da
      -- capacidade da própria ficha). Linhas 'default' NÃO entram aqui — são o
      -- padrão genérico da categoria materializado, e o aditivo da aprovação
      -- manda o último valor preenchido em OUTRA referência vencer o genérico.
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
      ELSE
        -- Camada 2: último valor PREENCHIDO PELO DONO em outra referência
        -- (aditivo da aprovação — manual/cronoanálise mais recente por setor).
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
        ELSE
          -- Camada 3: padrão da categoria — primeiro a linha 'default' já
          -- materializada no próprio BOM (tem cost_per_hour semeado), senão o
          -- lookup direto em sector_minutes_default (mesmo join do generator).
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

      -- Custo-hora do setor (key 'mesa' = Aviamento, mesma regra do generator).
      SELECT hourly_rate INTO v_rate FROM sector_labor_rates
       WHERE sector_key = v_rec.key;
      v_rate := coalesce(v_rate, 0);

      IF v_source IS NULL THEN
        v_warnings := v_warnings ||
          format('%s: sem tempo em nenhuma camada (BOM / última referência / padrão da categoria)', v_rec.label);
      ELSE
        -- O override do source='default' vem ANTES do check de custo-hora: o
        -- warning tem que avaliar o valor FINAL da MO, senão a linha 'default'
        -- do BOM (cost_per_hour semeado) mascara taxa removida e a MO zera em
        -- silêncio (achado do review 2026-07-19).
        IF v_source = 'default' THEN
          v_mo_sector := round(v_minutes * v_rate / 60.0, 4);
        END IF;
        IF v_rate = 0 AND coalesce(v_mo_sector, 0) = 0 THEN
          v_warnings := v_warnings ||
            format('%s: sem custo-hora em sector_labor_rates — MO do setor ficou R$ 0', v_rec.label);
        END IF;

        IF coalesce(v_rec.headcount, 0) > 0 THEN
          v_pairs := (v_rec.headcount * v_params.journey_minutes
                      * (v_params.efficiency_pct / 100.0)) / v_minutes;
        ELSE
          v_pairs := 0;
          v_warnings := v_warnings ||
            format('%s: sem equipe cadastrada (headcount) — capacidade zerada', v_rec.label);
        END IF;

        v_mo := v_mo + coalesce(v_mo_sector, 0);
        v_team_day_cost := v_team_day_cost
          + coalesce(v_rec.headcount, 0) * v_rate * v_params.journey_minutes / 60.0;

        IF v_min_pairs IS NULL OR v_pairs < v_min_pairs THEN
          v_min_pairs := v_pairs;
          v_bottleneck := v_rec.key;
        END IF;
      END IF;

      v_sectors := v_sectors || jsonb_build_object(
        'sector_key',       v_rec.key,
        'label',            v_rec.label,
        'minutes_per_pair', CASE WHEN v_source IS NULL THEN NULL ELSE round(v_minutes, 4) END,
        'minutes_source',   coalesce(v_source, 'faltando'),
        'source_sheet_name', v_src_sheet,
        'time_sources',     coalesce(to_jsonb(v_time_sources), '[]'::jsonb),
        'headcount',        v_rec.headcount,
        'hourly_rate',      v_rate,
        'pairs_per_day',    CASE WHEN v_pairs IS NULL THEN NULL ELSE floor(v_pairs) END,
        'mo_per_pair',      CASE WHEN v_source IS NULL THEN NULL ELSE round(coalesce(v_mo_sector, 0), 4) END,
        'is_bottleneck',    false
      );
    END LOOP;

    -- Marca o gargalo no breakdown.
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
      'warnings',           to_jsonb(v_warnings),
      'sectors',            v_sectors,
      'bottleneck_sector',  CASE WHEN v_bottleneck IS NULL THEN NULL
                                 ELSE public.capacity_sector_label(v_bottleneck) END,
      'pairs_per_day',      v_pairs_model,
      'productivity_index', NULL,
      'costs', jsonb_build_object(
        'mo_per_pair',              CASE WHEN v_min_pairs IS NULL THEN NULL ELSE round(v_mo, 2) END,
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

  -- Índice de produtividade relativo ao melhor do conjunto comparado.
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

-- 2) Report de consistência (padrão consumption/debit_consistency_report) ------
CREATE OR REPLACE FUNCTION public.capacity_consistency_report()
RETURNS TABLE (categoria text, severidade text, referencia text, detalhe text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  -- 1. Setores da ficha sem tempo em NENHUMA camada (BOM / última ref / default)
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
  -- 2. Operações pendentes (tempo 0 aguardando cadastro)
  SELECT 'operacao_pendente', 'media', ts.name,
         format('Operação %L (stage %s) com time_source=pendente — MO R$ 0 no custeio',
                bo.operation_name, bo.stage)
    FROM bom_operations bo JOIN technical_sheets ts ON ts.id = bo.sheet_id
   WHERE bo.time_source = 'pendente'

  UNION ALL
  -- 3. Setores habilitados sem equipe cadastrada
  SELECT 'setor_sem_equipe', 'alta', ss.sector,
         'headcount vazio/zero em sector_settings — capacidade do setor zera o gargalo de todos os modelos'
    FROM sector_settings ss
   WHERE ss.enabled AND coalesce(ss.headcount, 0) = 0

  UNION ALL
  -- 4. Divergência >20% entre pares/dia por minutos×equipe e a capacidade da
  --    ficha (*_capacity_per_day via mapa TROCADO ficha_capacity_column).
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
            (SELECT floor(coalesce(ss.headcount, 0)
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
  -- 5. Taxas órfãs: sector_key sem nenhuma operação de BOM correspondente
  SELECT 'taxa_orfa', 'info', slr.sector_key,
         format('sector_labor_rates tem R$ %s/h mas nenhuma bom_operation usa esse setor (ex.: corte_cabedal sem operações — gate G3)',
                slr.hourly_rate)
    FROM sector_labor_rates slr
   WHERE NOT EXISTS (
     SELECT 1 FROM bom_operations bo
      WHERE public.capacity_sector_key(bo.stage) = slr.sector_key)

  UNION ALL
  -- 5b. Operação manual/cronoanálise órfã: setor saiu de production_sectors mas a
  --     linha segue ativa — entra no custeio (labor) sem entrar na capacidade,
  --     quebrando o invariante MO ≡ order_costs.labor_cost/qty em silêncio.
  SELECT 'operacao_orfa', 'media', ts.name,
         format('Operação %L ativa no stage %s mas o setor saiu de production_sectors — soma no custeio sem entrar na capacidade',
                bo.operation_name, bo.stage)
    FROM bom_operations bo JOIN technical_sheets ts ON ts.id = bo.sheet_id
   WHERE bo.active AND bo.standard_time_minutes > 0
     AND bo.time_source IN ('manual', 'cronoanalise')
     AND jsonb_typeof(ts.production_sectors) = 'array'
     AND jsonb_array_length(ts.production_sectors) > 0
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(ts.production_sectors) s
        WHERE public.capacity_sector_key(s) = public.capacity_sector_key(bo.stage))

  UNION ALL
  -- 5c. Drift entre team_size (tela /producao/setores) e headcount (engine):
  --     dois cadastros de equipe divergindo em silêncio.
  SELECT 'headcount_drift', 'media', ss.sector,
         format('team_size=%s (tela Setores) difere de headcount=%s (engine de capacidade) — alinhar os dois cadastros',
                ss.team_size, ss.headcount)
    FROM sector_settings ss
   WHERE ss.team_size IS NOT NULL AND ss.headcount IS NOT NULL
     AND ss.team_size::numeric <> ss.headcount

  UNION ALL
  -- 6. Categorias de ficha sem cobertura nos defaults de minutos
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

-- 3) Permissões ----------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_model_productivity(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capacity_consistency_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_model_productivity(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capacity_consistency_report() TO authenticated, service_role;
