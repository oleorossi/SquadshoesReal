-- Weekly Overtime Resolution: estende o sistema de resolução de HE para
-- também operar em ciclo semanal (CLT requer aferição semanal de jornada).
--
-- 1. Adiciona period_type em overtime_resolutions (default 'monthly').
-- 2. Substitui UNIQUE(employee_id, month) por UNIQUE(employee_id, month, period_type).
-- 3. RPC calculate_weekly_he_breakdown — retorna HE da semana + breakdown diário
--    (data, esperado, trabalhado, atraso, saída antecipada, diff).
-- 4. RPC resolve_weekly_overtime — grava resolução com period_type='weekly',
--    cria bank_hours_movement e/ou financial_entry conforme decision.

-- ── 1. Column period_type ───────────────────────────────────────────────────
ALTER TABLE public.overtime_resolutions
  ADD COLUMN IF NOT EXISTS period_type text NOT NULL DEFAULT 'monthly'
  CHECK (period_type IN ('monthly', 'weekly'));

-- ── 2. Swap UNIQUE constraint ───────────────────────────────────────────────
ALTER TABLE public.overtime_resolutions
  DROP CONSTRAINT IF EXISTS overtime_resolutions_employee_id_month_key;
DROP INDEX IF EXISTS overtime_resolutions_employee_id_month_key;

ALTER TABLE public.overtime_resolutions
  ADD CONSTRAINT overtime_resolutions_emp_period_uk
  UNIQUE (employee_id, month, period_type);

-- ── 3. Breakdown da semana (HE + atrasos/saídas antecipadas por dia) ─────────
DROP FUNCTION IF EXISTS public.calculate_weekly_he_breakdown(uuid, date);

