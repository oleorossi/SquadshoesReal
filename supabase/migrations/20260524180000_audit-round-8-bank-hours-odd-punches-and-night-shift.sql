-- =============================================================================
-- AUDIT ROUND 8 — Cálculo de banco de horas: punches ímpares e turno noturno
-- =============================================================================
-- 🔴 BUG #7 — Punches ímpares (3 ou 5) descartam batidas e geram saldo errado
--    O algoritmo de calculate_employee_bank_balance usa pareamento sequencial
--    `WHILE v_punch_idx < jsonb_array_length - 1` em saltos de +2. Se há 3
--    batidas (esqueceu saída final), pareia [0,1], descarta [2], conta apenas
--    o turno da manhã (~4h) e marca como dia completo. Funcionário que
--    trabalhou jornada inteira fica com déficit gigante.
--
--    Em produção: 260 dias com 3 punches + 51 dias com 5 punches = 311
--    ocorrências afetando o saldo real.
--
--    Fix: punches ímpares > 1 viram days_partial (incompleto, não soma ao
--    timesheet_min). Operador trata manualmente via bank_hours_movements.
--
-- 🟡 BUG #8 — Turno noturno (cruzamento de meia-noite) gera minutos negativos
--    Se entrada=22:00 e saída=06:00, `out_time - in_time` = -16h. O delta
--    negativo é somado ao v_worked_min, distorcendo o saldo.
--
--    0 ocorrências em prod hoje (preventivo), mas fix junto.
--
--    Fix: detectar v_out < v_in e somar 24h ao delta antes de calcular.
-- =============================================================================

-- CREATE OR REPLACE preserva a assinatura, então a VIEW bank_hours_balance
-- (que faz LATERAL JOIN à função, criada na round 6) NÃO é dropada por
-- CASCADE — não precisa recriar a view.
CREATE OR REPLACE FUNCTION public.calculate_employee_bank_balance(
  p_employee_id uuid,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp record;
  v_sched record;
  v_movements_min  integer := 0;
  v_timesheet_min  integer := 0;
  v_days_worked    integer := 0;
  v_days_partial   integer := 0;
  v_total_min      integer;
  v_expected_per_day_min integer;
  v_tolerance_min  integer;
  v_min_overtime_min integer;
  v_record record;
  v_punches jsonb;
  v_worked_min integer;
  v_diff_min integer;
  v_pair_count int;
  v_in_time time;
  v_out_time time;
  v_punch_idx int;
  v_punch_count int;
  v_pair_minutes int;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Funcionário não encontrado');
  END IF;

  SELECT * INTO v_sched FROM public.work_schedules
  WHERE id = v_emp.work_schedule_id OR (v_emp.work_schedule_id IS NULL AND is_default = true)
  LIMIT 1;

  v_expected_per_day_min := COALESCE(ROUND((COALESCE(v_sched.weekly_hours, 44.0) / 5.0) * 60), 528);
  v_tolerance_min := COALESCE(v_sched.tolerance_minutes, 10);
  v_min_overtime_min := COALESCE(v_sched.minimum_overtime_minutes, 0);

  SELECT COALESCE(SUM(minutes), 0) INTO v_movements_min
  FROM public.bank_hours_movements
  WHERE employee_id = p_employee_id
    AND (p_from IS NULL OR movement_date >= p_from)
    AND (p_to IS NULL OR movement_date <= p_to);

  FOR v_record IN
    SELECT * FROM public.time_records
    WHERE (
      employee_external_id = v_emp.external_id
      OR LOWER(TRIM(employee_name)) = LOWER(TRIM(v_emp.name))
    )
    AND (p_from IS NULL OR record_date >= p_from)
    AND (p_to IS NULL OR record_date <= p_to)
  LOOP
    v_punches := v_record.punches;
    v_worked_min := 0;
    v_pair_count := 0;

    IF v_punches IS NULL OR jsonb_typeof(v_punches) <> 'array' THEN
      v_punch_count := 0;
    ELSE
      v_punch_count := jsonb_array_length(v_punches);
    END IF;

    -- BUG #7 fix: punches ímpares (>1) são incompletos. Marcar como dia
    -- parcial e não somar ao timesheet_min — assim o saldo não fica negativo
    -- por uma batida esquecida. Operador ajusta via bank_hours_movements
    -- ou correção da batida.
    IF v_punch_count > 1 AND (v_punch_count % 2) <> 0 THEN
      v_days_partial := v_days_partial + 1;
      CONTINUE;
    END IF;

    IF v_punch_count >= 2 THEN
      v_punch_idx := 0;
      WHILE v_punch_idx < v_punch_count - 1 LOOP
        BEGIN
          v_in_time := (v_punches->v_punch_idx)::text::time;
          v_out_time := (v_punches->(v_punch_idx + 1))::text::time;
          v_pair_minutes := EXTRACT(EPOCH FROM (v_out_time - v_in_time))::int / 60;

          -- BUG #8 fix: cruzamento de meia-noite (out < in) — somar 24h
          -- ao delta. Sem isso, turno noturno gera minutos negativos.
          IF v_pair_minutes < 0 THEN
            v_pair_minutes := v_pair_minutes + 24 * 60;
          END IF;

          v_worked_min := v_worked_min + v_pair_minutes;
          v_pair_count := v_pair_count + 1;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        v_punch_idx := v_punch_idx + 2;
      END LOOP;
    END IF;

    IF v_pair_count > 0 THEN
      v_days_worked := v_days_worked + 1;
      v_diff_min := v_worked_min - v_expected_per_day_min;
      IF ABS(v_diff_min) <= v_tolerance_min THEN
        v_diff_min := 0;
      END IF;
      IF v_diff_min > 0 AND v_diff_min < v_min_overtime_min THEN
        v_diff_min := 0;
      END IF;
      v_timesheet_min := v_timesheet_min + v_diff_min;
    ELSE
      v_days_partial := v_days_partial + 1;
    END IF;
  END LOOP;

  v_total_min := v_movements_min + v_timesheet_min;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id,
    'employee_name', v_emp.name,
    'department', v_emp.department,
    'movements_min', v_movements_min,
    'timesheet_min', v_timesheet_min,
    'balance_min', v_total_min,
    'days_worked', v_days_worked,
    'days_partial', v_days_partial,
    'expected_per_day_min', v_expected_per_day_min,
    'period_from', p_from,
    'period_to', p_to
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.calculate_employee_bank_balance(uuid, date, date) TO authenticated;

-- A view bank_hours_balance (recriada na round 6 com LATERAL JOIN à função
-- acima) automaticamente reflete o novo cálculo — não precisa recriar.
-- v_bank_hours_summary depende da view; também herda automático.
