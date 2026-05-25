-- =============================================================================
-- calculate_employee_bank_balance: parâmetro p_skip_missing
-- =============================================================================
-- Antes: dia útil sem time_record = "falta automática" (expected entra na
-- semana, worked=0 → diff negativo → desconta saldo). Comportamento OK pra
-- relatórios de absenteísmo, mas quebra UX da tela de SALDO: usuário seleciona
-- período cujo ponto não foi importado ainda e vê balanço artificialmente negativo.
--
-- Agora: p_skip_missing (default false) preserva comportamento legacy. Quando
-- true, dia sem registro é ignorado completamente (não entra em expected nem
-- worked). days_missing counter ainda incrementa pra UI mostrar "X dias sem
-- registro" como info, sem descontar saldo.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_employee_bank_balance(
  p_employee_id uuid,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date,
  p_skip_missing boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp record;
  v_sched record;
  v_cutoff date := public.get_bank_hours_cutoff();
  v_movements_min int := 0;
  v_movements_50  int := 0;
  v_movements_100 int := 0;
  v_timesheet_min int := 0;
  v_timesheet_50  int := 0;
  v_timesheet_100 int := 0;
  v_days_worked  int := 0;
  v_days_partial int := 0;
  v_days_absent  int := 0;
  v_days_missing int := 0;
  v_days_excused int := 0;
  v_total_min int;
  v_weekly_target_min int;
  v_tolerance_min int;
  v_min_overtime int;
  v_record record;
  v_sum jsonb;
  v_is_holiday boolean;
  v_expected_for_day int;
  v_week_key date;
  v_week_worked int := 0;
  v_week_expected int := 0;
  v_week_diff int;
  v_prev_week_key date := NULL;
  v_effective_from date;
  v_effective_to   date;
  v_is_absent boolean;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN RETURN jsonb_build_object('error','Funcionario nao encontrado'); END IF;

  SELECT * INTO v_sched FROM public.work_schedules
   WHERE id = v_emp.work_schedule_id OR (v_emp.work_schedule_id IS NULL AND is_default = true)
   LIMIT 1;

  v_weekly_target_min := COALESCE(v_sched.weekly_hours, 44) * 60;
  v_tolerance_min     := COALESCE(v_sched.tolerance_minutes, 10);
  v_min_overtime      := COALESCE(v_sched.minimum_overtime_minutes, 10);

  v_effective_from := GREATEST(COALESCE(p_from, v_cutoff), v_cutoff);
  v_effective_to   := COALESCE(p_to, CURRENT_DATE);

  SELECT
    COALESCE(SUM(minutes), 0),
    COALESCE(SUM(CASE WHEN overtime_pct = 50  THEN minutes ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN overtime_pct = 100 THEN minutes ELSE 0 END), 0)
  INTO v_movements_min, v_movements_50, v_movements_100
    FROM public.bank_hours_movements
   WHERE employee_id = p_employee_id
     AND movement_date >= v_effective_from
     AND movement_date <= v_effective_to;

  FOR v_record IN
    SELECT
      d::date                                        AS record_date,
      EXTRACT(ISODOW FROM d)::int                    AS dow,
      date_trunc('week', d)::date                    AS week_start,
      tr.id IS NOT NULL                              AS has_record,
      COALESCE(tr.punches, '[]'::jsonb)              AS punches
    FROM generate_series(v_effective_from, v_effective_to, '1 day') d
    LEFT JOIN public.time_records tr
      ON tr.record_date = d::date
      AND (tr.employee_external_id = v_emp.external_id
           OR LOWER(TRIM(tr.employee_name)) = LOWER(TRIM(v_emp.name)))
    ORDER BY d
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.holidays
       WHERE holiday_date = v_record.record_date
         AND COALESCE(optional, false) = false
    ) INTO v_is_holiday;

    v_week_key := v_record.week_start;

    IF v_prev_week_key IS NOT NULL AND v_week_key <> v_prev_week_key THEN
      v_week_diff := v_week_worked - v_week_expected;
      IF ABS(v_week_diff) <= v_tolerance_min THEN v_week_diff := 0; END IF;
      IF v_week_diff > 0 AND v_week_diff < v_min_overtime THEN v_week_diff := 0; END IF;
      v_timesheet_min := v_timesheet_min + v_week_diff;
      v_timesheet_50  := v_timesheet_50  + v_week_diff;
      v_week_worked := 0;
      v_week_expected := 0;
    END IF;

    v_is_absent := public.is_employee_absent_on(p_employee_id, v_record.record_date);
    IF v_is_absent THEN
      v_days_excused := v_days_excused + 1;
      v_prev_week_key := v_week_key;
      CONTINUE;
    END IF;

    v_expected_for_day := COALESCE(
      public.get_employee_expected_minutes(p_employee_id, v_record.record_date), 0
    );

    IF v_is_holiday OR v_record.dow = 7 THEN
      IF v_record.has_record THEN
        v_sum := public.calculate_day_summary(
          v_record.punches, 0, v_tolerance_min, v_min_overtime, true
        );
        IF (v_sum->>'worked_min')::int > 0 THEN
          v_days_worked := v_days_worked + 1;
          v_timesheet_min := v_timesheet_min + (v_sum->>'worked_min')::int;
          v_timesheet_100 := v_timesheet_100 + (v_sum->>'worked_min')::int;
        END IF;
      END IF;
      v_prev_week_key := v_week_key;
      CONTINUE;
    END IF;

    IF v_expected_for_day = 0 THEN
      IF v_record.has_record THEN
        v_sum := public.calculate_day_summary(
          v_record.punches, 0, v_tolerance_min, v_min_overtime, false,
          (v_record.dow BETWEEN 1 AND 5)
        );
        IF (v_sum->>'worked_min')::int > 0 THEN
          v_days_worked := v_days_worked + 1;
          v_week_worked := v_week_worked + (v_sum->>'worked_min')::int;
        END IF;
      END IF;
      v_prev_week_key := v_week_key;
      CONTINUE;
    END IF;

    -- Dia util normal (expected > 0)

    -- PR 3 + 2026-05-24: sem registro
    -- Comportamento legacy (p_skip_missing=false): conta como falta (expected entra, worked=0).
    -- Novo (p_skip_missing=true): pula o dia. counter days_missing ainda
    -- incrementa pra UI mostrar info, sem descontar saldo.
    IF NOT v_record.has_record THEN
      v_days_missing := v_days_missing + 1;
      IF NOT p_skip_missing THEN
        v_week_expected := v_week_expected + v_expected_for_day;
      END IF;
      v_prev_week_key := v_week_key;
      CONTINUE;
    END IF;

    v_sum := public.calculate_day_summary(
      v_record.punches,
      v_expected_for_day,
      v_tolerance_min,
      v_min_overtime,
      false,
      (v_record.dow BETWEEN 1 AND 5)
    );

    IF (v_sum->>'status') IN ('partial','inconsistent','irregular') THEN
      v_days_partial := v_days_partial + 1;
      v_week_expected := v_week_expected + (v_sum->>'expected_min')::int;
    ELSIF (v_sum->>'status') = 'absent' THEN
      v_days_absent := v_days_absent + 1;
      v_week_worked := v_week_worked + (v_sum->>'worked_min')::int;
      v_week_expected := v_week_expected + (v_sum->>'expected_min')::int;
    ELSE
      v_days_worked := v_days_worked + 1;
      v_week_worked := v_week_worked + (v_sum->>'worked_min')::int;
      v_week_expected := v_week_expected + (v_sum->>'expected_min')::int;
    END IF;

    v_prev_week_key := v_week_key;
  END LOOP;

  IF v_prev_week_key IS NOT NULL THEN
    v_week_diff := v_week_worked - v_week_expected;
    IF ABS(v_week_diff) <= v_tolerance_min THEN v_week_diff := 0; END IF;
    IF v_week_diff > 0 AND v_week_diff < v_min_overtime THEN v_week_diff := 0; END IF;
    v_timesheet_min := v_timesheet_min + v_week_diff;
    v_timesheet_50  := v_timesheet_50  + v_week_diff;
  END IF;

  v_total_min := v_movements_min + v_timesheet_min;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id,
    'employee_name', v_emp.name,
    'department', v_emp.department,
    'movements_min', v_movements_min,
    'movements_50_min', v_movements_50,
    'movements_100_min', v_movements_100,
    'timesheet_min', v_timesheet_min,
    'timesheet_50_min', v_timesheet_50,
    'timesheet_100_min', v_timesheet_100,
    'balance_min', v_total_min,
    'balance_50_min', v_movements_50 + v_timesheet_50,
    'balance_100_min', v_movements_100 + v_timesheet_100,
    'days_worked', v_days_worked,
    'days_partial', v_days_partial,
    'days_absent', v_days_absent,
    'days_missing', v_days_missing,
    'days_excused', v_days_excused,
    'weekly_target_min', v_weekly_target_min,
    'minimum_overtime_min', v_min_overtime,
    'tolerance_min', v_tolerance_min,
    'period_from', p_from,
    'period_to', p_to,
    'effective_from', v_effective_from,
    'effective_to', v_effective_to,
    'cutoff_date', v_cutoff,
    'skip_missing', p_skip_missing,
    'apuracao', 'semanal_individual_schedule_v5_skip_missing'
  );
END;
$function$;
