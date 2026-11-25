-- ════════════════════════════════════════════════════════════════════════════
-- Motor de produção · 2/3 — Ordem única (fila = agenda) e agenda realista.
--
-- Ordem oficial, a mesma na Sequência, no Kanban (queue_position) e na agenda:
--   1. fixados (pin) → 2. congelados → 3. PV urgente
--   4. semana de faturamento (caixa: quem fatura antes, produz antes)
--   5. avanço do PV (pares já PRODUZIDOS — fechar PV que já andou)
--   6. dentro da mesma semana: intercala cabedal complexo e simples por pares
--      (fatia proporcional de cada classe), para não travar a Montagem
--   7. cor → ref
--
-- Agenda (recompute_production_schedule_impl_249), capacidade finita setor×dia:
--   * item complexo ainda no prestador entra como DEMANDA PREVISTA (sem OP):
--     reserva Montagem e seguintes a partir do retorno previsto do prestador
--     (atelier_jobs_expected_dates); o simples ocupa os buracos antes disso.
--     A previsão fica em production_motor_forecast (não vira OP nem apontamento).
--   * OP de ref complexa: Corte Cabedal/Costura Cabedal/Aviamento do Ateliê não
--     são agendados na fábrica; a partir do setor motor_cabedal_gate_sector
--     (Montagem) espera o retorno do prestador.
--   * OP com falta de material (ainda não iniciada) só começa na chegada
--     prevista da OC (motor_material_eta); falta de solado segura só Solagem.
--   * ordem e motivo de espera ficam em production_motor_state
--     (lidos por list_production_sequence, v_production_queue_detail e
--     v_production_motor_plan).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Estado do motor (por OP ou item complexo previsto) ─────────────────────
CREATE TABLE IF NOT EXISTS public.production_motor_state (
  order_key uuid PRIMARY KEY,
  order_id uuid,
  sale_order_id uuid,
  sale_order_item_id uuid,
  is_virtual boolean NOT NULL DEFAULT false,
  item_class text NOT NULL,
  billing_anchor date,
  is_urgent boolean NOT NULL DEFAULT false,
  pv_progress numeric,
  motor_position integer NOT NULL,
  pairs integer,
  earliest_start date,
  cabedal_expected_return date,
  material_eta date,
  wait_reason text,
  projected_completion date,
  recalc_run_id uuid,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_motor_state_order_idx ON public.production_motor_state (order_id);
CREATE INDEX IF NOT EXISTS production_motor_state_item_idx ON public.production_motor_state (sale_order_item_id);
COMMENT ON TABLE public.production_motor_state IS
  'Saída do motor por OP (order_key = orders.id) ou por item de cabedal complexo ainda no prestador (order_key = sale_order_items.id, is_virtual). Reescrita a cada recompute.';

CREATE TABLE IF NOT EXISTS public.production_motor_forecast (
  id bigserial PRIMARY KEY,
  recalc_run_id uuid,
  sale_order_item_id uuid NOT NULL,
  sale_order_id uuid,
  sector text NOT NULL,
  date date NOT NULL,
  planned_pairs integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_motor_forecast_item_idx ON public.production_motor_forecast (sale_order_item_id);
CREATE INDEX IF NOT EXISTS production_motor_forecast_date_idx ON public.production_motor_forecast (date, sector);
COMMENT ON TABLE public.production_motor_forecast IS
  'Capacidade reservada para item de cabedal complexo que ainda não voltou do prestador (sem OP). Reescrita a cada recompute.';

ALTER TABLE public.production_motor_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_motor_forecast ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS production_motor_state_select ON public.production_motor_state;
CREATE POLICY production_motor_state_select ON public.production_motor_state
  FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS production_motor_forecast_select ON public.production_motor_forecast;
CREATE POLICY production_motor_forecast_select ON public.production_motor_forecast
  FOR SELECT TO authenticated USING (public.is_approved_user());
REVOKE ALL ON public.production_motor_state FROM anon;
REVOKE ALL ON public.production_motor_forecast FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.production_motor_state FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.production_motor_forecast FROM authenticated;
GRANT SELECT ON public.production_motor_state TO authenticated;
GRANT SELECT ON public.production_motor_forecast TO authenticated;
GRANT ALL ON public.production_motor_state TO service_role;
GRANT ALL ON public.production_motor_forecast TO service_role;

-- ─── Avanço do PV: pares PRODUZIDOS (não "% com OP") ────────────────────────
CREATE OR REPLACE FUNCTION public.production_sequence_close_score(p_sale_order_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT SUM(LEAST(GREATEST(COALESCE(o.quantity, 0), 0), COALESCE(st.done, 0)))::numeric
        FROM public.orders o
        LEFT JOIN LATERAL (
          SELECT MIN(LEAST(COALESCE(os.quantity_processed, 0), os.quantity_total)) AS done
            FROM public.order_stages os
           WHERE os.order_id = o.id AND COALESCE(os.quantity_total, 0) > 0
        ) st ON true
       WHERE o.sale_order_id = p_sale_order_id
         AND o.deleted_at IS NULL
         AND COALESCE(o.status, '') NOT IN ('Cancelada', 'Cancelado', 'cancelled', 'Rascunho')
    )
    / NULLIF((
      SELECT SUM(GREATEST(0, COALESCE(soi.quantity, 0)))
        FROM public.sale_order_items soi
       WHERE soi.sale_order_id = p_sale_order_id
         AND soi.production_excluded_at IS NULL
    ), 0),
    0::numeric
  );
$function$;

COMMENT ON FUNCTION public.production_sequence_close_score(uuid) IS
  'Avanço do PV = pares que já passaram por todas as etapas das OPs ÷ pares do PV (0..1). Antes media só "% de pares com OP", o que punia o PV com cabedal complexo no prestador.';

CREATE OR REPLACE FUNCTION public.production_motor_item_class(p_reference_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN cardinality(public.atelier_reference_street_sectors(p_reference_id)) > 0
              THEN 'complexo' ELSE 'simples' END;
$function$;

-- ─── Ordem única ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.production_motor_order()
RETURNS TABLE(
  order_key uuid, order_id uuid, sale_order_id uuid, sale_order_item_id uuid,
  is_virtual boolean, item_class text, reference_id uuid, reference_code text,
  color text, pairs integer, due_date date, billing_anchor date, is_urgent boolean,
  pv_progress numeric, interleave_key numeric, pinned_position integer,
  is_frozen boolean, motor_position integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH live AS (
    SELECT o.id AS order_key, o.id AS order_id, o.sale_order_id, o.sale_order_item_id,
           false AS is_virtual, o.reference_id, o.color,
           GREATEST(COALESCE(o.quantity, 0), 0)::int AS pairs,
           q.due_date, q.pinned_position, q.sequence_frozen_position,
           o.sequence_frozen_at, o.created_at
      FROM public.production_queue q
      JOIN public.orders o ON o.id = q.order_id
      LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
     WHERE o.deleted_at IS NULL
       AND (so.id IS NULL OR so.deleted_at IS NULL)
       AND COALESCE(o.status, '') NOT IN (
         'Cancelada', 'Cancelado', 'cancelled',
         'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
         'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
         'Faturado', 'Rascunho'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.sale_order_items qi
          WHERE qi.id = o.sale_order_item_id AND qi.production_excluded_at IS NOT NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.technical_sheets qs
          WHERE qs.id = o.reference_id AND qs.retired_at IS NOT NULL
       )
  ),
  virt AS (
    SELECT soi.id AS order_key, NULL::uuid AS order_id, so.id AS sale_order_id, soi.id AS sale_order_item_id,
           true AS is_virtual, soi.reference_id, soi.color,
           GREATEST(COALESCE(soi.quantity, 0), 0)::int AS pairs,
           COALESCE(so.delivery_deadline, public.cabedal_prep_billing_start(so.billing_week)) AS due_date,
           NULL::int AS pinned_position, NULL::int AS sequence_frozen_position,
           NULL::timestamptz AS sequence_frozen_at, soi.created_at
      FROM public.sale_order_items soi
      JOIN public.sale_orders so ON so.id = soi.sale_order_id
     WHERE so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
       AND soi.production_excluded_at IS NULL
       AND COALESCE(soi.quantity, 0) > 0
       AND EXISTS (
         SELECT 1 FROM public.cabedal_prep_jobs j
          WHERE j.sale_order_item_id = soi.id AND j.pipeline_status <> 'cancelled'
       )
       AND cardinality(public.atelier_reference_street_sectors(soi.reference_id)) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.orders o
          WHERE o.sale_order_item_id = soi.id
            AND o.deleted_at IS NULL
            AND COALESCE(o.status, '') NOT IN ('Cancelada', 'Cancelado', 'cancelled')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.technical_sheets qs
          WHERE qs.id = soi.reference_id AND qs.retired_at IS NOT NULL
       )
  ),
  allr AS (
    SELECT * FROM live
    UNION ALL
    SELECT * FROM virt
  ),
  pv AS (
    SELECT so.id,
           so.order_number,
           COALESCE(public.cabedal_prep_billing_start(so.billing_week), so.delivery_deadline) AS anchor,
           (lower(btrim(COALESCE(so.order_type, ''))) = 'urgente') AS is_urgent,
           ROUND(public.production_sequence_close_score(so.id), 1) AS progress
      FROM public.sale_orders so
     WHERE so.id IN (SELECT DISTINCT a.sale_order_id FROM allr a WHERE a.sale_order_id IS NOT NULL)
  ),
  enr AS (
    SELECT a.*,
           ts.code AS reference_code,
           public.production_motor_item_class(a.reference_id) AS item_class,
           COALESCE(pv.anchor, a.due_date) AS billing_anchor,
           COALESCE(pv.is_urgent, false) AS is_urgent,
           COALESCE(pv.progress, 0) AS pv_progress,
           pv.order_number AS pv_number
      FROM allr a
      LEFT JOIN pv ON pv.id = a.sale_order_id
      LEFT JOIN public.technical_sheets ts ON ts.id = a.reference_id
  ),
  cum AS (
    SELECT e.*,
           (SUM(e.pairs) OVER w - e.pairs / 2.0)
             / NULLIF(SUM(e.pairs) OVER (PARTITION BY e.billing_anchor, e.pv_progress, e.item_class), 0)
             AS interleave_key
      FROM enr e
    WINDOW w AS (
      PARTITION BY e.billing_anchor, e.pv_progress, e.item_class
      ORDER BY e.pv_number NULLS LAST, lower(btrim(COALESCE(e.color, ''))),
               lower(btrim(COALESCE(e.reference_code, ''))), e.created_at, e.order_key
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )
  )
  SELECT c.order_key, c.order_id, c.sale_order_id, c.sale_order_item_id, c.is_virtual,
         c.item_class, c.reference_id, c.reference_code, c.color, c.pairs, c.due_date,
         c.billing_anchor, c.is_urgent, c.pv_progress, c.interleave_key,
         c.pinned_position, (c.sequence_frozen_at IS NOT NULL),
         row_number() OVER (
           ORDER BY (c.pinned_position IS NULL), c.pinned_position,
                    CASE WHEN c.sequence_frozen_at IS NOT NULL THEN 0 ELSE 1 END,
                    COALESCE(c.sequence_frozen_position, 2147483647),
                    CASE WHEN c.is_urgent THEN 0 ELSE 1 END,
                    c.billing_anchor NULLS LAST,
                    c.pv_progress DESC,
                    c.interleave_key NULLS LAST,
                    lower(btrim(COALESCE(c.color, ''))),
                    lower(btrim(COALESCE(c.reference_code, ''))),
                    c.created_at, c.order_key
         )::int AS motor_position
    FROM cum c;
$function$;

COMMENT ON FUNCTION public.production_motor_order() IS
  'Ordem única do motor: pin → congelado → urgente → semana de faturamento → avanço do PV → intercala complexo/simples por pares → cor → ref. Inclui item complexo ainda no prestador (is_virtual).';

REVOKE ALL ON FUNCTION public.production_motor_order() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.production_motor_item_class(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.production_motor_order() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_motor_item_class(uuid) TO authenticated, service_role;

-- ─── Agenda: capacidade finita com retorno do prestador, material e ordem única ─
CREATE OR REPLACE FUNCTION public.recompute_production_schedule_impl_249(p_triggered_by text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_forecast int := 0;
  v_gate_flow int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('recompute_production_schedule'));

  DELETE FROM public.production_queue queue_row
   WHERE NOT EXISTS (
           SELECT 1
             FROM public.orders queue_order
            WHERE queue_order.id = queue_row.order_id
         )
      OR EXISTS (
           SELECT 1
             FROM public.orders queue_order
            WHERE queue_order.id = queue_row.order_id
              AND (
                queue_order.deleted_at IS NOT NULL
                OR COALESCE(queue_order.status, '') IN (
                  'Cancelada', 'Cancelado', 'cancelled',
                  'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
                  'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
                  'Faturado', 'Rascunho'
                )
                OR EXISTS (
                  SELECT 1
                    FROM public.sale_order_items stale_item
                   WHERE stale_item.id = queue_order.sale_order_item_id
                     AND stale_item.production_excluded_at IS NOT NULL
                )
                OR EXISTS (
                  SELECT 1
                    FROM public.technical_sheets stale_sheet
                   WHERE stale_sheet.id = queue_order.reference_id
                     AND stale_sheet.retired_at IS NOT NULL
                )
              )
         );

  SELECT ss.flow_order INTO v_gate_flow
    FROM public.sector_settings ss
   WHERE ss.sector = COALESCE((SELECT s.motor_cabedal_gate_sector FROM public.atelier_settings s WHERE s.id = 1), 'Montagem');
  v_gate_flow := COALESCE(v_gate_flow, 80);

  -- 1. Ordem única (OPs na fila + itens complexos ainda no prestador)
  DROP TABLE IF EXISTS _rq_queue;
  CREATE TEMP TABLE _rq_queue ON COMMIT DROP AS
  SELECT m.order_key AS order_id, m.order_id AS real_order_id, m.due_date,
         m.motor_position AS prio, m.is_virtual, m.sale_order_id, m.sale_order_item_id,
         m.item_class, m.reference_id, m.pairs, m.billing_anchor, m.is_urgent, m.pv_progress,
         public.atelier_reference_street_sectors(m.reference_id) AS street
    FROM public.production_motor_order() m;

  SELECT count(*) INTO v_queue_size FROM _rq_queue WHERE NOT is_virtual;

  -- 2. Retorno previsto do prestador por item (máximo dos serviços abertos)
  DROP TABLE IF EXISTS _rq_cab;
  CREATE TEMP TABLE _rq_cab ON COMMIT DROP AS
  SELECT e.sale_order_item_id, MAX(e.expected_return) AS cab_ready
    FROM public.atelier_jobs_expected_dates() e
   WHERE NOT e.returned
     AND e.sale_order_item_id IN (SELECT q.sale_order_item_id FROM _rq_queue q WHERE q.item_class = 'complexo')
   GROUP BY e.sale_order_item_id;

  -- 3. Chegada prevista do material que falta (empenho com quantity_short)
  DROP TABLE IF EXISTS _rq_short;
  CREATE TEMP TABLE _rq_short ON COMMIT DROP AS
  SELECT DISTINCT q.order_id, mr.product_id, mr.sale_order_id,
         (COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade') AS is_sole
    FROM _rq_queue q
    JOIN public.material_reservations mr
      ON mr.order_id = q.real_order_id
   WHERE NOT q.is_virtual
     AND mr.status IN ('reserved', 'partially_consumed')
     AND COALESCE(mr.quantity_short, 0) > 0;

  -- Empenho no nível do PV (sem OP): vale para o item que consome o produto.
  IF EXISTS (
    SELECT 1 FROM public.material_reservations mr
     WHERE mr.order_id IS NULL
       AND mr.sale_order_id IN (SELECT DISTINCT q.sale_order_id FROM _rq_queue q)
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.quantity_short, 0) > 0
  ) THEN
    INSERT INTO _rq_short (order_id, product_id, sale_order_id, is_sole)
    SELECT DISTINCT q.order_id, mr.product_id, mr.sale_order_id,
           (COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade')
      FROM (
        SELECT DISTINCT s.id AS sale_order_id
          FROM public.material_reservations mr2
          JOIN public.sale_orders s ON s.id = mr2.sale_order_id
         WHERE mr2.order_id IS NULL
           AND mr2.sale_order_id IN (SELECT DISTINCT q2.sale_order_id FROM _rq_queue q2)
           AND mr2.status IN ('reserved', 'partially_consumed')
           AND COALESCE(mr2.quantity_short, 0) > 0
      ) pvs
      CROSS JOIN LATERAL public.sale_order_material_demand_lines(pvs.sale_order_id) d
      JOIN _rq_queue q ON q.sale_order_item_id = d.sale_order_item_id
      JOIN public.material_reservations mr
        ON mr.order_id IS NULL
       AND mr.sale_order_id = pvs.sale_order_id
       AND mr.product_id = d.product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.quantity_short, 0) > 0;
  END IF;

  DROP TABLE IF EXISTS _rq_eta;
  CREATE TEMP TABLE _rq_eta ON COMMIT DROP AS
  SELECT p.product_id, p.sale_order_id, public.motor_material_eta(p.product_id, p.sale_order_id) AS eta
    FROM (SELECT DISTINCT product_id, sale_order_id FROM _rq_short) p;

  DROP TABLE IF EXISTS _rq_gate;
  CREATE TEMP TABLE _rq_gate ON COMMIT DROP AS
  SELECT q.order_id,
         c.cab_ready,
         (SELECT MAX(e.eta) FROM _rq_short s JOIN _rq_eta e
             ON e.product_id = s.product_id AND e.sale_order_id IS NOT DISTINCT FROM s.sale_order_id
           WHERE s.order_id = q.order_id AND NOT s.is_sole) AS mat_eta,
         (SELECT MAX(e.eta) FROM _rq_short s JOIN _rq_eta e
             ON e.product_id = s.product_id AND e.sale_order_id IS NOT DISTINCT FROM s.sale_order_id
           WHERE s.order_id = q.order_id AND s.is_sole) AS sole_eta,
         (q.is_virtual OR NOT EXISTS (
            SELECT 1 FROM public.order_stages os
             WHERE os.order_id = q.real_order_id AND COALESCE(os.quantity_processed, 0) > 0
               AND os.stage_name NOT IN ('Corte Cabedal', 'Costura Cabedal', 'Aviamento')
         )) AS not_started
    FROM _rq_queue q
    LEFT JOIN _rq_cab c ON c.sale_order_item_id = q.sale_order_item_id AND q.item_class = 'complexo';

  -- 4. Trabalho por setor
  DROP TABLE IF EXISTS _rq_work;
  CREATE TEMP TABLE _rq_work ON COMMIT DROP AS
  WITH ficha AS (
    SELECT DISTINCT ON (q.order_id)
           q.order_id,
           ts.production_sectors,
           ts.sewing_capacity_per_day, ts.cutting_capacity_per_day,
           ts.mesa_daily_capacity, ts.costura_capacity_per_day,
           ts.silk_capacity_per_day, ts.gluing_capacity_per_day,
           ts.assembly_capacity_per_day, ts.soling_capacity_per_day,
           ts.finishing_capacity_per_day, ts.expedition_capacity_per_day
    FROM _rq_queue q
    JOIN technical_sheets ts ON ts.id = q.reference_id
    ORDER BY q.order_id, ts.updated_at DESC
  ),
  base AS (
    SELECT os.order_id,
           CASE WHEN os.stage_name = 'Mesa' THEN 'Aviamento' ELSE os.stage_name END AS sector,
           GREATEST(0, os.quantity_total - COALESCE(os.quantity_processed, 0)) AS remaining,
           COALESCE(os.quantity_processed, 0) AS processed,
           os.status AS stage_status
    FROM order_stages os
    WHERE os.order_id IN (SELECT order_id FROM _rq_queue WHERE NOT is_virtual)
    UNION ALL
    -- item complexo ainda no prestador: etapas que a OP terá quando nascer
    SELECT q.order_id, ss.sector, q.pairs, 0, 'previsto'
      FROM _rq_queue q
      CROSS JOIN sector_settings ss
     WHERE q.is_virtual
  ),
  enriched AS (
    SELECT b.order_id, b.sector, b.remaining, b.processed,
           ss.flow_order, ss.parallel_group,
           COALESCE(ss.start_offset_days, 0) AS start_offset_days,
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
           END AS included,
           -- Ateliê: setor feito fora (ou no corte do lote) não ocupa a fábrica
           (q.item_class = 'complexo' AND (
              b.sector = 'Corte Cabedal'
              OR (b.sector = 'Costura Cabedal' AND 'costura_cabedal' = ANY (q.street))
              OR (b.sector = 'Aviamento' AND 'aviamento' = ANY (q.street))
           )) AS atelier_sector,
           GREATEST(
             CASE WHEN q.is_virtual THEN gt.cab_ready
                  WHEN q.item_class = 'complexo' AND ss.flow_order >= v_gate_flow THEN gt.cab_ready
             END,
             CASE WHEN gt.not_started THEN gt.mat_eta END,
             CASE WHEN b.sector = 'Solagem' THEN gt.sole_eta END
           ) AS earliest
    FROM base b
    JOIN _rq_queue q ON q.order_id = b.order_id
    JOIN _rq_gate gt ON gt.order_id = b.order_id
    JOIN sector_settings ss ON ss.sector = b.sector
    LEFT JOIN (
      SELECT parallel_group, MIN(flow_order) AS grp_order
      FROM sector_settings WHERE parallel_group IS NOT NULL GROUP BY 1
    ) g ON g.parallel_group = ss.parallel_group
    LEFT JOIN ficha f ON f.order_id = b.order_id
    WHERE b.stage_status <> 'concluido'
  ),
  leveled AS (
    SELECT e.*, q.prio, q.due_date, q.is_virtual,
           dense_rank() OVER (
             PARTITION BY e.order_id ORDER BY e.lvl_key
           ) AS level
    FROM enriched e
    JOIN _rq_queue q ON q.order_id = e.order_id
    WHERE e.included AND NOT e.atelier_sector
  )
  SELECT l.*,
         GREATEST(COALESCE(l.ficha_rate, l.global_rate), 1)::numeric AS rate,
         (l.ficha_rate IS NOT NULL) AS is_ficha_override,
         (SELECT MAX(l2.level) FROM leveled l2
           WHERE l2.order_id = l.order_id AND l2.level < l.level) AS prev_level,
         l.remaining AS remaining_alloc,
         0::int AS alloc_cum
  FROM leveled l;

  DROP TABLE IF EXISTS _rq_today_done;
  CREATE TEMP TABLE _rq_today_done ON COMMIT DROP AS
  SELECT pp.order_id,
         CASE WHEN pp.stage_name = 'Mesa' THEN 'Aviamento' ELSE pp.stage_name END AS sector,
         GREATEST(0, SUM(pp.quantity))::int AS done_today
  FROM production_pointings pp
  WHERE (pp.created_at AT TIME ZONE 'America/Sao_Paulo')::date = v_today
  GROUP BY 1, 2
  HAVING GREATEST(0, SUM(pp.quantity)) > 0;

  DROP TABLE IF EXISTS _rq_today_frac;
  CREATE TEMP TABLE _rq_today_frac ON COMMIT DROP AS
  SELECT t.sector,
         LEAST(1.0, SUM(t.done_today::numeric
                        / COALESCE(w.rate, GREATEST(ss.daily_capacity_pairs, 1)::numeric))) AS f_used
  FROM _rq_today_done t
  JOIN sector_settings ss ON ss.sector = t.sector
  LEFT JOIN _rq_work w ON w.order_id = t.order_id AND w.sector = t.sector
  GROUP BY t.sector;

  DROP TABLE IF EXISTS _rq_alloc;
  CREATE TEMP TABLE _rq_alloc (
    order_id uuid, sector text, date date, pairs int, frac numeric, is_ficha_override boolean
  ) ON COMMIT DROP;

  v_day := v_today;
  WHILE EXISTS (SELECT 1 FROM _rq_work WHERE remaining_alloc > 0) LOOP
    v_guard := v_guard + 1;
    EXIT WHEN v_guard > 500;

    IF public.is_business_day(v_day) THEN
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
        IF v_day = v_today THEN
          v_f_left := GREATEST(0, 1.0 - COALESCE(
            (SELECT f.f_used FROM _rq_today_frac f WHERE f.sector = v_sector.sector), 0));
        ELSE
          v_f_left := 1.0;
        END IF;

        FOR v_row IN
          SELECT w.* FROM _rq_work w
          WHERE w.sector = v_sector.sector AND w.remaining_alloc > 0
            AND (w.earliest IS NULL OR w.earliest <= v_day)
          ORDER BY w.prio
        LOOP
          EXIT WHEN v_f_left <= 0.001;

          IF v_row.prev_level IS NULL OR COALESCE(v_row.start_offset_days, 0) > 0 THEN
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

      -- Sem progresso e ninguém esperando data futura (retorno/material) → fim.
      EXIT WHEN v_progress = 0 AND v_day > v_today
        AND NOT EXISTS (
          SELECT 1 FROM _rq_work w
           WHERE w.remaining_alloc > 0 AND w.earliest IS NOT NULL AND w.earliest > v_day
        );
    END IF;

    v_day := v_day + 1;
  END LOOP;

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

  DELETE FROM production_schedule WHERE date >= v_today;

  INSERT INTO production_schedule
    (recalc_run_id, order_id, sector, date, planned_pairs, carryover_pairs,
     capacity_source, day_fraction)
  SELECT v_run, a.order_id, a.sector, a.date, a.pairs,
         LEAST(a.pairs, GREATEST(0, COALESCE(b.backlog, 0) - COALESCE(prev.cum_before, 0)))::int,
         CASE WHEN a.is_ficha_override THEN 'ficha_override' ELSE 'global' END,
         ROUND(a.frac, 6)
  FROM _rq_out a
  JOIN _rq_queue q ON q.order_id = a.order_id AND NOT q.is_virtual
  LEFT JOIN _rq_backlog b ON b.order_id = a.order_id AND b.sector = a.sector
  LEFT JOIN LATERAL (
    SELECT SUM(a2.pairs)::int AS cum_before FROM _rq_out a2
    WHERE a2.order_id = a.order_id AND a2.sector = a.sector AND a2.date < a.date
  ) prev ON true
  WHERE a.pairs > 0;

  SELECT COALESCE(SUM(a.pairs), 0) INTO v_scheduled
    FROM _rq_out a JOIN _rq_queue q ON q.order_id = a.order_id AND NOT q.is_virtual;

  -- Previsão do complexo no prestador (capacidade reservada, sem OP)
  DELETE FROM public.production_motor_forecast;
  INSERT INTO public.production_motor_forecast
    (recalc_run_id, sale_order_item_id, sale_order_id, sector, date, planned_pairs)
  SELECT v_run, q.sale_order_item_id, q.sale_order_id, a.sector, a.date, a.pairs
    FROM _rq_out a
    JOIN _rq_queue q ON q.order_id = a.order_id AND q.is_virtual
   WHERE a.pairs > 0;
  GET DIAGNOSTICS v_forecast = ROW_COUNT;

  -- Estado do motor (ordem, classe, espera) para Sequência, Kanban e Gestão
  DELETE FROM public.production_motor_state;
  INSERT INTO public.production_motor_state (
    order_key, order_id, sale_order_id, sale_order_item_id, is_virtual, item_class,
    billing_anchor, is_urgent, pv_progress, motor_position, pairs,
    earliest_start, cabedal_expected_return, material_eta, wait_reason,
    projected_completion, recalc_run_id, computed_at
  )
  SELECT q.order_id, q.real_order_id, q.sale_order_id, q.sale_order_item_id, q.is_virtual, q.item_class,
         q.billing_anchor, q.is_urgent, q.pv_progress, q.prio, q.pairs,
         GREATEST(
           CASE WHEN q.item_class = 'complexo' THEN g.cab_ready END,
           CASE WHEN g.not_started THEN g.mat_eta END
         ),
         g.cab_ready,
         CASE WHEN g.not_started THEN g.mat_eta END,
         CASE
           WHEN q.item_class = 'complexo' AND g.cab_ready IS NOT NULL AND g.cab_ready > v_today
             THEN 'aguardando_prestador'
           WHEN g.not_started AND g.mat_eta IS NOT NULL AND g.mat_eta > v_today
             THEN 'aguardando_material'
           WHEN g.sole_eta IS NOT NULL AND g.sole_eta > v_today
             THEN 'aguardando_solado'
         END,
         (SELECT MAX(a.date) FROM _rq_out a WHERE a.order_id = q.order_id),
         v_run, now()
    FROM _rq_queue q
    JOIN _rq_gate g ON g.order_id = q.order_id;

  -- Prioridade das OCs em rascunho acompanha a agenda (nunca derruba o recálculo)
  BEGIN
    PERFORM public.refresh_purchase_order_motor_priority();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[recompute] prioridade de OC não atualizada: %', SQLERRM;
  END;

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
    'forecast_rows', v_forecast,
    'horizon_end', (SELECT MAX(date) FROM _rq_out),
    'duration_ms', (EXTRACT(EPOCH FROM clock_timestamp() - v_t0) * 1000)::int
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_production_schedule_impl_249(text) FROM PUBLIC, anon, authenticated;

-- ─── Sequência oficial (tela Sequência) lê a ordem única ────────────────────
DROP FUNCTION IF EXISTS public.list_production_sequence();
CREATE FUNCTION public.list_production_sequence()
 RETURNS TABLE(
   order_id uuid, sale_order_id uuid, sale_order_item_id uuid, order_number text,
   color text, reference_code text, due_date date, pinned_position integer,
   close_score numeric, sequence_position integer, is_pinned boolean, is_frozen boolean,
   sequence_frozen_at timestamp with time zone, block_reason text,
   item_class text, billing_anchor date, is_urgent boolean,
   earliest_start date, wait_reason text, projected_completion date
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    o.id AS order_id,
    o.sale_order_id,
    o.sale_order_item_id,
    o.order_number,
    o.color,
    ts.code AS reference_code,
    q.due_date,
    q.pinned_position,
    m.pv_progress AS close_score,
    row_number() OVER (ORDER BY m.motor_position)::integer AS sequence_position,
    (q.pinned_position IS NOT NULL) AS is_pinned,
    (o.sequence_frozen_at IS NOT NULL) AS is_frozen,
    o.sequence_frozen_at,
    CASE
      WHEN q.pinned_position IS NOT NULL THEN NULL
      WHEN public.cabedal_motor_is_enabled()
           AND h.status = 'aguardando_material' THEN 'Aguardando material'
      WHEN public.cabedal_motor_is_enabled()
           AND h.status = 'aguardando_cabedal'
           AND NOT public.cabedal_motor_corte_released(o.sale_order_item_id) THEN 'Aguardando cabedal'
      ELSE COALESCE(
        public.sale_order_item_factory_gate_block_reason(o.sale_order_item_id),
        CASE st.wait_reason
          WHEN 'aguardando_prestador' THEN 'Aguardando prestador · volta ' || to_char(st.cabedal_expected_return, 'DD/MM')
          WHEN 'aguardando_material' THEN 'Aguardando material · chega ' || to_char(st.material_eta, 'DD/MM')
        END
      )
    END AS block_reason,
    m.item_class,
    m.billing_anchor,
    m.is_urgent,
    st.earliest_start,
    st.wait_reason,
    st.projected_completion
  FROM public.production_motor_order() m
  JOIN public.production_queue q ON q.order_id = m.order_id
  JOIN public.orders o ON o.id = m.order_id
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  LEFT JOIN public.cabedal_motor_item_holds h ON h.sale_order_item_id = o.sale_order_item_id
  LEFT JOIN public.production_motor_state st ON st.order_key = o.id
  WHERE NOT m.is_virtual
    AND public.is_approved_user();
$function$;

REVOKE ALL ON FUNCTION public.list_production_sequence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_production_sequence() TO authenticated, service_role;

-- ─── Plano do motor para Gestão / relatórios (OP + complexo previsto) ───────
CREATE OR REPLACE VIEW public.v_production_motor_plan
WITH (security_invoker = true) AS
SELECT st.order_key,
       st.order_id,
       o.order_number,
       st.sale_order_id,
       so.order_number AS sale_order_number,
       st.sale_order_item_id,
       COALESCE(NULLIF(btrim(ts.code), ''), ts.name) AS reference_code,
       COALESCE(o.color, soi.color) AS color,
       st.pairs,
       st.is_virtual,
       st.item_class,
       st.billing_anchor,
       so.billing_week,
       st.is_urgent,
       st.pv_progress,
       st.motor_position,
       st.earliest_start,
       st.cabedal_expected_return,
       st.material_eta,
       st.wait_reason,
       st.projected_completion,
       CASE WHEN st.billing_anchor IS NOT NULL AND st.projected_completion IS NOT NULL
            THEN st.projected_completion - st.billing_anchor END AS days_vs_billing,
       st.computed_at
  FROM public.production_motor_state st
  LEFT JOIN public.orders o ON o.id = st.order_id
  LEFT JOIN public.sale_orders so ON so.id = st.sale_order_id
  LEFT JOIN public.sale_order_items soi ON soi.id = st.sale_order_item_id
  LEFT JOIN public.technical_sheets ts ON ts.id = COALESCE(o.reference_id, soi.reference_id);

COMMENT ON VIEW public.v_production_motor_plan IS
  'Plano do motor por OP e por item de cabedal complexo ainda no prestador: posição, classe (complexo/simples), semana de faturamento, espera (aguardando_prestador/material/solado), retorno previsto e fim previsto.';
REVOKE ALL ON public.v_production_motor_plan FROM anon;
GRANT SELECT ON public.v_production_motor_plan TO authenticated, service_role;

-- ─── Kanban/Gestão: queue_position segue a ordem única ──────────────────────
-- Só troca o início do ORDER BY da janela de queue_position; o resto da view
-- (mantida pela tela de Gestão) fica igual.
DO $view$
DECLARE
  v_def text := pg_get_viewdef('public.v_production_queue_detail'::regclass, false);
  v_old text := 'row_number() OVER (ORDER BY (q.pinned_position IS NULL), q.pinned_position,';
  v_new text := 'row_number() OVER (ORDER BY (SELECT ms.motor_position FROM production_motor_state ms WHERE ms.order_key = q.order_id), (q.pinned_position IS NULL), q.pinned_position,';
BEGIN
  IF strpos(v_def, 'production_motor_state') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'v_production_queue_detail: âncora do queue_position não encontrada';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_production_queue_detail WITH (security_invoker = true) AS '
          || replace(v_def, v_old, v_new);
END
$view$;