CREATE OR REPLACE FUNCTION public.calculate_weekly_he_breakdown(
  p_employee_id uuid,
  p_week_start  date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_emp       record;
  v_sched     record;
  v_week_end  date := p_week_start + interval '6 days';
  v_weekly_target_min int;
  v_expected_per_day  int;
  v_tolerance_min     int;
  v_min_overtime      int;
  v_week_worked       int := 0;
  v_week_expected     int := 0;
  v_week_late         int := 0;
  v_week_early_leave  int := 0;
  v_week_diff         int;
  v_days              jsonb := '[]'::jsonb;
  v_record            record;
  v_day_dow           int;
  v_day_expected      int;
  v_day_worked        int;
  v_day_late          int;
  v_day_early_leave   int;
  v_first_punch_min   int;
  v_last_punch_min    int;
  v_entry_sched_min   int;
  v_exit_sched_min    int;
  v_sum               jsonb;
  v_clean_punches     text[];
BEGIN
  p_week_start := date_trunc('week', p_week_start)::date;
  v_week_end := p_week_start + interval '6 days';

  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Funcionário não encontrado');
  END IF;

  SELECT * INTO v_sched FROM public.work_schedules
   WHERE id = v_emp.work_schedule_id OR (v_emp.work_schedule_id IS NULL AND is_default = true)
   LIMIT 1;

  v_weekly_target_min := COALESCE(v_sched.weekly_hours, 44) * 60;
  v_expected_per_day  := ROUND(v_weekly_target_min::numeric / 5);
  v_tolerance_min     := COALESCE(v_sched.tolerance_minutes, 10);
  v_min_overtime      := COALESCE(v_sched.minimum_overtime_minutes, 10);

  FOR v_record IN
    SELECT tr.*, EXTRACT(ISODOW FROM tr.record_date)::int AS dow,
           tr.record_date::date AS day_date
      FROM public.time_records tr
     WHERE (tr.employee_external_id = v_emp.external_id
            OR LOWER(TRIM(tr.employee_name)) = LOWER(TRIM(v_emp.name)))
       AND tr.record_date >= p_week_start
       AND tr.record_date <= v_week_end
     ORDER BY tr.record_date ASC
  LOOP
    v_day_dow := v_record.dow;

    v_day_expected := CASE
      WHEN v_day_dow = 7 THEN 0
      WHEN v_day_dow = 6 AND v_sched.saturday_entry IS NOT NULL THEN
        EXTRACT(EPOCH FROM (v_sched.saturday_exit - v_sched.saturday_entry))::int / 60
      WHEN v_day_dow = 6 THEN 0
      ELSE v_expected_per_day
    END;

    v_sum := public.calculate_day_summary(
      v_record.punches,
      v_day_expected,
      v_tolerance_min,
      v_min_overtime,
      false
    );

    v_day_worked := COALESCE((v_sum->>'worked_min')::int, 0);

    v_day_late        := 0;
    v_day_early_leave := 0;

    IF jsonb_array_length(v_record.punches) > 0 AND v_day_expected > 0 THEN
      SELECT array_agg(regexp_replace(p, '\*$', '') ORDER BY p)
        INTO v_clean_punches
        FROM jsonb_array_elements_text(v_record.punches) p;

      v_first_punch_min := EXTRACT(HOUR FROM v_clean_punches[1]::time)*60
                         + EXTRACT(MINUTE FROM v_clean_punches[1]::time);
      v_last_punch_min := EXTRACT(HOUR FROM v_clean_punches[array_length(v_clean_punches,1)]::time)*60
                        + EXTRACT(MINUTE FROM v_clean_punches[array_length(v_clean_punches,1)]::time);

      v_entry_sched_min := CASE
        WHEN v_day_dow = 6 AND v_sched.saturday_entry IS NOT NULL THEN
          EXTRACT(HOUR FROM v_sched.saturday_entry)*60 + EXTRACT(MINUTE FROM v_sched.saturday_entry)
        ELSE
          EXTRACT(HOUR FROM v_sched.entry_time)*60 + EXTRACT(MINUTE FROM v_sched.entry_time)
      END;
      v_exit_sched_min := CASE
        WHEN v_day_dow = 6 AND v_sched.saturday_exit IS NOT NULL THEN
          EXTRACT(HOUR FROM v_sched.saturday_exit)*60 + EXTRACT(MINUTE FROM v_sched.saturday_exit)
        ELSE
          EXTRACT(HOUR FROM v_sched.exit_time)*60 + EXTRACT(MINUTE FROM v_sched.exit_time)
      END;

      v_day_late := GREATEST(0, v_first_punch_min - v_entry_sched_min - v_tolerance_min);
      v_day_early_leave := GREATEST(0, v_exit_sched_min - v_last_punch_min - v_tolerance_min);
    END IF;

    v_week_worked := v_week_worked + v_day_worked;
    v_week_expected := v_week_expected + v_day_expected;
    v_week_late := v_week_late + v_day_late;
    v_week_early_leave := v_week_early_leave + v_day_early_leave;

    v_days := v_days || jsonb_build_object(
      'date', v_record.record_date,
      'dow', v_day_dow,
      'expected_min', v_day_expected,
      'worked_min', v_day_worked,
      'late_min', v_day_late,
      'early_leave_min', v_day_early_leave,
      'diff_min', v_day_worked - v_day_expected,
      'first_punch', CASE WHEN array_length(v_clean_punches,1) > 0 THEN v_clean_punches[1] ELSE NULL END,
      'last_punch',  CASE WHEN array_length(v_clean_punches,1) > 0 THEN v_clean_punches[array_length(v_clean_punches,1)] ELSE NULL END,
      'punches', v_record.punches
    );
  END LOOP;

  v_week_diff := v_week_worked - v_week_expected;
  IF ABS(v_week_diff) <= v_tolerance_min THEN v_week_diff := 0; END IF;
  IF v_week_diff > 0 AND v_week_diff < v_min_overtime THEN v_week_diff := 0; END IF;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id,
    'employee_name', v_emp.name,
    'department', v_emp.department,
    'week_start', p_week_start,
    'week_end', v_week_end,
    'weekly_target_min', v_weekly_target_min,
    'week_worked_min', v_week_worked,
    'week_expected_min', v_week_expected,
    'week_late_min', v_week_late,
    'week_early_leave_min', v_week_early_leave,
    'week_overtime_min', GREATEST(0, v_week_diff),
    'week_deficit_min', LEAST(0, v_week_diff),
    'week_net_diff_min', v_week_diff,
    'tolerance_min', v_tolerance_min,
    'minimum_overtime_min', v_min_overtime,
    'days', v_days
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.calculate_weekly_he_breakdown(uuid, date) TO authenticated;

-- ── 4. Resolução de HE semanal (bank/pay/split) ──────────────────────────────
DROP FUNCTION IF EXISTS public.resolve_weekly_overtime(uuid, date, text, integer, integer, integer, text);

CREATE OR REPLACE FUNCTION public.resolve_weekly_overtime(
  p_employee_id   uuid,
  p_week_start    date,
  p_decision      text,
  p_bank_minutes  integer,
  p_pay_minutes   integer,
  p_total_minutes integer,
  p_notes         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp           record;
  v_hourly_rate   numeric;
  v_multiplier    numeric;
  v_pay_amount    numeric;
  v_bank_id       uuid;
  v_fin_id        uuid;
  v_resolution_id uuid;
  v_user          uuid;
  v_week_end      date;
BEGIN
  IF NOT user_has_any_role(ARRAY['admin','gerente','rh']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  v_user := auth.uid();
  p_week_start := date_trunc('week', p_week_start)::date;
  v_week_end := p_week_start + interval '6 days';

  IF p_decision NOT IN ('bank','pay','split') THEN
    RAISE EXCEPTION 'decision inválida: %', p_decision;
  END IF;

  IF p_decision = 'bank' THEN
    p_pay_minutes := 0;
    p_bank_minutes := p_total_minutes;
  ELSIF p_decision = 'pay' THEN
    p_bank_minutes := 0;
    p_pay_minutes := p_total_minutes;
  ELSIF p_decision = 'split' THEN
    IF (p_bank_minutes + p_pay_minutes) <> p_total_minutes THEN
      RAISE EXCEPTION 'split inconsistente';
    END IF;
  END IF;

  SELECT id, name, salary, overtime_multiplier, hourly_rate INTO v_emp
    FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN RAISE EXCEPTION 'Funcionário não encontrado'; END IF;

  v_hourly_rate := COALESCE(v_emp.hourly_rate, v_emp.salary / 220.0, 0);
  v_multiplier  := COALESCE(v_emp.overtime_multiplier, 1.20);
  v_pay_amount  := ROUND((p_pay_minutes / 60.0) * v_hourly_rate * v_multiplier, 2);

  IF p_bank_minutes > 0 THEN
    INSERT INTO public.bank_hours_movements (
      employee_id, movement_type, minutes, movement_date, description, created_by
    ) VALUES (
      p_employee_id, 'credit', p_bank_minutes, v_week_end,
      'Banco - HE Semana ' || to_char(p_week_start, 'DD/MM') || '-' || to_char(v_week_end, 'DD/MM/YYYY')
        || COALESCE(' - ' || p_notes, ''),
      v_user
    )
    RETURNING id INTO v_bank_id;
  END IF;

  IF p_pay_minutes > 0 AND v_pay_amount > 0 THEN
    INSERT INTO public.financial_entries (
      type, amount, status, description, reference_id, reference_type, entry_date, notes
    ) VALUES (
      'despesa', v_pay_amount, 'pendente',
      'HE Semana ' || to_char(p_week_start, 'DD/MM') || '-' || to_char(v_week_end, 'DD/MM/YYYY')
        || ' (' || v_emp.name || ') - '
        || (p_pay_minutes/60.0)::numeric(8,2) || 'h x R$ ' || v_hourly_rate::numeric(10,2) || ' x ' || v_multiplier,
      p_employee_id::text, 'employee_overtime_weekly', v_week_end,
      COALESCE(p_notes,'')
    )
    RETURNING id INTO v_fin_id;
  END IF;

  INSERT INTO public.overtime_resolutions (
    employee_id, month, period_type, overtime_minutes_total,
    hourly_rate_snapshot, multiplier_snapshot, decision,
    bank_minutes, pay_minutes, pay_amount,
    bank_movement_id, financial_entry_id, notes, resolved_by
  ) VALUES (
    p_employee_id, p_week_start, 'weekly', p_total_minutes,
    v_hourly_rate, v_multiplier, p_decision,
    p_bank_minutes, p_pay_minutes, v_pay_amount,
    v_bank_id, v_fin_id, p_notes, v_user
  )
  ON CONFLICT (employee_id, month, period_type) DO UPDATE SET
    overtime_minutes_total = EXCLUDED.overtime_minutes_total,
    hourly_rate_snapshot   = EXCLUDED.hourly_rate_snapshot,
    multiplier_snapshot    = EXCLUDED.multiplier_snapshot,
    decision               = EXCLUDED.decision,
    bank_minutes           = EXCLUDED.bank_minutes,
    pay_minutes            = EXCLUDED.pay_minutes,
    pay_amount             = EXCLUDED.pay_amount,
    bank_movement_id       = EXCLUDED.bank_movement_id,
    financial_entry_id     = EXCLUDED.financial_entry_id,
    notes                  = EXCLUDED.notes,
    resolved_by            = EXCLUDED.resolved_by,
    resolved_at            = now()
  RETURNING id INTO v_resolution_id;

  RETURN v_resolution_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_weekly_overtime(uuid, date, text, integer, integer, integer, text) TO authenticated;
