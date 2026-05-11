-- =============================================================================
-- Sistema de alertas de produção + notificação WhatsApp via webhook
-- =============================================================================
-- 1. system_settings  — config key/value (URL webhook, telefone, etc)
-- 2. production_alerts — alertas detectados com dedup
-- 3. RPC detect_production_bottlenecks_and_alert() — detecta + insere + dispara
-- 4. pg_cron schedule — a cada 30 min em horário comercial (8h-18h SEG-SEX)
--
-- Webhook: POST {phone, title, body, severity, payload} pra alert_webhook_url.
-- Usuário configura webhook pra Z-API / Make / Zapier / Twilio / WPPConnect.
-- =============================================================================

-- ─── 1. system_settings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read system_settings" ON public.system_settings;
CREATE POLICY "Authenticated can read system_settings"
  ON public.system_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin can write system_settings" ON public.system_settings;
CREATE POLICY "Admin can write system_settings"
  ON public.system_settings FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = (SELECT auth.uid())
               AND ur.role IN ('admin'::app_role, 'gerente'::app_role))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = (SELECT auth.uid())
               AND ur.role IN ('admin'::app_role, 'gerente'::app_role))
  );

-- Seed: telefone do dono + webhook em branco (config posterior)
INSERT INTO public.system_settings (key, value, description) VALUES
  ('alert_phone_whatsapp', '"+5521982622290"',
   'WhatsApp do destinatário de alertas (Leonardo). Formato E.164.'),
  ('alert_webhook_url', '""',
   'URL do webhook que envia WhatsApp. POST recebe {phone, title, body, severity, payload}. Pode ser Z-API, Make.com, Zapier, Twilio, WPPConnect, etc.'),
  ('alert_business_hours', '{"start":"08:00","end":"18:00","days":[1,2,3,4,5]}',
   'Horário comercial para disparos de alerta (cron). Fora disso, alertas ficam acumulados sem WhatsApp.'),
  ('alert_min_load_pct', '105',
   'Carga % mínima de setor para disparar alerta (default 105% = >5% acima da capacidade).'),
  ('alert_critical_load_pct', '130',
   'Carga % acima da qual o alerta vira crítico (vai pra topo da lista).')
ON CONFLICT (key) DO NOTHING;

-- ─── 2. production_alerts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.production_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL,
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning','critical')),
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  notified_at timestamptz,
  notification_status text,
  notification_error text,
  dismissed_at timestamptz,
  dismissed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_key, severity)
);

