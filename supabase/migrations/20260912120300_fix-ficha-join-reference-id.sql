-- =============================================================================
-- FIX (achado no DoD walk 2026-07-12): orders.reference_id aponta pra
-- TECHNICAL_SHEETS, não pra products (FK verificado no banco). O join por
-- products+nome nunca casava → override de capacidade da ficha (R1.3) não
-- aplicava e a fila mostrava referência/foto vazias. Corrige o motor e a view.
-- =============================================================================

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
  -- Serializa recálculos concorrentes (leitores nunca veem run parcial:
  -- delete+insert acontecem na mesma transação).
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

  -- ── Trabalho restante por OP × setor, com rate e nível de fluxo ────────────
  DROP TABLE IF EXISTS _rq_work;
  CREATE TEMP TABLE _rq_work ON COMMIT DROP AS
  WITH ficha AS (
    -- Ficha técnica da referência (match por nome = convenção viva do sistema)
    SELECT DISTINCT ON (o.id)
           o.id AS order_id,
           ts.production_sectors,
           ts.sewing_capacity_per_day, ts.cutting_capacity_per_day,
           ts.mesa_daily_capacity, ts.costura_capacity_per_day,
           ts.silk_capacity_per_day, ts.gluing_capacity_per_day,
           ts.assembly_capacity_per_day, ts.soling_capacity_per_day,
           ts.finishing_capacity_per_day, ts.expedition_capacity_per_day
    FROM orders o
    -- orders.reference_id aponta DIRETO pra technical_sheets (FK confirmado no
    -- banco vivo 2026-07-12) — o match por nome via products era um caminho morto.
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
           -- Override da ficha (R1.3): coluna mapeada em sector_settings, >0 vale
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
           -- Fluxo: ficha preenchida manda na inclusão do setor (R1.3/R1.5);
           -- ficha vazia → vale o liga/desliga global.
           CASE
             WHEN f.production_sectors IS NOT NULL AND jsonb_array_length(f.production_sectors) > 0
               THEN (f.production_sectors ? b.sector
                     OR (b.sector = 'Aviamento' AND f.production_sectors ? 'Mesa'))
             ELSE ss.enabled
           END AS included
    FROM base b
    JOIN sector_settings ss ON ss.sector = b.sector
    LEFT JOIN (
      -- Nível de fluxo: setores do mesmo parallel_group compartilham nível
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
  SELECT l.*,
         GREATEST(COALESCE(l.ficha_rate, l.global_rate), 1)::numeric AS rate,
         (l.ficha_rate IS NOT NULL) AS is_ficha_override,
         (SELECT MAX(l2.level) FROM leveled l2
           WHERE l2.order_id = l.order_id AND l2.level < l.level) AS prev_level,
         l.remaining AS remaining_alloc,
         0::int AS alloc_cum
  FROM leveled l
  WHERE l.remaining > 0;

  -- ── Alocação dia a dia (dias úteis seg–sex) ────────────────────────────────
  DROP TABLE IF EXISTS _rq_alloc;
  CREATE TEMP TABLE _rq_alloc (
    order_id uuid, sector text, date date, pairs int, is_ficha_override boolean
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
        v_f_left := 1.0;  -- fração do dia do setor ainda livre

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
              (v_row.order_id, v_row.sector, v_day, v_take, v_row.is_ficha_override);
            UPDATE _rq_work
               SET alloc_cum = alloc_cum + v_take,
                   remaining_alloc = remaining_alloc - v_take
             WHERE order_id = v_row.order_id AND sector = v_row.sector;
            v_f_left := v_f_left - (v_take::numeric / v_row.rate);
            v_progress := v_progress + v_take;
          END IF;
        END LOOP;
      END LOOP;

      -- Dia útil sem NENHUM par alocado e ainda há trabalho = fluxo travado
      -- (ex.: setor anterior excluído sem entrega). Não itera pra sempre.
      EXIT WHEN v_progress = 0;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  -- ── Carryover (R2.3): o que estava planejado pra ontem-ou-antes e não saiu ─
  DROP TABLE IF EXISTS _rq_backlog;
  CREATE TEMP TABLE _rq_backlog ON COMMIT DROP AS
  SELECT ps.order_id,
         ps.sector,
         GREATEST(0, SUM(ps.planned_pairs)::int - COALESCE(MIN(w.processed), 0)) AS backlog
  FROM production_schedule ps
  JOIN _rq_work w ON w.order_id = ps.order_id AND w.sector = ps.sector
  WHERE ps.date < v_today
  GROUP BY ps.order_id, ps.sector;

  -- ── Troca atômica do futuro (histórico date < hoje fica intacto) ───────────
  DELETE FROM production_schedule WHERE date >= v_today;

  INSERT INTO production_schedule
    (recalc_run_id, order_id, sector, date, planned_pairs, carryover_pairs, capacity_source)
  SELECT v_run, a.order_id, a.sector, a.date, a.pairs,
         LEAST(a.pairs, GREATEST(0, COALESCE(b.backlog, 0) - COALESCE(prev.cum_before, 0)))::int,
         CASE WHEN a.is_ficha_override THEN 'ficha_override' ELSE 'global' END
  FROM _rq_alloc a
  LEFT JOIN _rq_backlog b ON b.order_id = a.order_id AND b.sector = a.sector
  LEFT JOIN LATERAL (
    SELECT SUM(a2.pairs)::int AS cum_before FROM _rq_alloc a2
    WHERE a2.order_id = a.order_id AND a2.sector = a.sector AND a2.date < a.date
  ) prev ON true;

  SELECT COALESCE(SUM(pairs), 0) INTO v_scheduled FROM _rq_alloc;

  INSERT INTO production_engine_runs
    (run_id, duration_ms, queue_size, scheduled_pairs, horizon_end, triggered_by)
  VALUES
    (v_run,
     (EXTRACT(EPOCH FROM clock_timestamp() - v_t0) * 1000)::int,
     v_queue_size, v_scheduled,
     (SELECT MAX(date) FROM _rq_alloc),
     p_triggered_by);

  RETURN jsonb_build_object(
    'run_id', v_run,
    'queue_size', v_queue_size,
    'scheduled_pairs', v_scheduled,
    'horizon_end', (SELECT MAX(date) FROM _rq_alloc),
    'duration_ms', (EXTRACT(EPOCH FROM clock_timestamp() - v_t0) * 1000)::int
  );
END;
$$;


-- v_production_overloads depende da view abaixo — derruba antes e recria depois
DROP VIEW IF EXISTS public.v_production_overloads;
DROP VIEW IF EXISTS public.v_production_queue_detail;
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
  SELECT order_id,
         SUM(GREATEST(0, quantity_total - COALESCE(quantity_processed, 0)))::int AS remaining_pairs
  FROM public.order_stages
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


DROP VIEW IF EXISTS public.v_production_overloads;
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
                   WHERE a.scope_key = 'nodue:' || d.order_id);

SELECT public.recompute_production_schedule('fix_ficha_join');
