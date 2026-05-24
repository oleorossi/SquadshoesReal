-- =============================================================================
-- get_employee_expected_minutes: fallback pro work_schedule is_default=true
-- =============================================================================
-- Descoberto em 24/05/2026 durante auditoria pós-fix do banco de horas.
--
-- Problema:
--   Funcionário com work_schedule_id NULL (Albana Socorro era o único caso)
--   fazia get_employee_expected_minutes retornar NULL pra qualquer data,
--   porque o LEFT JOIN não casava.
--
--   Consequência em calculate_employee_bank_balance:
--     v_expected_for_day := COALESCE(get_employee_expected_minutes(...), 0);
--     IF v_expected_for_day = 0 THEN
--       -- trata como dia de folga → trabalho vira HE 50% (worked = crédito)
--       CONTINUE;
--     END IF;
--
--   Resultado: TODA hora trabalhada virava crédito (não descontava expected),
--   e dias sem batida sumiam (não viravam missing). Albana acumulou saldo
--   +169h fake — caiu pra -66h real após o fix.
--
--   Mesmo bug em v_time_pendings, calculate_weekly_he_breakdown e outros
--   callers — todos resolvidos com este fix.
--
-- Correção:
--   Replica o pattern de fallback que calculate_employee_bank_balance já usa
--   (id=employee.work_schedule_id OU is_default=true quando NULL).
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
  v_expected int;
  v_emp_sched_id uuid;
BEGIN
  SELECT work_schedule_id INTO v_emp_sched_id FROM employees WHERE id = p_employee_id;

  SELECT * INTO v_ws FROM work_schedules
   WHERE id = v_emp_sched_id OR (v_emp_sched_id IS NULL AND is_default = true)
   LIMIT 1;

  IF v_ws.id IS NULL THEN RETURN NULL; END IF;

  v_dow := EXTRACT(DOW FROM p_ref_date)::int;

  v_works := CASE v_dow
    WHEN 0 THEN v_ws.works_sunday
    WHEN 1 THEN v_ws.works_monday
    WHEN 2 THEN v_ws.works_tuesday
    WHEN 3 THEN v_ws.works_wednesday
    WHEN 4 THEN v_ws.works_thursday
    WHEN 5 THEN v_ws.works_friday
    WHEN 6 THEN v_ws.works_saturday
  END;

  IF NOT COALESCE(v_works, false) THEN RETURN 0; END IF;

  IF v_dow = 6 THEN
    IF v_ws.saturday_entry IS NULL OR v_ws.saturday_exit IS NULL THEN
      RETURN 240;
    END IF;
    v_expected := EXTRACT(EPOCH FROM (v_ws.saturday_exit - v_ws.saturday_entry))::int / 60;
  ELSE
    v_expected := (EXTRACT(EPOCH FROM (v_ws.lunch_start - v_ws.entry_time))::int / 60)
                + (EXTRACT(EPOCH FROM (v_ws.exit_time - v_ws.lunch_end))::int / 60);
  END IF;

  RETURN GREATEST(0, v_expected);
END;
$function$;
