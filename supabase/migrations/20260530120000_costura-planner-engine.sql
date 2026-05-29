-- Costura Planner Engine
-- Aplica via MCP em 7 partes em 2026-05-29.
--
-- Adiciona:
--  1. production_settings (singleton) — capacidade global de Costura da fábrica
--  2. Estende notifications com dedupe_key/resolved_at/category/severity/payload/link
--  3. View v_costura_backlog_30d — OPs aguardando Costura nos próximos 30 dias
--  4. View v_costura_capacity_plan — ocupação diária vs capacidade
--  5. Função suggest_pv_deadline(uuid) — deadline explicável no cadastro do PV
--  6. Função plan_costura_dispatch(int) — candidatas pra terceirização
--  7. Função notify_costura_overflow() — upsert/resolve de notifications
--  8. Triggers em sale_orders e service_orders + cron diário

-- ============================================================================
-- PART 1: production_settings + notifications extension
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.production_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  costura_pairs_per_day_total int NOT NULL DEFAULT 1500,
  costura_overflow_tolerance_pct numeric NOT NULL DEFAULT 0.10,
  costura_dispatch_horizon_days int NOT NULL DEFAULT 30,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO public.production_settings(id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.production_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read production_settings" ON public.production_settings;
CREATE POLICY "Authenticated can read production_settings"
  ON public.production_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Approved can update production_settings" ON public.production_settings;
CREATE POLICY "Approved can update production_settings"
  ON public.production_settings FOR UPDATE TO authenticated
  USING (is_approved_user()) WITH CHECK (is_approved_user());

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS link text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS payload jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_unresolved_idx
  ON public.notifications(dedupe_key) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_category_idx
  ON public.notifications(category) WHERE resolved_at IS NULL;

-- ============================================================================
-- PART 2: v_costura_backlog_30d
-- ============================================================================

-- COST-1: dedupe — uma onda ativa por OP via LATERAL (era join 1->N com v_wave_orders)
-- COST-2: exclui ondas cancelled/finished
-- COST-3: filtra etapas concluídas por status (completed_at quase nunca preenchido)
-- COST-4: in_service_order usa COALESCE(NULLIF(target_sector,''),'costura')
CREATE OR REPLACE VIEW public.v_costura_backlog_30d AS
WITH costura_stages AS (
  SELECT
    os.order_id,
    o.sale_order_id,
    o.reference_id,
    o.color,
    o.quantity,
    o.planned_delivery,
    o.status AS order_status,
    so.order_number AS sale_order_number,
    so.delivery_deadline AS sale_order_deadline,
    wave.wave_id,
    wave.costura_start_date AS wave_costura_start
  FROM public.order_stages os
  JOIN public.orders o ON o.id = os.order_id
  LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
  LEFT JOIN LATERAL (
    SELECT pwo.wave_id, pw.costura_start_date
    FROM public.v_wave_orders pwo
    JOIN public.production_waves pw ON pw.id = pwo.wave_id
    WHERE pwo.sale_order_id = o.sale_order_id
      AND pw.status NOT IN ('cancelled', 'finished')
    ORDER BY pw.costura_start_date NULLS LAST
    LIMIT 1
  ) wave ON true
  WHERE os.stage_name = 'Costura'
    AND COALESCE(os.status, '') NOT IN ('concluido', 'concluído', 'completed')
    AND o.status IN ('Em Produção', 'Reservado')
)
SELECT
  cs.order_id,
  cs.sale_order_id,
  cs.sale_order_number,
  cs.sale_order_deadline,
  cs.reference_id,
  cs.color,
  cs.quantity,
  cs.wave_id,
  GREATEST(
    CURRENT_DATE,
    COALESCE(
      cs.wave_costura_start,
      public.add_business_days(cs.planned_delivery, -7),
      CURRENT_DATE
    )
  )::date AS needed_date,
  EXISTS (
    SELECT 1 FROM public.material_reservations mr
    WHERE mr.order_id = cs.order_id AND mr.status = 'reserved'
  ) AS material_ready,
  EXISTS (
    SELECT 1 FROM public.service_orders sso
    WHERE sso.order_id = cs.order_id
      AND COALESCE(NULLIF(sso.target_sector, ''), 'costura') = 'costura'
      AND sso.status NOT IN ('received', 'Concluído', 'concluido', 'Cancelado', 'cancelled', 'cancelado')
  ) AS in_service_order
FROM costura_stages cs
WHERE GREATEST(
  CURRENT_DATE,
  COALESCE(cs.wave_costura_start, public.add_business_days(cs.planned_delivery, -7), CURRENT_DATE)
) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';

ALTER VIEW public.v_costura_backlog_30d SET (security_invoker = true);
GRANT SELECT ON public.v_costura_backlog_30d TO authenticated;

-- ============================================================================
-- PART 3: v_costura_capacity_plan
-- ============================================================================

CREATE OR REPLACE VIEW public.v_costura_capacity_plan AS
WITH settings AS (
  SELECT
    costura_pairs_per_day_total AS capacity_total,
    costura_overflow_tolerance_pct AS tolerance_pct
  FROM public.production_settings WHERE id = true
),
days AS (
  SELECT (CURRENT_DATE + (n || ' days')::interval)::date AS day
  FROM generate_series(0, 30) n
),
backlog_per_day AS (
  SELECT
    needed_date AS day,
    COALESCE(SUM(quantity) FILTER (WHERE NOT in_service_order), 0) AS sum_internal,
    COALESCE(SUM(quantity) FILTER (WHERE in_service_order), 0) AS sum_outsourced
  FROM public.v_costura_backlog_30d
  GROUP BY needed_date
)
SELECT
  d.day,
  EXTRACT(ISODOW FROM d.day)::int AS dow,
  EXTRACT(ISODOW FROM d.day)::int IN (6, 7) AS is_weekend,
  COALESCE(b.sum_internal, 0)::int AS sum_pairs_internal,
  COALESCE(b.sum_outsourced, 0)::int AS sum_pairs_outsourced,
  s.capacity_total,
  GREATEST(0, COALESCE(b.sum_internal, 0) - s.capacity_total)::int AS overflow_pairs,
  CASE
    WHEN s.capacity_total > 0
    THEN ROUND(100.0 * COALESCE(b.sum_internal, 0) / s.capacity_total, 1)
    ELSE 0
  END AS occupation_pct,
  CASE
    WHEN EXTRACT(ISODOW FROM d.day) IN (6, 7) THEN 'weekend'
    WHEN COALESCE(b.sum_internal, 0) > s.capacity_total THEN 'overflow'
    WHEN COALESCE(b.sum_internal, 0) > s.capacity_total * (1 - s.tolerance_pct) THEN 'warning'
    ELSE 'ok'
  END AS status
FROM days d
CROSS JOIN settings s
LEFT JOIN backlog_per_day b ON b.day = d.day
ORDER BY d.day;

ALTER VIEW public.v_costura_capacity_plan SET (security_invoker = true);
GRANT SELECT ON public.v_costura_capacity_plan TO authenticated;

-- ============================================================================
-- PART 4: suggest_pv_deadline
-- ============================================================================

CREATE OR REPLACE FUNCTION public.suggest_pv_deadline(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suggested_date date;
  v_capacity int;
  v_load_30d int;
  v_overflow_days int;
  v_total_quantity int;
  v_missing jsonb := '[]'::jsonb;
  v_missing_count int := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_no_lead_count int := 0;
BEGIN
  v_suggested_date := public.compute_min_billing_date(p_sale_order_id);

  SELECT costura_pairs_per_day_total INTO v_capacity
  FROM public.production_settings WHERE id = true;

  SELECT COALESCE(SUM(quantity), 0)::int INTO v_load_30d
  FROM public.v_costura_backlog_30d;

  SELECT COUNT(*)::int INTO v_overflow_days
  FROM public.v_costura_capacity_plan
  WHERE status = 'overflow' AND NOT is_weekend;

  SELECT COALESCE(SUM(quantity), 0)::int INTO v_total_quantity
  FROM public.sale_order_items WHERE sale_order_id = p_sale_order_id;

  WITH agg AS (
    SELECT
      product_id,
      MIN(product_name) AS product_name,
      color,
      SUM(needed_qty) AS needed_qty,
      MIN(stock_qty) AS stock_qty,
      SUM(shortage) AS shortage,
      MIN(supplier_name) AS supplier_name,
      MIN(supplier_lead_time_days) AS supplier_lead_time_days,
      MIN(unit) AS unit
    FROM public.get_wave_material_needs(ARRAY[p_sale_order_id])
    WHERE shortage > 0
    GROUP BY product_id, color
  )
  SELECT
    COUNT(*)::int,
    COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY shortage DESC) FILTER (WHERE rn <= 20), '[]'::jsonb)
  INTO v_missing_count, v_missing
  FROM (SELECT *, row_number() OVER (ORDER BY shortage DESC) AS rn FROM agg) t;

  SELECT COUNT(*) FILTER (WHERE supplier_name IS NULL)
  INTO v_no_lead_count
  FROM (
    SELECT
      product_id,
      color,
      MIN(supplier_name) AS supplier_name
    FROM public.get_wave_material_needs(ARRAY[p_sale_order_id])
    WHERE shortage > 0
    GROUP BY product_id, color
  ) g;

  IF v_no_lead_count > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format('%s material(is) sem fornecedor cadastrado — usando 10 dias como estimativa', v_no_lead_count)
    );
  END IF;

  IF v_overflow_days > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      format('Costura tem %s dia(s) em overflow nos próximos 30 dias — capacidade atual: %s pares/dia', v_overflow_days, v_capacity)
    );
  END IF;

  IF v_suggested_date IS NULL THEN
    v_warnings := v_warnings || jsonb_build_array('Não foi possível calcular data sugerida — verifique se PV tem itens com ficha técnica');
  END IF;

  RETURN jsonb_build_object(
    'suggested_date', v_suggested_date,
    'sale_order_total_pairs', v_total_quantity,
    'capacity_per_day', v_capacity,
    'current_costura_load_30d', v_load_30d,
    'overflow_days_30d', v_overflow_days,
    'missing_materials_count', v_missing_count,
    'missing_materials', v_missing,
    'warnings', v_warnings,
    'computed_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.suggest_pv_deadline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suggest_pv_deadline(uuid) TO authenticated;

-- ============================================================================
-- PART 5: plan_costura_dispatch
-- ============================================================================

CREATE OR REPLACE FUNCTION public.plan_costura_dispatch(p_horizon_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_day_data jsonb;
  v_day record;
  v_orders jsonb;
  v_chosen_orders uuid[] := ARRAY[]::uuid[];
  v_remaining int;
BEGIN
  FOR v_day IN
    SELECT day, overflow_pairs
    FROM public.v_costura_capacity_plan
    WHERE status = 'overflow' AND NOT is_weekend
      AND day BETWEEN CURRENT_DATE AND CURRENT_DATE + (p_horizon_days || ' days')::interval
    ORDER BY day
  LOOP
    v_remaining := v_day.overflow_pairs;

    WITH candidates AS (
      SELECT
        b.order_id,
        b.sale_order_id,
        b.sale_order_number,
        b.sale_order_deadline,
        b.reference_id,
        b.color,
        b.quantity,
        b.needed_date,
        b.material_ready,
        o.order_number,
        o.planned_delivery,
        COALESCE(NULLIF(ts.model, ''), ts.name) AS sheet_name,
        SUM(b.quantity) OVER (ORDER BY b.sale_order_deadline NULLS LAST, b.needed_date
                              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
      FROM public.v_costura_backlog_30d b
      LEFT JOIN public.orders o ON o.id = b.order_id
      LEFT JOIN public.technical_sheets ts ON ts.id = b.reference_id
      WHERE b.needed_date = v_day.day
        AND NOT b.in_service_order
        AND NOT (b.order_id = ANY(v_chosen_orders))
      ORDER BY b.sale_order_deadline NULLS LAST, b.needed_date
    ),
    picked AS (
      SELECT * FROM candidates
      WHERE running_total - quantity < v_remaining
    )
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'order_id', order_id,
        'order_number', order_number,
        'sale_order_id', sale_order_id,
        'sale_order_number', sale_order_number,
        'sale_order_deadline', sale_order_deadline,
        'reference_id', reference_id,
        'sheet_name', sheet_name,
        'color', color,
        'quantity', quantity,
        'needed_date', needed_date,
        'planned_delivery', planned_delivery,
        'material_ready', material_ready,
        'pairs_per_day', NULL
      ) ORDER BY sale_order_deadline NULLS LAST, needed_date), '[]'::jsonb)
    INTO v_orders
    FROM picked;

    v_chosen_orders := v_chosen_orders || ARRAY(
      SELECT (x->>'order_id')::uuid FROM jsonb_array_elements(v_orders) x
    );

    v_day_data := jsonb_build_object(
      'day', v_day.day,
      'week_iso', date_trunc('week', v_day.day)::date,
      'overflow_pairs', v_day.overflow_pairs,
      'contributing_orders', v_orders,
      'covered_pairs', (
        SELECT COALESCE(SUM((x->>'quantity')::int), 0)
        FROM jsonb_array_elements(v_orders) x
      )
    );

    v_result := v_result || jsonb_build_array(v_day_data);
  END LOOP;

  RETURN jsonb_build_object(
    'horizon_days', p_horizon_days,
    'computed_at', now(),
    'overflow_days', v_result
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.plan_costura_dispatch(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_costura_dispatch(int) TO authenticated;

-- ============================================================================
-- PART 6: notify_costura_overflow
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_costura_overflow()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created int := 0;
  v_resolved int := 0;
  v_rc int := 0;
  v_day record;
  v_week_key text;
  v_severity text;
  v_message text;
  v_active_keys text[];
BEGIN
  FOR v_day IN
    SELECT
      date_trunc('week', day)::date AS week_start,
      SUM(overflow_pairs) AS week_overflow,
      COUNT(*) FILTER (WHERE status = 'overflow') AS overflow_days,
      MAX(occupation_pct) AS max_occupation
    FROM public.v_costura_capacity_plan
    WHERE status = 'overflow' AND NOT is_weekend
      AND day BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
    GROUP BY date_trunc('week', day)
  LOOP
    v_week_key := 'costura_overflow:' || to_char(v_day.week_start, 'IYYY-IW');
    v_active_keys := COALESCE(v_active_keys, ARRAY[]::text[]) || v_week_key;

    IF v_day.max_occupation >= 200 THEN
      v_severity := 'critical';
    ELSE
      v_severity := 'warning';
    END IF;

    v_message := format(
      'Costura em overflow na semana de %s: %s pares acima da capacidade em %s dia(s) — considere terceirizar.',
      to_char(v_day.week_start, 'DD/MM'),
      v_day.week_overflow,
      v_day.overflow_days
    );

    INSERT INTO public.notifications (
      message, sector, category, severity, dedupe_key, link, payload, read
    )
    VALUES (
      v_message,
      'Costura',
      'production',
      v_severity,
      v_week_key,
      '/pcp?tab=costura-planner',
      jsonb_build_object(
        'week_start', v_day.week_start,
        'overflow_pairs', v_day.week_overflow,
        'overflow_days', v_day.overflow_days,
        'max_occupation_pct', v_day.max_occupation
      ),
      false
    )
    ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL
    DO UPDATE SET
      message = EXCLUDED.message,
      severity = EXCLUDED.severity,
      payload = EXCLUDED.payload;

    GET DIAGNOSTICS v_rc = ROW_COUNT;
    v_created := v_created + v_rc;
  END LOOP;

  UPDATE public.notifications
  SET resolved_at = now()
  WHERE category = 'production'
    AND dedupe_key LIKE 'costura_overflow:%'
    AND resolved_at IS NULL
    AND dedupe_key <> ALL(COALESCE(v_active_keys, ARRAY[]::text[]));

  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object(
    'created_or_updated', v_created,
    'resolved', v_resolved,
    'active_keys', COALESCE(v_active_keys, ARRAY[]::text[])
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_costura_overflow() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_costura_overflow() TO authenticated;

-- ============================================================================
-- PART 7: Triggers + cron
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_costura_notify_on_so_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.notify_costura_overflow();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_costura_notify_on_so_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_costura_notify_on_so_insert ON public.sale_orders;
CREATE TRIGGER trg_costura_notify_on_so_insert
  AFTER INSERT ON public.sale_orders
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_costura_notify_on_so_insert();

CREATE OR REPLACE FUNCTION public.tg_costura_notify_on_so_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NULLIF(NEW.target_sector, ''), 'costura') = 'costura' THEN
    BEGIN
      PERFORM public.notify_costura_overflow();
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_costura_notify_on_so_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_costura_notify_on_so_change ON public.service_orders;
CREATE TRIGGER trg_costura_notify_on_so_change
  AFTER INSERT OR UPDATE OF status, target_sector ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_costura_notify_on_so_change();

DO $$
BEGIN
  PERFORM cron.unschedule('notify-costura-overflow-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'notify-costura-overflow-daily',
  '0 9 * * *',
  $$SELECT public.notify_costura_overflow();$$
);
