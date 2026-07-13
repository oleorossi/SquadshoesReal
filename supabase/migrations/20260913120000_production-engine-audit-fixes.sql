-- =============================================================================
-- AUDITORIA DO MOTOR DE PRODUÇÃO (2026-07-13) — correção dos 20 achados
-- confirmados na revisão multi-agente do commit 0747cea.
--
-- Correções nesta migration:
--  #1  (CRÍTICO) Carryover R2.3 zerava: backlog agora é date-aware — dívida =
--      planejado em dias passados − APONTADO (production_pointings por data BR)
--      desde o 1º agendamento do par OP×setor, em vez de subtrair o
--      quantity_processed all-time (que engolia a dívida via GREATEST(0,…)).
--  #2  (ALTO) Recompute disparava ANTES do UPDATE de order_stages: a ordem em
--      apontar_producao_setor foi invertida (estado primeiro, ledger depois) E
--      os gatilhos de recálculo viraram CONSTRAINT TRIGGERS DEFERRED — rodam no
--      COMMIT, quando tudo está visível. R2.3/R2.4 acontecem NO evento.
--  #3  (ALTO) Estágio 100% apontado sem finalizar travava os níveis seguintes:
--      _rq_work não filtra mais remaining > 0 (o nível cheio entrega pro gate).
--  #4  (ALTO) Deadlock ABBA advisory×FOR UPDATE: com os triggers deferidos o
--      advisory lock só é adquirido no COMMIT — a aresta do deadlock some.
--  #5  (MÉDIO) Recompute intra-dia re-oferecia o dia inteiro: a fração de HOJE
--      desconta o que cada setor já apontou hoje, e a linha de hoje é
--      ESTABILIZADA (planejado = produzido hoje + restante alocado).
--  #6  (MÉDIO) OP nova sem agenda: novo gatilho deferido em order_stages
--      (INSERT/DELETE) — o recálculo roda quando os estágios nascem.
--  #7  (MÉDIO) due_date stale: trigger em sale_orders re-sincroniza a fila
--      quando a semana de faturamento/prazo do PV muda.
--  #8  (MÉDIO) Grade com capacidade errada: production_schedule.day_fraction +
--      utilization/effective_capacity_pairs na view — a UI compara por
--      UTILIZAÇÃO (o que o motor usou), não pares×capacidade global.
--  #9  (MÉDIO) N recomputes por PV: dedup transacional (1 recompute por txn).
--  #10 (ALTO/UI) Pin na posição errada: RPC pin_order_at renumera o bloco de
--      pins respeitando a semântica pin-antes-de-tudo do motor.
--  #11 (BAIXO) Grants column-level: cliente só escreve as colunas de pin.
--  #12 (BAIXO) REVOKE das RPCs do motor pra anon/PUBLIC + gate de aprovação.
--  #13 (BAIXO) Estorno em setor concluído liberado (reabre o estágio — R6.4).
--  #14 (BAIXO) Pulo de setor/início com aviso agora deixam rastro no ledger
--      (CHECK relaxado p/ qty=0 com nota/aviso) + confirmed_warnings_detail
--      grava o snapshot dos avisos confirmados (fidelidade da auditoria R6.3).
--  #15 (BAIXO) material_nao_reservado dispara também ao INICIAR o setor.
--  #16 OPs travadas ficam VISÍVEIS: kind 'sem_agenda' em v_production_overloads.
--  #17 remaining_pairs não conta estágio concluído (pulado 0/300 não infla).
--  #18 Virada de dia garantida por pg_cron (00:05 BRT) — não depende de visita.
-- =============================================================================

-- ── A) Schema ────────────────────────────────────────────────────────────────

ALTER TABLE public.production_schedule
  ADD COLUMN IF NOT EXISTS day_fraction numeric NOT NULL DEFAULT 0;

ALTER TABLE public.production_pointings
  ADD COLUMN IF NOT EXISTS confirmed_warnings_detail jsonb NULL;

-- Ledger aceita qty=0 quando é registro auditável (pulo com nota / aviso confirmado)
ALTER TABLE public.production_pointings
  DROP CONSTRAINT IF EXISTS production_pointings_quantity_check;
ALTER TABLE public.production_pointings
  ADD CONSTRAINT production_pointings_quantity_check
  CHECK (quantity <> 0 OR note IS NOT NULL OR confirmed_warnings IS NOT NULL);

-- Pin é a ÚNICA escrita direta do cliente na fila (#11) — column-level grant.
-- Funções do motor são SECURITY DEFINER (owner) e não são afetadas.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.production_queue FROM anon, authenticated;
GRANT UPDATE (pinned_position, pinned_by, pinned_at, updated_at)
  ON public.production_queue TO authenticated;

-- ── B) Motor v3 ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.recompute_production_schedule(p_triggered_by text DEFAULT 'manual')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_t0 timestamptz := clock_timestamp();
  v_today date := public.br_today();
  v_day date;
  v_guard int := 0;
  v_progress int;
  v_sector record;
  v_row record;
  v_f_left numeric;
  v_avail int;
  v_take int;
  v_queue_size int;
  v_scheduled int := 0;