CREATE INDEX IF NOT EXISTS idx_production_alerts_active
  ON public.production_alerts (created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_production_alerts_unsent
  ON public.production_alerts (created_at)
  WHERE notified_at IS NULL AND dismissed_at IS NULL;

ALTER TABLE public.production_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read alerts" ON public.production_alerts;
CREATE POLICY "Authenticated read alerts"
  ON public.production_alerts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated dismiss alerts" ON public.production_alerts;
CREATE POLICY "Authenticated dismiss alerts"
  ON public.production_alerts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Realtime para o frontend assinar inserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='production_alerts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.production_alerts';
  END IF;
END
$$;

-- ─── 3. RPC detector ────────────────────────────────────────────────────────
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
  -- Carrega configurações
  SELECT (value #>> '{}')::numeric INTO v_min_pct
    FROM system_settings WHERE key='alert_min_load_pct';
  v_min_pct := COALESCE(v_min_pct, 105);

  SELECT (value #>> '{}')::numeric INTO v_crit_pct
    FROM system_settings WHERE key='alert_critical_load_pct';
  v_crit_pct := COALESCE(v_crit_pct, 130);

  SELECT (value #>> '{}') INTO v_webhook FROM system_settings WHERE key='alert_webhook_url';
  SELECT (value #>> '{}') INTO v_phone   FROM system_settings WHERE key='alert_phone_whatsapp';

  -- ── Detecção: per-OP usando capacidade da própria ficha técnica ────────────
  --
  -- Pra cada OP ativa + setor crítico (Corte Palmilha, Corte Forração,
  -- Aviamento, Costura), calcula daily_needed = qty / lead_time_dias e
  -- compara com capacity_per_day da ficha. Se ratio > v_min_pct = gargalo.
  -- (Aborda o caso "MOD-038 tem capacidade 100/dia mas precisa rodar 220
  -- pares em 1 dia" que a média não captura.)
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
      sector.lead_days AS sector_lead_days,
      CASE WHEN sector.lead_days > 0 AND sector.capacity > 0
        THEN (o.quantity::numeric / sector.lead_days::numeric)
        ELSE 0
      END AS daily_needed
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    CROSS JOIN LATERAL (VALUES
      ('Corte Palmilha'::text,
       COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), 200)::numeric,
       GREATEST(1, CEIL(o.quantity::numeric /
         GREATEST(COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), 200), 1)))::int),
      ('Corte Forração',
       COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), 200)::numeric,
       GREATEST(1, CEIL(o.quantity::numeric /
         GREATEST(COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), 200), 1)))::int),
      ('Aviamento',
       COALESCE(NULLIF(ts.mesa_daily_capacity, 0), 200)::numeric,
       GREATEST(1, CEIL(o.quantity::numeric /
         GREATEST(COALESCE(NULLIF(ts.mesa_daily_capacity, 0), 200), 1)))::int),
      ('Costura',
       COALESCE(NULLIF(ts.costura_capacity_per_day, 0), 200)::numeric,
       GREATEST(1, CEIL(o.quantity::numeric /
         GREATEST(COALESCE(NULLIF(ts.costura_capacity_per_day, 0), 200), 1)))::int)
    ) AS sector(name, capacity, lead_days)
    WHERE o.status NOT IN ('Finalizado','Faturado','Cancelado','Concluído','Pronto')
      AND ts.active = true
  )
  INSERT INTO public.production_alerts (alert_key, alert_type, severity, title, body, payload)
  SELECT
    'op_overload:' || order_id::text || ':' || sector_name AS alert_key,
    'op_overload' AS alert_type,
    CASE WHEN load_pct >= v_crit_pct THEN 'critical' ELSE 'warning' END AS severity,
    'Gargalo: ' || sector_name || ' · ' || ref_name AS title,
    'OP ' || order_number || ' (' || quantity || ' pares) precisa de ' ||
      ROUND(daily_needed, 0) || ' pares/dia mas capacidade da ficha é ' ||
      ROUND(sector_capacity, 0) || ' pares/dia. Carga: ' || ROUND(load_pct, 0) || '%.' AS body,
    jsonb_build_object(
      'order_id', order_id,
      'order_number', order_number,
      'sheet_id', sheet_id,
      'reference', ref_name,
      'color', color,
      'quantity', quantity,
      'sector', sector_name,
      'capacity_per_day', sector_capacity,
      'daily_needed', daily_needed,
      'load_pct', load_pct
    ) AS payload
  FROM (
    SELECT *,
           (daily_needed / GREATEST(sector_capacity, 1)) * 100 AS load_pct
      FROM op_sector_demand
  ) calc
  WHERE load_pct >= v_min_pct
  ON CONFLICT (alert_key, severity) DO NOTHING;

  GET DIAGNOSTICS v_alerts_created = ROW_COUNT;

  -- ── Notificação via webhook (se configurado) ────────────────────────────────
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
          body := jsonb_build_object(
            'phone', v_phone,
            'title', v_alert.title,
            'body', v_alert.body,
            'severity', v_alert.severity,
            'alert_id', v_alert.id,
            'payload', v_alert.payload
          ),
          headers := '{"Content-Type":"application/json"}'::jsonb,
          timeout_milliseconds := 5000
        ) INTO v_response_id;

        UPDATE public.production_alerts
           SET notified_at = now(),
               notification_status = 'sent',
               notification_error = NULL
         WHERE id = v_alert.id;

        v_alerts_notified := v_alerts_notified + 1;
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.production_alerts
           SET notification_status = 'failed',
               notification_error = SQLERRM
         WHERE id = v_alert.id;
        v_alerts_failed := v_alerts_failed + 1;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'alerts_created', v_alerts_created,
    'alerts_notified', v_alerts_notified,
    'alerts_failed', v_alerts_failed,
    'webhook_configured', (v_webhook IS NOT NULL AND v_webhook <> ''),
    'ts', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_production_bottlenecks_and_alert() TO authenticated;

-- ─── 4. pg_cron schedule (a cada 30min, horário comercial SEG-SEX 8-18) ────
-- Tenta unschedule antigos (idempotência)
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  FOR v_jobid IN
    SELECT jobid FROM cron.job WHERE jobname = 'detect-production-bottlenecks'
  LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;
END
$$;

-- Cron: a cada 30 min, das 8h às 18h, segunda-sexta (horário UTC, 11h-21h UTC = 8h-18h BRT)
SELECT cron.schedule(
  'detect-production-bottlenecks',
  '*/30 11-21 * * 1-5',
  $$SELECT public.detect_production_bottlenecks_and_alert();$$
);
