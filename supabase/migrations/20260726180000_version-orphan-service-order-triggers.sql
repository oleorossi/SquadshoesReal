-- =============================================================================
-- ONDA 01 — Blindar o que já roda: versionar triggers órfãos (2026-07-26)
--
-- PROBLEMA: três objetos rodam em produção e NÃO existem em nenhuma migration
-- do repositório. Um `supabase db reset`, uma branch do Supabase ou qualquer
-- recriação do schema a partir do repo apagaria os três em silêncio.
--
--   · tg_service_orders_compute_quoted_deadline  → calcula o prazo da OS
--   · tg_costura_notify_on_so_change             → dispara alerta de overflow
--   · notify_costura_overflow                    → dependência do anterior
--
-- Gravidade: as 379 OS do banco têm `quoted_deadline` preenchido, e NENHUMA
-- delas recebe esse valor do formulário — quem preenche é o trigger. Perdê-lo
-- faria toda OS nova nascer sem prazo, zerando em silêncio o indicador de
-- atraso (hoje 79 OS ativas vencidas), as faixas de prazo da lista e a
-- pontualidade por prestador em v_contractor_metrics.
--
-- Esta migration é uma FOTOGRAFIA FIEL do que já está no banco — reaplicá-la
-- não muda comportamento nenhum. É registro, não alteração. As definições
-- foram extraídas com pg_get_functiondef/pg_get_triggerdef em 26/07/2026.
--
-- ⚠ Ver também CLAUDE.md > "Pending DB Migrations": várias migrations foram
-- aplicadas via MCP e não estão em supabase_migrations.schema_migrations.
-- Rodar `scripts/repair-applied-migrations.sh` ANTES do primeiro `db push`,
-- senão a reaplicação fora de ordem regride tg_create_ap_for_service_order e
-- derruba o guard do prestador FÁBRICA (payment_days >= 999).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Prazo da OS: service_date + lead em dias ÚTEIS
--
-- Preenche quoted_deadline quando está vazio, ou quando o usuário mexeu no
-- lead. Precedência do lead: o da OS > o padrão do prestador > 10 dias.
-- Depende de public.add_business_days (essa sim já versionada no repo).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_service_orders_compute_quoted_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead int;
  v_user_changed_lead boolean;
BEGIN
  v_user_changed_lead := (TG_OP = 'UPDATE'
    AND NEW.quoted_lead_days IS DISTINCT FROM OLD.quoted_lead_days);

  IF (NEW.quoted_deadline IS NULL AND NEW.service_date IS NOT NULL)
     OR (v_user_changed_lead AND NEW.service_date IS NOT NULL) THEN
    v_lead := COALESCE(
      NEW.quoted_lead_days,
      (SELECT default_lead_days FROM contractors WHERE id = NEW.contractor_id),
      10
    );
    NEW.quoted_deadline := public.add_business_days(NEW.service_date, v_lead);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_service_orders_compute_quoted_deadline ON public.service_orders;
CREATE TRIGGER trg_service_orders_compute_quoted_deadline
  BEFORE INSERT OR UPDATE OF quoted_lead_days, service_date, contractor_id
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_orders_compute_quoted_deadline();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Alerta de sobrecarga de Costura
--
-- Agrega o overflow por semana nos próximos 30 dias e cria/atualiza uma
-- notificação por semana (dedupe_key), resolvendo as que saíram do overflow.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_costura_overflow()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      v_message, 'Costura', 'production', v_severity, v_week_key,
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
$function$;

-- Dispara o alerta quando uma OS de Costura muda de status/setor.
-- O bloco EXCEPTION é intencional: falha de notificação NUNCA pode abortar a
-- gravação da OS.
CREATE OR REPLACE FUNCTION public.tg_costura_notify_on_so_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS trg_costura_notify_on_so_change ON public.service_orders;
CREATE TRIGGER trg_costura_notify_on_so_change
  AFTER INSERT OR UPDATE OF status, target_sector
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_costura_notify_on_so_change();