BEGIN
  -- Gate (#12): usuário aprovado OU contexto interno (trigger/cron sem JWT)
  IF auth.uid() IS NOT NULL AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Serializa recálculos concorrentes (leitores nunca veem run parcial).
  PERFORM pg_advisory_xact_lock(hashtext('recompute_production_schedule'));

  -- ── Fila priorizada (R2.5: pin > prazo > criação) ──────────────────────────
  DROP TABLE IF EXISTS _rq_queue;
  CREATE TEMP TABLE _rq_queue ON COMMIT DROP AS
  SELECT q.order_id, q.due_date,
         row_number() OVER (
           ORDER BY (q.pinned_position IS NULL), q.pinned_position,
                    q.due_date NULLS LAST, o.created_at, o.id
         ) AS prio
  FROM production_queue q
  JOIN orders o ON o.id = q.order_id
  WHERE o.deleted_at IS NULL;

  SELECT count(*) INTO v_queue_size FROM _rq_queue;

  -- ── Trabalho por OP × setor, com rate e nível de fluxo ─────────────────────
  DROP TABLE IF EXISTS _rq_work;
  CREATE TEMP TABLE _rq_work ON COMMIT DROP AS
  WITH ficha AS (
    SELECT DISTINCT ON (o.id)
           o.id AS order_id,
           ts.production_sectors,
           ts.sewing_capacity_per_day, ts.cutting_capacity_per_day,
           ts.mesa_daily_capacity, ts.costura_capacity_per_day,
           ts.silk_capacity_per_day, ts.gluing_capacity_per_day,
           ts.assembly_capacity_per_day, ts.soling_capacity_per_day,
           ts.finishing_capacity_per_day, ts.expedition_capacity_per_day
    FROM orders o
    JOIN technical_sheets ts ON ts.id = o.reference_id
    WHERE o.id IN (SELECT order_id FROM _rq_queue)
    ORDER BY o.id, ts.updated_at DESC
  ),
  base AS (
    SELECT os.order_id,
           CASE WHEN os.stage_name = 'Mesa' THEN 'Aviamento' ELSE os.stage_name END AS sector,
           GREATEST(0, os.quantity_total - COALESCE(os.quantity_processed, 0)) AS remaining,
           COALESCE(os.quantity_processed, 0) AS processed,
           os.status AS stage_status
    FROM order_stages os
    WHERE os.order_id IN (SELECT order_id FROM _rq_queue)
  ),
  enriched AS (
    SELECT b.order_id, b.sector, b.remaining, b.processed,
           ss.flow_order, ss.parallel_group,
           COALESCE(g.grp_order, ss.flow_order) AS lvl_key,
           ss.daily_capacity_pairs AS global_rate,
           CASE ss.ficha_capacity_column
             WHEN 'sewing_capacity_per_day'     THEN NULLIF(COALESCE(f.sewing_capacity_per_day, 0), 0)
             WHEN 'cutting_capacity_per_day'    THEN NULLIF(COALESCE(f.cutting_capacity_per_day, 0), 0)
             WHEN 'mesa_daily_capacity'         THEN NULLIF(COALESCE(f.mesa_daily_capacity, 0), 0)
             WHEN 'costura_capacity_per_day'    THEN NULLIF(COALESCE(f.costura_capacity_per_day::numeric, 0), 0)
             WHEN 'silk_capacity_per_day'       THEN NULLIF(COALESCE(f.silk_capacity_per_day::numeric, 0), 0)
             WHEN 'gluing_capacity_per_day'     THEN NULLIF(COALESCE(f.gluing_capacity_per_day::numeric, 0), 0)
             WHEN 'assembly_capacity_per_day'   THEN NULLIF(COALESCE(f.assembly_capacity_per_day, 0), 0)
             WHEN 'soling_capacity_per_day'     THEN NULLIF(COALESCE(f.soling_capacity_per_day, 0), 0)
             WHEN 'finishing_capacity_per_day'  THEN NULLIF(COALESCE(f.finishing_capacity_per_day, 0), 0)
             WHEN 'expedition_capacity_per_day' THEN NULLIF(COALESCE(f.expedition_capacity_per_day, 0), 0)
             ELSE NULL
           END AS ficha_rate,
           CASE
             WHEN f.production_sectors IS NOT NULL AND jsonb_array_length(f.production_sectors) > 0
               THEN (f.production_sectors ? b.sector
                     OR (b.sector = 'Aviamento' AND f.production_sectors ? 'Mesa'))
             ELSE ss.enabled
           END AS included
    FROM base b
    JOIN sector_settings ss ON ss.sector = b.sector
    LEFT JOIN (
      SELECT parallel_group, MIN(flow_order) AS grp_order
      FROM sector_settings WHERE parallel_group IS NOT NULL GROUP BY 1
    ) g ON g.parallel_group = ss.parallel_group
    LEFT JOIN ficha f ON f.order_id = b.order_id
    WHERE b.stage_status <> 'concluido'
  ),
  leveled AS (
    SELECT e.*, q.prio, q.due_date,
           dense_rank() OVER (
             PARTITION BY e.order_id ORDER BY e.lvl_key
           ) AS level
    FROM enriched e
    JOIN _rq_queue q ON q.order_id = e.order_id
    WHERE e.included
  )
  -- (#3) SEM filtro remaining > 0: estágio 100% apontado (não finalizado)
  -- precisa existir aqui pra ENTREGAR ao nível seguinte via _rq_delivered.
  SELECT l.*,
         GREATEST(COALESCE(l.ficha_rate, l.global_rate), 1)::numeric AS rate,
         (l.ficha_rate IS NOT NULL) AS is_ficha_override,
         (SELECT MAX(l2.level) FROM leveled l2
           WHERE l2.order_id = l.order_id AND l2.level < l.level) AS prev_level,
         l.remaining AS remaining_alloc,
         0::int AS alloc_cum
  FROM leveled l;

  -- ── Produzido HOJE por OP×setor (fuso BR) — #1/#5 ──────────────────────────
  DROP TABLE IF EXISTS _rq_today_done;
  CREATE TEMP TABLE _rq_today_done ON COMMIT DROP AS
  SELECT pp.order_id,
         CASE WHEN pp.stage_name = 'Mesa' THEN 'Aviamento' ELSE pp.stage_name END AS sector,
         GREATEST(0, SUM(pp.quantity))::int AS done_today
  FROM production_pointings pp
  WHERE (pp.created_at AT TIME ZONE 'America/Sao_Paulo')::date = v_today
  GROUP BY 1, 2
  HAVING GREATEST(0, SUM(pp.quantity)) > 0;

  -- Fração do dia de HOJE já consumida por setor (#5)
  DROP TABLE IF EXISTS _rq_today_frac;
  CREATE TEMP TABLE _rq_today_frac ON COMMIT DROP AS
  SELECT t.sector,
         LEAST(1.0, SUM(t.done_today::numeric
                        / COALESCE(w.rate, GREATEST(ss.daily_capacity_pairs, 1)::numeric))) AS f_used
  FROM _rq_today_done t
  JOIN sector_settings ss ON ss.sector = t.sector
  LEFT JOIN _rq_work w ON w.order_id = t.order_id AND w.sector = t.sector
  GROUP BY t.sector;

  -- ── Alocação dia a dia (dias úteis seg–sex) ────────────────────────────────
  DROP TABLE IF EXISTS _rq_alloc;
  CREATE TEMP TABLE _rq_alloc (
    order_id uuid, sector text, date date, pairs int, frac numeric, is_ficha_override boolean
  ) ON COMMIT DROP;

  v_day := v_today;
  WHILE EXISTS (SELECT 1 FROM _rq_work WHERE remaining_alloc > 0) LOOP
    v_guard := v_guard + 1;
    EXIT WHEN v_guard > 500;  -- backstop (~2 anos corridos)

    IF EXTRACT(ISODOW FROM v_day) BETWEEN 1 AND 5 THEN
      -- Entregue por (OP, nível) até ONTEM: apontado real + agendado acumulado.
      DROP TABLE IF EXISTS _rq_delivered;
      CREATE TEMP TABLE _rq_delivered ON COMMIT DROP AS
      SELECT w.order_id, w.level,
             MIN(w.processed + COALESCE(a.cum, 0))::int AS delivered
      FROM _rq_work w
      LEFT JOIN (
        SELECT order_id, sector, SUM(pairs)::int AS cum
        FROM _rq_alloc WHERE date < v_day GROUP BY 1, 2
      ) a ON a.order_id = w.order_id AND a.sector = w.sector
      GROUP BY w.order_id, w.level;

      v_progress := 0;

      FOR v_sector IN
        SELECT DISTINCT w.sector, w.flow_order FROM _rq_work w
        WHERE w.remaining_alloc > 0 ORDER BY w.flow_order
      LOOP
        -- (#5) HOJE começa com a fração que os apontamentos ainda não consumiram
        IF v_day = v_today THEN
          v_f_left := GREATEST(0, 1.0 - COALESCE(
            (SELECT f.f_used FROM _rq_today_frac f WHERE f.sector = v_sector.sector), 0));
        ELSE
          v_f_left := 1.0;
        END IF;

        FOR v_row IN
          SELECT w.* FROM _rq_work w
          WHERE w.sector = v_sector.sector AND w.remaining_alloc > 0
          ORDER BY w.prio
        LOOP
          EXIT WHEN v_f_left <= 0.001;

          IF v_row.prev_level IS NULL THEN
            v_avail := v_row.remaining_alloc;
          ELSE
            SELECT GREATEST(0, COALESCE(d.delivered, 0) - v_row.processed - v_row.alloc_cum)
              INTO v_avail
              FROM _rq_delivered d
             WHERE d.order_id = v_row.order_id AND d.level = v_row.prev_level;
            v_avail := COALESCE(v_avail, 0);
          END IF;

          v_take := LEAST(v_row.remaining_alloc, v_avail,
                          FLOOR(v_f_left * v_row.rate)::int);

          IF v_take > 0 THEN
            INSERT INTO _rq_alloc VALUES
              (v_row.order_id, v_row.sector, v_day, v_take,
               v_take::numeric / v_row.rate, v_row.is_ficha_override);
            UPDATE _rq_work
               SET alloc_cum = alloc_cum + v_take,
                   remaining_alloc = remaining_alloc - v_take
             WHERE order_id = v_row.order_id AND sector = v_row.sector;
            v_f_left := v_f_left - (v_take::numeric / v_row.rate);
            v_progress := v_progress + v_take;
          END IF;
        END LOOP;
      END LOOP;

      -- Fluxo travado: só desiste num dia FUTURO sem alocação nenhuma. HOJE pode
      -- estar 100% consumido pelos apontamentos e ainda haver amanhã (#5).
      EXIT WHEN v_progress = 0 AND v_day > v_today;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  -- ── Linha de HOJE estabilizada (#1/#5): plano = produzido hoje + restante ──
  DROP TABLE IF EXISTS _rq_out;
  CREATE TEMP TABLE _rq_out ON COMMIT DROP AS
  SELECT order_id, sector, date,
         SUM(pairs)::int AS pairs, SUM(frac) AS frac,
         BOOL_OR(is_ficha_override) AS is_ficha_override
  FROM (
    SELECT order_id, sector, date, pairs, frac, is_ficha_override FROM _rq_alloc
    UNION ALL
    SELECT t.order_id, t.sector, v_today, t.done_today,
           t.done_today::numeric / COALESCE(w.rate, GREATEST(ss.daily_capacity_pairs, 1)::numeric),
           COALESCE(w.is_ficha_override, false)
    FROM _rq_today_done t
    JOIN sector_settings ss ON ss.sector = t.sector
    LEFT JOIN _rq_work w ON w.order_id = t.order_id AND w.sector = t.sector
  ) x
  GROUP BY 1, 2, 3;

  -- ── Carryover R2.3 date-aware (#1): dívida = planejado passado − apontado ──
  --    nos dias passados desde o 1º agendamento do par OP×setor. NÃO usa o
  --    processed all-time (progresso pré-motor não desconta dívida).
  DROP TABLE IF EXISTS _rq_backlog;
  CREATE TEMP TABLE _rq_backlog ON COMMIT DROP AS
  WITH first_sched AS (
    SELECT order_id, sector, MIN(date) AS first_date
    FROM production_schedule
    WHERE date < v_today
    GROUP BY 1, 2
  ),
  done_past AS (
    SELECT pp.order_id,
           CASE WHEN pp.stage_name = 'Mesa' THEN 'Aviamento' ELSE pp.stage_name END AS sector,
           SUM(pp.quantity) FILTER (
             WHERE (pp.created_at AT TIME ZONE 'America/Sao_Paulo')::date < v_today
               AND (pp.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= fs.first_date
           )::int AS qty
    FROM production_pointings pp
    JOIN first_sched fs ON fs.order_id = pp.order_id
      AND fs.sector = CASE WHEN pp.stage_name = 'Mesa' THEN 'Aviamento' ELSE pp.stage_name END
    GROUP BY 1, 2
  )
  SELECT ps.order_id, ps.sector,
         GREATEST(0, SUM(ps.planned_pairs)::int - COALESCE(MIN(dp.qty), 0)) AS backlog
  FROM production_schedule ps
  JOIN (SELECT DISTINCT order_id, sector FROM _rq_work) w
    ON w.order_id = ps.order_id AND w.sector = ps.sector
  LEFT JOIN done_past dp ON dp.order_id = ps.order_id AND dp.sector = ps.sector
  WHERE ps.date < v_today
  GROUP BY ps.order_id, ps.sector;

  -- ── Troca atômica do futuro (histórico date < hoje fica intacto) ───────────
  DELETE FROM production_schedule WHERE date >= v_today;

  INSERT INTO production_schedule
    (recalc_run_id, order_id, sector, date, planned_pairs, carryover_pairs,
     capacity_source, day_fraction)
  SELECT v_run, a.order_id, a.sector, a.date, a.pairs,
         LEAST(a.pairs, GREATEST(0, COALESCE(b.backlog, 0) - COALESCE(prev.cum_before, 0)))::int,
         CASE WHEN a.is_ficha_override THEN 'ficha_override' ELSE 'global' END,
         ROUND(a.frac, 6)
  FROM _rq_out a
  LEFT JOIN _rq_backlog b ON b.order_id = a.order_id AND b.sector = a.sector
  LEFT JOIN LATERAL (
    SELECT SUM(a2.pairs)::int AS cum_before FROM _rq_out a2
    WHERE a2.order_id = a.order_id AND a2.sector = a.sector AND a2.date < a.date
  ) prev ON true
  WHERE a.pairs > 0;

  SELECT COALESCE(SUM(pairs), 0) INTO v_scheduled FROM _rq_out;

  INSERT INTO production_engine_runs
    (run_id, duration_ms, queue_size, scheduled_pairs, horizon_end, triggered_by)
  VALUES
    (v_run,
     (EXTRACT(EPOCH FROM clock_timestamp() - v_t0) * 1000)::int,
     v_queue_size, v_scheduled,
     (SELECT MAX(date) FROM _rq_out),
     p_triggered_by);

  RETURN jsonb_build_object(
    'run_id', v_run,
    'queue_size', v_queue_size,
    'scheduled_pairs', v_scheduled,
    'horizon_end', (SELECT MAX(date) FROM _rq_out),
    'duration_ms', (EXTRACT(EPOCH FROM clock_timestamp() - v_t0) * 1000)::int
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_production_schedule_if_stale()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;
  IF EXISTS (SELECT 1 FROM production_engine_runs WHERE ran_on = public.br_today()) THEN
    RETURN jsonb_build_object('recomputed', false);
  END IF;
  RETURN public.recompute_production_schedule('virada_de_dia') || jsonb_build_object('recomputed', true);
END;
$$;

-- (#12) anon fora; aprovação é checada dentro da função
REVOKE EXECUTE ON FUNCTION public.recompute_production_schedule(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_production_schedule(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.recompute_production_schedule_if_stale() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_production_schedule_if_stale() TO authenticated, service_role;

-- ── C) Views v2 (R2.7) ───────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_production_overloads;
DROP VIEW IF EXISTS public.v_production_queue_detail;
DROP VIEW IF EXISTS public.v_production_schedule_grid;

CREATE VIEW public.v_production_schedule_grid
WITH (security_invoker = on) AS
SELECT ps.sector,
       ps.date,
       SUM(ps.planned_pairs)::int   AS planned_pairs,
       SUM(ps.carryover_pairs)::int AS carryover_pairs,
       ss.daily_capacity_pairs      AS capacity_pairs,
       -- (#8) o que o motor DE FATO usou do dia: 1.0 = dia cheio
       ROUND(SUM(ps.day_fraction)::numeric, 4) AS utilization,
       -- capacidade efetiva do mix do dia (pares/dia ao rate real de cada OP)
       CASE WHEN SUM(ps.day_fraction) > 0.0001
            THEN GREATEST(1, ROUND(SUM(ps.planned_pairs) / SUM(ps.day_fraction)))::int
            ELSE ss.daily_capacity_pairs END AS effective_capacity_pairs,
       COUNT(DISTINCT ps.order_id)::int AS ops,
       COUNT(DISTINCT ps.order_id) FILTER (WHERE ps.capacity_source = 'ficha_override')::int AS ops_ficha_override,
       ss.flow_order, ss.enabled, ss.parallel_group
FROM public.production_schedule ps
JOIN public.sector_settings ss ON ss.sector = ps.sector
GROUP BY ps.sector, ps.date, ss.daily_capacity_pairs, ss.flow_order, ss.enabled, ss.parallel_group;

CREATE VIEW public.v_production_queue_detail
WITH (security_invoker = on) AS
WITH sched AS (
  SELECT order_id,
         MAX(date) AS projected_completion,
         MIN(date) AS next_scheduled_date,
         BOOL_OR(capacity_source = 'ficha_override') AS has_ficha_override,
         SUM(carryover_pairs)::int AS carryover_total
  FROM public.production_schedule
  WHERE date >= public.br_today()
  GROUP BY order_id
),
stg AS (
  -- (#17) estágio concluído não conta como restante (setor pulado 0/300
  -- não infla remaining_pairs pra sempre)
  SELECT order_id,
         SUM(GREATEST(0, quantity_total - COALESCE(quantity_processed, 0)))::int AS remaining_pairs
  FROM public.order_stages
  WHERE status <> 'concluido'
  GROUP BY order_id
)
SELECT q.order_id,
       o.order_number,
       o.reference_id,
       ts.name  AS reference_name,
       ts.image_url AS reference_photo_url,
       o.color,
       o.quantity,
       o.status AS order_status,
       o.sale_order_id,
       so.order_number AS sale_order_number,
       c.razao_social  AS client_name,
       q.due_date,
       q.pinned_position, q.pinned_by, q.pinned_at,
       q.status AS queue_status,
       s.projected_completion,
       s.next_scheduled_date,
       COALESCE(s.has_ficha_override, false) AS has_ficha_override,
       COALESCE(s.carryover_total, 0) AS carryover_total,
       COALESCE(st.remaining_pairs, 0) AS remaining_pairs,
       CASE WHEN q.due_date IS NOT NULL AND s.projected_completion > q.due_date
            THEN (s.projected_completion - q.due_date) ELSE 0 END AS late_days,
       row_number() OVER (
         ORDER BY (q.pinned_position IS NULL), q.pinned_position,
                  q.due_date NULLS LAST, o.created_at, o.id
       )::int AS queue_position
FROM public.production_queue q
JOIN public.orders o        ON o.id = q.order_id AND o.deleted_at IS NULL
LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
LEFT JOIN public.clients c  ON c.id = so.client_id
LEFT JOIN sched s  ON s.order_id = q.order_id
LEFT JOIN stg   st ON st.order_id = q.order_id;

CREATE VIEW public.v_production_overloads
WITH (security_invoker = on) AS
SELECT 'late_op'::text AS kind,
       d.order_id, d.order_number, d.reference_name, d.color, d.quantity,
       d.sale_order_id, d.sale_order_number, d.client_name,
       d.due_date, d.projected_completion, d.late_days, d.carryover_total,
       d.remaining_pairs
FROM public.v_production_queue_detail d
WHERE d.late_days > 0
  AND NOT EXISTS (SELECT 1 FROM public.overload_acknowledgements a
                   WHERE a.scope_key = 'late:' || d.order_id)
UNION ALL
SELECT 'no_due'::text,
       d.order_id, d.order_number, d.reference_name, d.color, d.quantity,
       d.sale_order_id, d.sale_order_number, d.client_name,
       d.due_date, d.projected_completion, 0, d.carryover_total, d.remaining_pairs
FROM public.v_production_queue_detail d
WHERE d.due_date IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.overload_acknowledgements a
                   WHERE a.scope_key = 'nodue:' || d.order_id)
UNION ALL
-- (#16) OP com trabalho restante e NENHUMA agenda futura = fluxo travado
-- (antes sumia em silêncio com late_days=0)
SELECT 'sem_agenda'::text,
       d.order_id, d.order_number, d.reference_name, d.color, d.quantity,
       d.sale_order_id, d.sale_order_number, d.client_name,
       d.due_date, d.projected_completion, 0, d.carryover_total, d.remaining_pairs
FROM public.v_production_queue_detail d
WHERE d.remaining_pairs > 0
  AND d.projected_completion IS NULL
  AND d.due_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.overload_acknowledgements a
                   WHERE a.scope_key = 'noagenda:' || d.order_id);

-- ── D) Gatilhos deferidos + dedup transacional (#2/#4/#6/#9) ─────────────────

-- Dedup: N firings na mesma transação = 1 recompute (no COMMIT, tudo visível)
CREATE OR REPLACE FUNCTION public.tg_recompute_production_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('app.recompute_txid', true) = txid_current()::text THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.recompute_txid', txid_current()::text, true);
  PERFORM public.recompute_production_schedule(TG_ARGV[0]);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tg_queue_recompute ON public.production_queue;
CREATE CONSTRAINT TRIGGER tg_queue_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.production_queue
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_production_schedule('queue_change');

DROP TRIGGER IF EXISTS tg_pointings_recompute ON public.production_pointings;
CREATE CONSTRAINT TRIGGER tg_pointings_recompute
  AFTER INSERT ON public.production_pointings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_production_schedule('apontamento');

DROP TRIGGER IF EXISTS tg_sector_settings_recompute ON public.sector_settings;
CREATE CONSTRAINT TRIGGER tg_sector_settings_recompute
  AFTER UPDATE ON public.sector_settings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_production_schedule('sector_settings');

DROP TRIGGER IF EXISTS tg_ficha_recompute ON public.technical_sheets;
CREATE CONSTRAINT TRIGGER tg_ficha_recompute
  AFTER UPDATE OF production_sectors,
    sewing_capacity_per_day, cutting_capacity_per_day, mesa_daily_capacity,
    costura_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day,
    assembly_capacity_per_day, soling_capacity_per_day,
    finishing_capacity_per_day, expedition_capacity_per_day
  ON public.technical_sheets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_production_schedule('ficha_override');

-- (#6) OP nova ganha agenda quando os estágios NASCEM (também cobre resync/delete)
DROP TRIGGER IF EXISTS tg_stages_recompute ON public.order_stages;
CREATE CONSTRAINT TRIGGER tg_stages_recompute
  AFTER INSERT OR DELETE ON public.order_stages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_production_schedule('stages_change');

-- (#7) Prazo do PV mudou → re-sincroniza due_date de todas as OPs do PV
CREATE OR REPLACE FUNCTION public.tg_resync_queue_due_on_pv_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE production_queue q
     SET due_date = public.resolve_op_due_date(q.order_id),
         updated_at = now()
    FROM orders o
   WHERE o.id = q.order_id
     AND o.sale_order_id = NEW.id
     AND q.due_date IS DISTINCT FROM public.resolve_op_due_date(q.order_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tg_sale_orders_resync_queue_due ON public.sale_orders;
CREATE TRIGGER tg_sale_orders_resync_queue_due
  AFTER UPDATE OF billing_week, delivery_deadline, delivery_month, delivery_week
  ON public.sale_orders
  FOR EACH ROW
  WHEN (OLD.billing_week IS DISTINCT FROM NEW.billing_week
     OR OLD.delivery_deadline IS DISTINCT FROM NEW.delivery_deadline
     OR OLD.delivery_month IS DISTINCT FROM NEW.delivery_month
     OR OLD.delivery_week IS DISTINCT FROM NEW.delivery_week)
  EXECUTE FUNCTION public.tg_resync_queue_due_on_pv_change();

-- ── E) apontar_producao_setor v3 (#2/#13/#14/#15) ────────────────────────────

CREATE OR REPLACE FUNCTION public.apontar_producao_setor(
  p_order_id uuid,
  p_stage_name text,
  p_quantity integer,
  p_operator_employee_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_finalize boolean DEFAULT false,
  p_confirmed_warnings text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stage record;
  v_settings record;
  v_new_processed integer;
  v_stage_processed integer;
  v_finalize_result jsonb := NULL;
  v_warnings jsonb := '[]'::jsonb;
  v_unconfirmed text[] := '{}';
  v_raised text[] := '{}';
  v_prev_delivered integer;
  v_has_reservation boolean;
  v_reopening boolean := false;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT id, stage_name, status, quantity_processed, quantity_total
    INTO v_stage
    FROM public.order_stages
   WHERE order_id = p_order_id
     AND (stage_name = p_stage_name
          OR (p_stage_name = 'Aviamento' AND stage_name = 'Mesa')
          OR (p_stage_name = 'Mesa' AND stage_name = 'Aviamento'))
   ORDER BY (stage_name = p_stage_name) DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Setor "%" não existe nesta OP.', p_stage_name;
  END IF;

  -- (#13) Concluído bloqueia apontamento pra FRENTE; estorno negativo REABRE (R6.4)
  IF v_stage.status = 'concluido' AND COALESCE(p_quantity, 0) >= 0 THEN
    RAISE EXCEPTION 'Setor "%" já está concluído — apontamento bloqueado (estorno negativo é permitido).', v_stage.stage_name;
  END IF;
  v_reopening := (v_stage.status = 'concluido' AND COALESCE(p_quantity, 0) < 0);

  v_new_processed := COALESCE(v_stage.quantity_processed, 0) + COALESCE(p_quantity, 0);

  IF v_new_processed < 0 THEN
    RAISE EXCEPTION 'Correção inválida: quantidade acumulada ficaria negativa (% pares).', v_new_processed;
  END IF;

  SELECT check_prev_sector_limit, check_material_reserved
    INTO v_settings
    FROM public.sector_settings
   WHERE sector = CASE WHEN v_stage.stage_name = 'Mesa' THEN 'Aviamento' ELSE v_stage.stage_name END;

  -- ── Aviso: limite do setor anterior (só pra apontamento positivo) ──────────
  IF COALESCE(p_quantity, 0) > 0 AND COALESCE(v_settings.check_prev_sector_limit, true) THEN
    WITH op_stages AS (
      SELECT CASE WHEN os.stage_name = 'Mesa' THEN 'Aviamento' ELSE os.stage_name END AS sector,
             os.quantity_processed, os.quantity_total, os.status
      FROM order_stages os WHERE os.order_id = p_order_id
    ),
    leveled AS (
      SELECT s.*,
             dense_rank() OVER (ORDER BY COALESCE(g.grp_order, ss.flow_order)) AS level
      FROM op_stages s
      JOIN sector_settings ss ON ss.sector = s.sector
      LEFT JOIN (SELECT parallel_group, MIN(flow_order) AS grp_order
                   FROM sector_settings WHERE parallel_group IS NOT NULL GROUP BY 1) g
             ON g.parallel_group = ss.parallel_group
    ),
    me AS (
      SELECT level FROM leveled
      WHERE sector = CASE WHEN v_stage.stage_name = 'Mesa' THEN 'Aviamento' ELSE v_stage.stage_name END
      LIMIT 1
    )
    SELECT MIN(CASE WHEN l.status = 'concluido' THEN l.quantity_total
                    ELSE COALESCE(l.quantity_processed, 0) END)
      INTO v_prev_delivered
      FROM leveled l, me
     WHERE l.level = (SELECT MAX(l2.level) FROM leveled l2, me WHERE l2.level < me.level);

    IF v_prev_delivered IS NOT NULL AND v_new_processed > v_prev_delivered THEN
      v_raised := array_append(v_raised, 'limite_setor_anterior');
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'limite_setor_anterior',
        'message', format('O setor anterior entregou só %s de %s pares — você está apontando %s no acumulado.',
                          v_prev_delivered, v_stage.quantity_total, v_new_processed),
        'delivered', v_prev_delivered);
    END IF;
  END IF;

  -- ── Aviso: material não reservado — também ao INICIAR o setor (#15/R6.3) ───
  IF (COALESCE(p_quantity, 0) > 0 OR v_stage.status = 'pendente')
     AND COALESCE(v_settings.check_material_reserved, true) THEN
    SELECT EXISTS (
      SELECT 1 FROM material_reservations
      WHERE order_id = p_order_id AND status IN ('reserved','consumed','converted')
    ) INTO v_has_reservation;
    IF NOT v_has_reservation THEN
      v_raised := array_append(v_raised, 'material_nao_reservado');
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'material_nao_reservado',
        'message', 'Esta OP não tem reserva ativa de material no estoque.');
    END IF;
  END IF;

  -- ── Aviso: acima do total da OP ────────────────────────────────────────────
  IF v_new_processed > v_stage.quantity_total THEN
    v_raised := array_append(v_raised, 'acima_do_total');
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'acima_do_total',
      'message', format('Apontamento excede o total da OP: %s já apontados + %s agora > %s pares. O estágio será limitado ao total; o ledger guarda o valor real.',
                        v_stage.quantity_processed, p_quantity, v_stage.quantity_total));
  END IF;

  -- ── Protocolo avisar+confirmar (R6.3): nada grava sem OK explícito ─────────
  SELECT COALESCE(array_agg(w), '{}') INTO v_unconfirmed
    FROM unnest(v_raised) w
   WHERE NOT (w = ANY (COALESCE(p_confirmed_warnings, '{}')));

  IF array_length(v_unconfirmed, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'needs_confirmation', true,
      'warnings', v_warnings,
      'stage_name', v_stage.stage_name,
      'quantity_processed', v_stage.quantity_processed,
      'quantity_total', v_stage.quantity_total
    );
  END IF;

  -- Estágio clampado no total (CHECK do banco); ledger guarda a quantidade real.
  v_stage_processed := LEAST(v_new_processed, v_stage.quantity_total);

  -- (#2) 1º o ESTADO (order_stages), DEPOIS o ledger — qualquer gatilho do
  -- ledger já enxerga o estágio atualizado. (#13) estorno reabre o estágio.
  UPDATE public.order_stages
     SET quantity_processed = v_stage_processed,
         operator_employee_id = COALESCE(p_operator_employee_id, operator_employee_id),
         status = CASE
           WHEN v_reopening AND v_stage_processed < v_stage.quantity_total THEN 'em_andamento'
           WHEN status = 'pendente' THEN 'em_andamento'
           ELSE status END,
         completed_at = CASE WHEN v_reopening AND v_stage_processed < v_stage.quantity_total
                             THEN NULL ELSE completed_at END,
         completed_by = CASE WHEN v_reopening AND v_stage_processed < v_stage.quantity_total
                             THEN NULL ELSE completed_by END,
         started_at = COALESCE(started_at, now()),
         updated_at = now()
   WHERE id = v_stage.id;

  -- (#14) Ledger: qty≠0, OU aviso confirmado (autoria R6.3), OU pulo com nota (R5.5)
  IF COALESCE(p_quantity, 0) <> 0
     OR array_length(v_raised, 1) > 0
     OR (p_finalize AND NULLIF(trim(p_note), '') IS NOT NULL) THEN
    INSERT INTO public.production_pointings
      (order_id, order_stage_id, stage_name, quantity, operator_employee_id, note,
       confirmed_warnings, confirmed_warnings_detail)
    VALUES
      (p_order_id, v_stage.id, v_stage.stage_name, COALESCE(p_quantity, 0),
       p_operator_employee_id, NULLIF(trim(p_note), ''),
       CASE WHEN array_length(v_raised, 1) > 0 THEN v_raised
            WHEN COALESCE(array_length(p_confirmed_warnings, 1), 0) > 0 THEN p_confirmed_warnings
            ELSE NULL END,
       CASE WHEN array_length(v_raised, 1) > 0 THEN v_warnings ELSE NULL END);
  END IF;

  IF p_finalize THEN
    v_finalize_result := public.finalize_production_sector(
      p_order_id, v_stage.stage_name, v_stage_processed, p_operator_employee_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'stage_name', v_stage.stage_name,
    'quantity_processed', v_stage_processed,
    'quantity_total', v_stage.quantity_total,
    'finalized', p_finalize,
    'confirmed_warnings', CASE WHEN array_length(v_raised, 1) > 0 THEN to_jsonb(v_raised) ELSE NULL END,
    'finalize_result', v_finalize_result
  );
END;
$$;

-- ── F) pin_order_at (#10): fixa a OP NA POSIÇÃO onde foi solta ───────────────
-- Semântica do motor: toda pinada vem antes de toda não-pinada. Pra materializar
-- "solte na posição k", pina as k primeiras linhas da ordem resultante (1..k) e
-- renumera os pins existentes abaixo — sem colisão, sem inversão.
CREATE OR REPLACE FUNCTION public.pin_order_at(p_order_id uuid, p_target_position integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ids uuid[];
  v_new uuid[];
  v_k int;
  v_i int;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM production_queue WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'OP não está na fila do motor.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('pin_order_at'));

  -- Ordem atual da fila (mesma ordenação do motor), sem a OP arrastada
  SELECT COALESCE(array_agg(order_id ORDER BY rn), '{}') INTO v_ids FROM (
    SELECT q.order_id,
           row_number() OVER (
             ORDER BY (q.pinned_position IS NULL), q.pinned_position,
                      q.due_date NULLS LAST, o.created_at, o.id
           ) AS rn
    FROM production_queue q
    JOIN orders o ON o.id = q.order_id AND o.deleted_at IS NULL
    WHERE q.order_id <> p_order_id
  ) s;

  v_k := LEAST(GREATEST(COALESCE(p_target_position, 1), 1),
               COALESCE(array_length(v_ids, 1), 0) + 1);
  v_new := v_ids[1:v_k-1] || ARRAY[p_order_id] || v_ids[v_k:];

  FOR v_i IN 1..COALESCE(array_length(v_new, 1), 0) LOOP
    IF v_i <= v_k THEN
      -- Bloco da frente: tudo até a posição alvo fica pinado no índice exibido
      UPDATE production_queue
         SET pinned_position = v_i,
             pinned_by = COALESCE(auth.uid(), pinned_by),
             pinned_at = CASE WHEN pinned_position IS DISTINCT FROM v_i THEN now() ELSE pinned_at END,
             updated_at = now()
       WHERE order_id = v_new[v_i]
         AND pinned_position IS DISTINCT FROM v_i;
    ELSE
      -- Abaixo do alvo: só renumera quem JÁ era pinado (não pina ninguém novo)
      UPDATE production_queue
         SET pinned_position = v_i, updated_at = now()
       WHERE order_id = v_new[v_i]
         AND pinned_position IS NOT NULL
         AND pinned_position IS DISTINCT FROM v_i;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pin_order_at(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pin_order_at(uuid, integer) TO authenticated, service_role;

-- ── G) Virada de dia garantida (#18): pg_cron 00:05 BRT (03:05 UTC) ──────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'production-engine-day-rollover') THEN
    PERFORM cron.schedule(
      'production-engine-day-rollover',
      '5 3 * * *',
      $job$SELECT public.recompute_production_schedule_if_stale()$job$
    );
  END IF;
END $$;

-- ── H) Primeiro recálculo com o motor corrigido ──────────────────────────────
SELECT public.recompute_production_schedule('audit_fixes_2026_07_13');
