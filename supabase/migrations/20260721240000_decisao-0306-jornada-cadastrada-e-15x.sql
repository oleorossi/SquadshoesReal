-- ============================================================================
-- DECISÃO 03/06 REAFIRMADA PELO USUÁRIO (2026-06-10): o modelo da folha é a
-- regra única — esperado/dia = JORNADA CADASTRADA da escala (saída − entrada
-- − almoço, ex. 08–18 c/ 1h = 540 min) e HE a 1,5×.
--
-- 1) get_employee_expected_minutes: remove a distribuição semanal com teto
--    (44h/5 = 528, introduzida no audit-a7) que fazia banco/Espelho divergirem
--    da folha em ~1h/semana por funcionário. Agora: dia útil = jornada
--    cadastrada; sábado = horário de sábado da escala (se trabalha).
-- 2) employees.overtime_multiplier: 16 ativos estavam com 1,2 (anterior à
--    decisão) → atualizados para 1,5; default da coluna idem.
-- 3) resolve_monthly_overtime: fallback 1,2 → 1,5.
-- ============================================================================

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
  v_daily int;
  v_sat int;
  v_has_sat boolean;
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

  -- DECISÃO 03/06: esperado = jornada cadastrada (sem distribuição/teto 44h/5)
  v_daily := (EXTRACT(EPOCH FROM (v_ws.lunch_start - v_ws.entry_time))::int / 60)
           + (EXTRACT(EPOCH FROM (v_ws.exit_time - v_ws.lunch_end))::int / 60);
  v_has_sat := (v_ws.saturday_entry IS NOT NULL AND v_ws.saturday_exit IS NOT NULL);
  v_sat := CASE WHEN v_has_sat
                THEN EXTRACT(EPOCH FROM (v_ws.saturday_exit - v_ws.saturday_entry))::int / 60
                ELSE 0 END;

  IF v_dow = 6 THEN
    RETURN CASE WHEN v_has_sat THEN GREATEST(0, v_sat) ELSE 0 END;
  ELSE
    RETURN GREATEST(0, v_daily);
  END IF;
END;
$function$;

-- ── multiplicador 1,5 (decisão 03/06) ───────────────────────────────────────
UPDATE public.employees
   SET overtime_multiplier = 1.5
 WHERE COALESCE(overtime_multiplier, 0) <> 1.5;

ALTER TABLE public.employees ALTER COLUMN overtime_multiplier SET DEFAULT 1.5;

-- resolve_monthly_overtime: fallback 1,2 → 1,5 (patch cirúrgico idempotente)
DO $patch$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='resolve_monthly_overtime' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN
    RAISE WARNING 'resolve_monthly_overtime não encontrada';
    RETURN;
  END IF;
  IF position('COALESCE(overtime_multiplier, 1.2)' IN v_src) = 0 THEN
    RETURN; -- já em 1.5 ou estrutura diferente
  END IF;
  v_src := replace(v_src, 'COALESCE(overtime_multiplier, 1.2)', 'COALESCE(overtime_multiplier, 1.5)');
  EXECUTE v_src;
END
$patch$;
