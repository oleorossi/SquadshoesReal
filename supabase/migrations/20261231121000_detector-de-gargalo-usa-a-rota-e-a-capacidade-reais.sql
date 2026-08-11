-- ════════════════════════════════════════════════════════════════════════════
-- O detector de gargalo tinha três defeitos, e todos os três distorciam o alarme
-- que a fábrica recebe por WhatsApp a cada 30 minutos.
--
-- 1. SETORES HARDCODED. Um `CROSS JOIN LATERAL (VALUES …)` fixava quatro
--    setores — Corte Palmilha, Corte Forração, Aviamento e Costura — e ignorava
--    a rota REAL da ficha (`production_sectors`). Setor fora da lista nunca
--    alertava; setor da lista alertava mesmo em OP que não passa por ele.
--    Pior: 'Corte Palmilha' lia `ts.sewing_capacity_per_day` — a coluna da
--    COSTURA. Era o mesmo erro de cadastro corrigido na mig 20261231120800,
--    espelhado aqui dentro.
--
-- 2. FERIADO IGNORADO. `EXTRACT(DOW) NOT IN (0,6)` conta feriado como dia útil,
--    então o prazo parecia maior e a carga diária menor — o alarme subestimava.
--    E não enxergava o sábado produtivo criado na mig 20261231120700.
--
-- 3. FALLBACK DE 200 PARES/DIA. `COALESCE(NULLIF(coluna,0), 200)` inventava uma
--    capacidade quando a ficha não tinha o campo. Medido em 11/08/2026:
--    **132 dos 156 alertas (85%) foram calculados contra esse 200** — um número
--    que não existe em nenhum cadastro do sistema.
--
-- Agora: a rota vem de `sector_settings` ∩ `technical_sheets.production_sectors`
-- (mesma regra do `recompute_production_schedule`), a capacidade vem da coluna
-- que `ficha_capacity_column` aponta com fallback no default do setor, e o dia
-- útil vem de `is_business_day`.
--
-- ⚠ A capacidade é lida por `to_jsonb(ts) ->> ss.ficha_capacity_column`, de
-- propósito: um CASE com nomes de coluna — como o que existe no
-- `recompute_production_schedule` — silenciosamente cai no ELSE quando alguém
-- cadastra uma coluna nova, e foi exatamente a armadilha da mig 20261231120800.
-- Assim, coluna nova em `sector_settings` passa a valer sem tocar nesta função.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.detect_production_bottlenecks_and_alert()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_alerts_created  int := 0;
  v_alerts_notified int := 0;
  v_alerts_failed   int := 0;
  v_webhook  text;
  v_phone    text;
  v_min_pct  numeric;
  v_crit_pct numeric;
  v_alert    RECORD;
  v_response_id bigint;
BEGIN
  SELECT (value #>> '{}')::numeric INTO v_min_pct
    FROM system_settings WHERE key = 'alert_min_load_pct';
  v_min_pct := COALESCE(v_min_pct, 105);

  SELECT (value #>> '{}')::numeric INTO v_crit_pct
    FROM system_settings WHERE key = 'alert_critical_load_pct';
  v_crit_pct := COALESCE(v_crit_pct, 130);

  SELECT (value #>> '{}') INTO v_webhook FROM system_settings WHERE key = 'alert_webhook_url';
  SELECT (value #>> '{}') INTO v_phone   FROM system_settings WHERE key = 'alert_phone_whatsapp';

  WITH op_sector_demand AS (
    SELECT
      o.id              AS order_id,
      o.order_number,
      o.quantity,
      ts.id             AS sheet_id,
      ts.name           AS ref_name,
      o.color,
      ss.sector         AS sector_name,
      -- capacidade: coluna da ficha que o setor aponta → default do setor.
      -- Sem inventar número: se o cadastro não diz, vale o default da fábrica.
      COALESCE(
        NULLIF((to_jsonb(ts) ->> ss.ficha_capacity_column)::numeric, 0),
        NULLIF(ss.daily_capacity_pairs::numeric, 0)
      )                 AS sector_capacity,
      -- dias ÚTEIS de verdade: honra feriado e sábado produtivo
      GREATEST(1, (
        SELECT COUNT(*)::int
          FROM generate_series(
                 CURRENT_DATE,
                 GREATEST(CURRENT_DATE,
                          COALESCE(o.due_date, so.delivery_deadline, CURRENT_DATE + 5)::date),
                 interval '1 day') d
         WHERE public.is_business_day(d::date)
      ))                AS lead_days
    FROM public.orders o
    LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    -- a ROTA da ficha manda; sem rota declarada, vale o setor habilitado
    JOIN public.sector_settings ss
      ON ss.enabled
     AND (
          CASE
            WHEN ts.production_sectors IS NOT NULL
             AND jsonb_array_length(ts.production_sectors) > 0
              THEN (ts.production_sectors ? ss.sector
                    OR (ss.sector = 'Aviamento' AND ts.production_sectors ? 'Mesa'))
            ELSE true
          END
         )
    WHERE o.status NOT IN ('Finalizado','Faturado','Cancelado','Cancelada','Concluído','Pronto')
      AND o.deleted_at IS NULL
      AND ts.status = 'Ativo'
  )
  INSERT INTO public.production_alerts (alert_key, alert_type, severity, title, body, payload)
  SELECT
    'op_overload:' || order_id::text || ':' || sector_name,
    'op_overload',
    CASE WHEN load_pct >= v_crit_pct THEN 'critical' ELSE 'warning' END,
    'Gargalo: ' || sector_name || ' · ' || ref_name,
    'OP ' || order_number || ' (' || quantity || ' pares) precisa de ' ||
      ROUND(daily_needed, 0) || ' pares/dia em ' || lead_days || ' dia(s) úteis, ' ||
      'mas a capacidade do setor é ' || ROUND(sector_capacity, 0) || ' pares/dia. Carga: ' ||
      ROUND(load_pct, 0) || '%.',
    jsonb_build_object(
      'order_id', order_id, 'order_number', order_number, 'sheet_id', sheet_id,
      'reference', ref_name, 'color', color, 'quantity', quantity,
      'sector', sector_name, 'capacity_per_day', sector_capacity,
      'lead_days', lead_days, 'daily_needed', daily_needed, 'load_pct', load_pct)
  FROM (
    SELECT *,
           (quantity::numeric / lead_days::numeric) AS daily_needed,
           ((quantity::numeric / lead_days::numeric) / GREATEST(sector_capacity, 1)) * 100 AS load_pct
      FROM op_sector_demand
     -- sem capacidade cadastrada não há alarme: o certo é não gritar sobre um
     -- número que ninguém informou (era daqui que saíam os 200 pares/dia).
     WHERE sector_capacity IS NOT NULL AND sector_capacity > 0
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
            'message', '[' || upper(v_alert.severity) || '] ' || v_alert.title || E'\n\n' || v_alert.body)
        ) INTO v_response_id;
        UPDATE public.production_alerts SET notified_at = now() WHERE id = v_alert.id;
        v_alerts_notified := v_alerts_notified + 1;
      EXCEPTION WHEN OTHERS THEN
        v_alerts_failed := v_alerts_failed + 1;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'created', v_alerts_created, 'notified', v_alerts_notified, 'failed', v_alerts_failed);
END;
$function$;
