-- =============================================================================
-- 20260627140000 — FIX: detect_production_bottlenecks_and_alert usava coluna inexistente
-- =============================================================================
--
-- BUG: a função filtrava `AND ts.active = true`, mas `technical_sheets` NÃO tem
-- coluna `active` (tem `status`, cujos valores são 'Ativo'). Resultado: erro
-- "column ts.active does not exist" toda vez que o cron job 3
-- (detect-production-bottlenecks, 1×/min) rodava — desde a CRIAÇÃO do sistema de
-- alertas (20260620180000). O bug sobreviveu ao fix D1 da fórmula (20260627128000),
-- que corrigiu o lead_days mas manteve o predicado `ts.active`. Logo TODA a infra
-- de alertas (production_alerts / ProductionControlCenter / webhook WhatsApp) era
-- dead code: zero linhas inseridas, erro silencioso no log do Postgres.
--
-- FIX: trocar `ts.active = true` por `ts.status = 'Ativo'` (coluna que existe).
-- Mantém intacta a fórmula D1 (lead_days = dias úteis até o prazo). O webhook só
-- dispara se `alert_webhook_url` E `alert_phone_whatsapp` estiverem setados — hoje
-- a URL está vazia, então a função apenas POPULA production_alerts (sem WhatsApp).
CREATE OR REPLACE FUNCTION public.detect_production_bottlenecks_and_alert()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_alerts_created int := 0;
  v_alerts_notified int := 0;
  v_alerts_failed int := 0;
  v_webhook text;
  v_phone text;
  v_min_pct numeric;
  v_crit_pct numeric;
  v_alert RECORD;
  v_response_id bigint;
BEGIN
  SELECT (value #>> '{}')::numeric INTO v_min_pct
    FROM system_settings WHERE key='alert_min_load_pct';
  v_min_pct := COALESCE(v_min_pct, 105);

  SELECT (value #>> '{}')::numeric INTO v_crit_pct
    FROM system_settings WHERE key='alert_critical_load_pct';
  v_crit_pct := COALESCE(v_crit_pct, 130);

  SELECT (value #>> '{}') INTO v_webhook FROM system_settings WHERE key='alert_webhook_url';
  SELECT (value #>> '{}') INTO v_phone   FROM system_settings WHERE key='alert_phone_whatsapp';

  WITH op_sector_demand AS (
    SELECT
      o.id AS order_id,
      o.order_number,
      o.quantity,
      ts.id AS sheet_id,
      ts.name AS ref_name,
      o.color,
      sector.name AS sector_name,
      sector.capacity AS sector_capacity,
      GREATEST(1,
        COALESCE(
          (SELECT COUNT(*)::int FROM generate_series(
              CURRENT_DATE,
              GREATEST(CURRENT_DATE, COALESCE(o.due_date, so.delivery_deadline, CURRENT_DATE + 5)::date),
              interval '1 day'
            ) d
            WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)),
          5
        )
      ) AS lead_days,
      sector.capacity AS _cap
    FROM public.orders o
    LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    CROSS JOIN LATERAL (VALUES
      ('Corte Palmilha'::text,
       COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), 200)::numeric),
      ('Corte Forração',
       COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), 200)::numeric),
      ('Aviamento',
       COALESCE(NULLIF(ts.mesa_daily_capacity, 0), 200)::numeric),
      ('Costura',
       COALESCE(NULLIF(ts.costura_capacity_per_day, 0), 200)::numeric)
    ) AS sector(name, capacity)
    WHERE o.status NOT IN ('Finalizado','Faturado','Cancelado','Concluído','Pronto')
      AND ts.status = 'Ativo'
  )
  INSERT INTO public.production_alerts (alert_key, alert_type, severity, title, body, payload)
  SELECT
    'op_overload:' || order_id::text || ':' || sector_name AS alert_key,
    'op_overload' AS alert_type,
    CASE WHEN load_pct >= v_crit_pct THEN 'critical' ELSE 'warning' END AS severity,
    'Gargalo: ' || sector_name || ' · ' || ref_name AS title,
    'OP ' || order_number || ' (' || quantity || ' pares) precisa de ' ||
      ROUND(daily_needed, 0) || ' pares/dia em ' || lead_days || ' dia(s) úteis, '
      || 'mas capacidade da ficha é ' || ROUND(sector_capacity, 0) || ' pares/dia. Carga: '
      || ROUND(load_pct, 0) || '%.' AS body,
    jsonb_build_object(
      'order_id', order_id,
      'order_number', order_number,
      'sheet_id', sheet_id,
      'reference', ref_name,
      'color', color,
      'quantity', quantity,
      'sector', sector_name,
      'capacity_per_day', sector_capacity,
      'lead_days', lead_days,
      'daily_needed', daily_needed,
      'load_pct', load_pct
    ) AS payload
  FROM (
    SELECT *,
           (quantity::numeric / lead_days::numeric) AS daily_needed,
           ((quantity::numeric / lead_days::numeric) / GREATEST(sector_capacity, 1)) * 100 AS load_pct
      FROM op_sector_demand
  ) calc
  WHERE load_pct >= v_min_pct
  ON CONFLICT (alert_key, severity) DO NOTHING;

  GET DIAGNOSTICS v_alerts_created = ROW_COUNT;

  IF v_webhook IS NOT NULL AND v_webhook <> '' AND v_phone IS NOT NULL AND v_phone <> '' THEN
    FOR v_alert IN
      SELECT * FROM public.production_alerts
       WHERE notified_at IS NULL
         AND dismissed_at IS NULL
         AND created_at > now() - interval '10 minutes'
       ORDER BY severity DESC, created_at DESC
       LIMIT 20
    LOOP
      BEGIN
        SELECT net.http_post(
          url := v_webhook,
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := jsonb_build_object(
            'phone', v_phone,
            'message', '[' || upper(v_alert.severity) || '] ' || v_alert.title || E'\n\n' || v_alert.body
          )
        ) INTO v_response_id;
        UPDATE public.production_alerts SET notified_at = now() WHERE id = v_alert.id;
        v_alerts_notified := v_alerts_notified + 1;
      EXCEPTION WHEN OTHERS THEN
        v_alerts_failed := v_alerts_failed + 1;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'created', v_alerts_created,
    'notified', v_alerts_notified,
    'failed', v_alerts_failed
  );
END;
$$;
