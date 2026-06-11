-- ============================================================================
-- AUDITORIA HORAS 2026-06-09 — fixes SQL (parte 1):
--
-- #3  tg_payroll_link_advances_and_overtime quebrava ao aprovar folha de
--     período QUINZENAL: NEW.period vem como 'YYYY-MM-DD_YYYY-MM-DD'
--     (rangeToPeriod do frontend) e o cast ('...'||'-01')::date lança 22007.
--     Agora parseia ambos os formatos.
--
-- #11 get_employee_expected_minutes dividia (semanal − sábado) SEMPRE por 5;
--     escala part-time (ex.: 3 dias) ganhava esperado/dia menor e HE falsa.
--     Divide pelo nº real de dias úteis seg–sex trabalhados na escala.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_payroll_link_advances_and_overtime()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_period_start date;
  v_period_end   date;
  v_advances_total numeric;
  v_proventos numeric;
  v_old_descontos_non_advance numeric;
BEGIN
  -- period: 'YYYY-MM' (mês cheio) OU 'YYYY-MM-DD_YYYY-MM-DD' (quinzenal/intervalo)
  IF NEW.period ~ '^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$' THEN
    v_period_start := split_part(NEW.period, '_', 1)::date;
    v_period_end   := split_part(NEW.period, '_', 2)::date;
  ELSIF NEW.period ~ '^\d{4}-\d{2}$' THEN
    v_period_start := (NEW.period || '-01')::date;
    v_period_end   := (v_period_start + interval '1 month - 1 day')::date;
  ELSE
    RAISE EXCEPTION 'payroll_runs.period em formato desconhecido: % (esperado YYYY-MM ou YYYY-MM-DD_YYYY-MM-DD)', NEW.period;
  END IF;

  IF NEW.status IN ('aprovado','pago') AND (OLD.status IS NULL OR OLD.status='rascunho') THEN
    UPDATE public.employee_advances
       SET payroll_run_id = NEW.id, status = 'deducted', updated_at = now()
     WHERE employee_id = NEW.employee_id
       AND advance_date >= v_period_start AND advance_date <= v_period_end
       AND (payroll_run_id IS NULL OR payroll_run_id = NEW.id);

    SELECT COALESCE(SUM(amount), 0) INTO v_advances_total
    FROM public.employee_advances
    WHERE payroll_run_id = NEW.id;

    v_old_descontos_non_advance := COALESCE(NEW.total_descontos, 0) - COALESCE(NEW.advances_total, 0);
    NEW.advances_total := v_advances_total;
    NEW.total_descontos := v_old_descontos_non_advance + v_advances_total;
    NEW.total_liquido := COALESCE(NEW.total_proventos, 0) - NEW.total_descontos;

    UPDATE public.overtime_resolutions
       SET payroll_run_id = NEW.id
     WHERE employee_id = NEW.employee_id
       AND month >= v_period_start AND month <= v_period_end
       AND (payroll_run_id IS NULL OR payroll_run_id = NEW.id);

    IF NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;

  ELSIF NEW.status='rascunho' AND OLD.status IN ('aprovado','pago') THEN
    UPDATE public.employee_advances
       SET payroll_run_id = NULL, status = 'pending', updated_at = now()
     WHERE payroll_run_id = NEW.id;
    UPDATE public.overtime_resolutions SET payroll_run_id = NULL WHERE payroll_run_id = NEW.id;

    NEW.advances_total := 0;
    v_old_descontos_non_advance := COALESCE(NEW.total_descontos, 0) - COALESCE(OLD.advances_total, 0);
    NEW.total_descontos := v_old_descontos_non_advance;
    NEW.total_liquido := COALESCE(NEW.total_proventos, 0) - NEW.total_descontos;

    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── #11: esperado/dia respeita os dias trabalhados da escala ────────────────
-- Patch cirúrgico idempotente na definição viva (a7/20260703190000): troca a
-- divisão fixa por 5 pela contagem de works_monday..works_friday.
DO $patch$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc
   WHERE proname = 'get_employee_expected_minutes' AND pronamespace = 'public'::regnamespace;

  IF v_src IS NULL THEN
    RAISE WARNING 'get_employee_expected_minutes não encontrada — patch part-time NÃO aplicado';
    RETURN;
  END IF;
  IF v_src LIKE '%parttime-days-fix%' THEN
    RETURN;
  END IF;
  IF position('/ 5.0' IN v_src) = 0 THEN
    RAISE WARNING 'get_employee_expected_minutes: divisão /5.0 não encontrada — patch NÃO aplicado (verificar manualmente)';
    RETURN;
  END IF;

  -- comentário-marcador + divisão pelos dias úteis reais da escala (record v_ws)
  v_src := replace(v_src, '/ 5.0',
    '/ GREATEST(1, ((CASE WHEN COALESCE(v_ws.works_monday, true) THEN 1 ELSE 0 END) + (CASE WHEN COALESCE(v_ws.works_tuesday, true) THEN 1 ELSE 0 END) + (CASE WHEN COALESCE(v_ws.works_wednesday, true) THEN 1 ELSE 0 END) + (CASE WHEN COALESCE(v_ws.works_thursday, true) THEN 1 ELSE 0 END) + (CASE WHEN COALESCE(v_ws.works_friday, true) THEN 1 ELSE 0 END))::numeric) /* parttime-days-fix */');

  EXECUTE v_src;
  RAISE NOTICE 'get_employee_expected_minutes: patch part-time aplicado';
END
$patch$;
