-- =============================================================================
-- AUDITORIA A7 (alto): minutos esperados/dia divergem entre SQL e folha
-- =============================================================================
-- get_employee_expected_minutes retornava a jornada CRUA da escala (ex.: 540 =
-- 240+300) SEM aplicar o teto semanal (weekly_hours, ex. 44h). A folha/Espelho (JS
-- useTimesheet) distribui o alvo semanal entre os dias úteis → 528/dia. ~12 min/dia
-- (~4,4h/mês) de divergência por funcionário; banco de horas, Espelho e HE nunca
-- conciliavam.
--
-- Fix: replica EXATAMENTE a distribuição do JS (fonte canônica da folha): alvo
-- semanal distribuído entre os 5 dias úteis (cap por dia), sábado recebe o resto.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_employee_expected_minutes(p_employee_id uuid, p_ref_date date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ws RECORD;
  v_dow int;
  v_works boolean;
  v_emp_sched_id uuid;
  v_weekly int;
  v_daily int;
  v_sat int;
  v_has_sat boolean;
  v_sat_portion int;
  v_weekday_target int;
  v_capped_weekday int;
BEGIN
  SELECT work_schedule_id INTO v_emp_sched_id FROM employees WHERE id = p_employee_id;

  SELECT * INTO v_ws FROM work_schedules
   WHERE id = v_emp_sched_id OR (v_emp_sched_id IS NULL AND is_default = true)
   ORDER BY (id = v_emp_sched_id) DESC, created_at ASC NULLS LAST, id
   LIMIT 1;

  IF v_ws.id IS NULL THEN RETURN NULL; END IF;

  v_dow := EXTRACT(DOW FROM p_ref_date)::int;
  v_works := CASE v_dow
    WHEN 0 THEN v_ws.works_sunday   WHEN 1 THEN v_ws.works_monday
    WHEN 2 THEN v_ws.works_tuesday  WHEN 3 THEN v_ws.works_wednesday
    WHEN 4 THEN v_ws.works_thursday WHEN 5 THEN v_ws.works_friday
    WHEN 6 THEN v_ws.works_saturday END;
  IF NOT COALESCE(v_works, false) THEN RETURN 0; END IF;

  -- A7: distribuição CLT idêntica ao JS (useTimesheet) — alvo semanal / dias úteis.
  v_weekly := COALESCE(v_ws.weekly_hours, 44) * 60;
  v_daily := (EXTRACT(EPOCH FROM (v_ws.lunch_start - v_ws.entry_time))::int / 60)
           + (EXTRACT(EPOCH FROM (v_ws.exit_time - v_ws.lunch_end))::int / 60);
  v_has_sat := (v_ws.saturday_entry IS NOT NULL AND v_ws.saturday_exit IS NOT NULL);
  v_sat := CASE WHEN v_has_sat
                THEN EXTRACT(EPOCH FROM (v_ws.saturday_exit - v_ws.saturday_entry))::int / 60
                ELSE 0 END;
  v_sat_portion := CASE WHEN v_has_sat THEN LEAST(v_sat, v_weekly) ELSE 0 END;
  v_weekday_target := floor((v_weekly - v_sat_portion) / 5.0)::int;
  v_capped_weekday := LEAST(v_daily, v_weekday_target);

  IF v_dow = 6 THEN
    IF v_has_sat THEN
      RETURN LEAST(GREATEST(0, v_weekly - v_capped_weekday * 5), v_sat);
    ELSE
      RETURN 0;
    END IF;
  ELSE
    RETURN GREATEST(0, v_capped_weekday);
  END IF;
END;
$function$;
