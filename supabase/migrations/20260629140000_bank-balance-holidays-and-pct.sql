-- RH/Banco de horas: tratamento correto de feriados + distinção 50/100
--
-- Antes: calculate_employee_bank_balance chamava calculate_day_summary com
--   p_is_holiday=false fixo. Resultado: feriados móveis (Carnaval, Páscoa,
--   Corpus Christi) eram tratados como dia útil normal — o funcionário que
--   trabalha em feriado tinha as horas contadas como simples, não como 100%.
--
-- Antes: retorno do RPC tinha só timesheet_min agregado (todas as HE num
--   bucket único). Tela de banco de horas e folha não conseguiam mostrar
--   quanto era HE 50% vs 100% sem recalcular do zero.
--
-- Agora:
--   1. RPC cruza record_date com tabela holidays (scope qualquer, ignora
--      ponto facultativo via COALESCE(optional,false)=false).
--   2. Domingo (dow=7) e feriado: a apuração semanal é PULADA pra esse
--      dia. As horas trabalhadas viram HE 100% individual (não conta pra
--      meta semanal pq é trabalho fora de jornada normal).
--   3. Retorno do RPC ganha timesheet_50_min / timesheet_100_min e
--      balance_50_min / balance_100_min. timesheet_min e balance_min
--      legacy continuam (= 50 + 100) pra retro-compat.
--   4. bank_hours_movements ganha overtime_pct (50, 100, NULL) pra
--      registrar o tipo de hora movimentada manualmente. Backfill NULL
--      — só novos lançamentos preenchem (UI pede a info).

-- ── 1. Coluna overtime_pct em bank_hours_movements ──────────────────────────
ALTER TABLE public.bank_hours_movements
  ADD COLUMN IF NOT EXISTS overtime_pct numeric NULL
  CHECK (overtime_pct IS NULL OR overtime_pct IN (50, 100));

COMMENT ON COLUMN public.bank_hours_movements.overtime_pct IS
  '% da hora extra: 50 = dia util/sabado, 100 = domingo/feriado, NULL = neutro/folga/legacy';

CREATE INDEX IF NOT EXISTS idx_bank_hours_movements_pct
  ON public.bank_hours_movements(employee_id, overtime_pct)
  WHERE overtime_pct IS NOT NULL;

-- ── 2. Refactor calculate_employee_bank_balance ─────────────────────────────
-- CASCADE drop derruba views dependentes (bank_hours_balance, v_bank_hours_summary)
-- que são recriadas logo abaixo com o schema novo.
DROP FUNCTION IF EXISTS public.calculate_employee_bank_balance(uuid, date, date) CASCADE;

CREATE OR REPLACE FUNCTION public.calculate_employee_bank_balance(
  p_employee_id uuid,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_emp record;
  v_sched record;
  v_movements_min int := 0;
  v_movements_50  int := 0;
  v_movements_100 int := 0;
  v_timesheet_min int := 0;
  v_timesheet_50  int := 0;
  v_timesheet_100 int := 0;
  v_days_worked int := 0;
  v_days_partial int := 0;
  v_total_min int;
  v_expected_per_day int;
  v_weekly_target_min int;
  v_tolerance_min int;
  v_min_overtime int;
  v_record record;
  v_sum jsonb;
  v_is_holiday boolean;
  v_week_key date;
  v_week_worked int := 0;
  v_week_expected int := 0;
  v_week_diff int;
  v_prev_week_key date := NULL;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN RETURN jsonb_build_object('error','Funcionário não encontrado'); END IF;

  SELECT * INTO v_sched FROM public.work_schedules
   WHERE id = v_emp.work_schedule_id OR (v_emp.work_schedule_id IS NULL AND is_default = true)
   LIMIT 1;

  v_weekly_target_min := COALESCE(v_sched.weekly_hours, 44) * 60;
  v_expected_per_day  := ROUND(v_weekly_target_min::numeric / 5);
  v_tolerance_min     := COALESCE(v_sched.tolerance_minutes, 10);
  v_min_overtime      := COALESCE(v_sched.minimum_overtime_minutes, 10);

  -- Lançamentos manuais — split por overtime_pct (NULL = neutro/folga)
  SELECT
    COALESCE(SUM(minutes), 0),
    COALESCE(SUM(CASE WHEN overtime_pct = 50  THEN minutes ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN overtime_pct = 100 THEN minutes ELSE 0 END), 0)
  INTO v_movements_min, v_movements_50, v_movements_100
    FROM public.bank_hours_movements
   WHERE employee_id = p_employee_id
     AND (p_from IS NULL OR movement_date >= p_from)
     AND (p_to   IS NULL OR movement_date <= p_to);

  FOR v_record IN
    SELECT tr.*, EXTRACT(ISODOW FROM tr.record_date)::int AS dow,
           date_trunc('week', tr.record_date)::date AS week_start
      FROM public.time_records tr
     WHERE (tr.employee_external_id = v_emp.external_id
            OR LOWER(TRIM(tr.employee_name)) = LOWER(TRIM(v_emp.name)))
       AND (p_from IS NULL OR tr.record_date >= p_from)
       AND (p_to   IS NULL OR tr.record_date <= p_to)
     ORDER BY tr.record_date ASC
  LOOP
    -- Ponto facultativo (optional=true) NÃO conta como holiday — empresa
    -- decide trabalhar, e quando trabalha é dia normal.
    SELECT EXISTS(
      SELECT 1 FROM public.holidays
       WHERE holiday_date = v_record.record_date
         AND COALESCE(optional, false) = false
    ) INTO v_is_holiday;

    v_week_key := v_record.week_start;

    -- Mudou de semana → fecha a anterior (HE 50%, dia útil)
    IF v_prev_week_key IS NOT NULL AND v_week_key <> v_prev_week_key THEN
      v_week_diff := v_week_worked - v_week_expected;
      IF ABS(v_week_diff) <= v_tolerance_min THEN v_week_diff := 0; END IF;
      IF v_week_diff > 0 AND v_week_diff < v_min_overtime THEN v_week_diff := 0; END IF;
      v_timesheet_min := v_timesheet_min + v_week_diff;
      v_timesheet_50  := v_timesheet_50  + v_week_diff;
      v_week_worked := 0;
      v_week_expected := 0;
    END IF;

    -- Feriado ou domingo → HE 100% (não entra na apuração semanal)
    IF v_is_holiday OR v_record.dow = 7 THEN
      v_sum := public.calculate_day_summary(
        v_record.punches,
        0,
        v_tolerance_min,
        v_min_overtime,
        true
      );
      v_days_worked := v_days_worked + 1;
      v_timesheet_min := v_timesheet_min + (v_sum->>'worked_min')::int;
      v_timesheet_100 := v_timesheet_100 + (v_sum->>'worked_min')::int;
      v_prev_week_key := v_week_key;
      CONTINUE;
    END IF;

    -- Dia normal/sábado: entra na apuração semanal
    v_sum := public.calculate_day_summary(
      v_record.punches,
      CASE WHEN v_record.dow = 6 AND v_sched.saturday_entry IS NOT NULL THEN
             EXTRACT(EPOCH FROM (v_sched.saturday_exit - v_sched.saturday_entry))::int / 60
           WHEN v_record.dow = 6 THEN 0
           ELSE v_expected_per_day
      END,
      v_tolerance_min,
      v_min_overtime,
      false
    );

    IF (v_sum->>'status') = 'partial' THEN
      v_days_partial := v_days_partial + 1;
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
    'expected_per_day_min', v_expected_per_day,
    'weekly_target_min', v_weekly_target_min,
    'minimum_overtime_min', v_min_overtime,
    'tolerance_min', v_tolerance_min,
    'period_from', p_from,
    'period_to', p_to,
    'apuracao', 'semanal_clt_v2_holidays_pct'
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.calculate_employee_bank_balance(uuid, date, date) TO authenticated;

-- ── 3. Recria views derrubadas pelo CASCADE com schema novo ────────────────
CREATE VIEW public.bank_hours_balance AS
SELECT
  e.id                                                  AS employee_id,
  e.name                                                AS employee_name,
  e.department,
  e.role,
  0                                                     AS initial_min,
  COALESCE((bal.payload ->> 'movements_min')::int, 0)   AS movements_min,
  COALESCE((bal.payload ->> 'timesheet_min')::int, 0)   AS timesheet_min,
  COALESCE((bal.payload ->> 'balance_min')::int, 0)     AS balance_min,
  COALESCE((bal.payload ->> 'balance_50_min')::int, 0)  AS balance_50_min,
  COALESCE((bal.payload ->> 'balance_100_min')::int, 0) AS balance_100_min,
  (SELECT COUNT(*)::int   FROM public.bank_hours_movements m WHERE m.employee_id = e.id) AS movement_count,
  (SELECT MAX(m.movement_date) FROM public.bank_hours_movements m WHERE m.employee_id = e.id) AS last_movement_date
FROM public.employees e
LEFT JOIN LATERAL (
  SELECT public.calculate_employee_bank_balance(e.id, NULL, NULL) AS payload
) bal ON true
WHERE e.active = true;

GRANT SELECT ON public.bank_hours_balance TO authenticated;

CREATE OR REPLACE VIEW public.v_bank_hours_summary AS
SELECT
  COUNT(DISTINCT e.id)                                                                    AS total_employees,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) > 0)                      AS employees_with_credit,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) < 0)                      AS employees_with_debit,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) = 0)                      AS employees_balanced,
  COALESCE(SUM(b.balance_min), 0)::int                                                    AS total_balance_min,
  COALESCE(SUM(b.balance_min) FILTER (WHERE b.balance_min > 0), 0)::int                   AS total_credit_min,
  COALESCE(SUM(b.balance_min) FILTER (WHERE b.balance_min < 0), 0)::int                   AS total_debit_min,
  COUNT(DISTINCT e.department)                                                            AS sector_count
FROM public.employees e
LEFT JOIN public.bank_hours_balance b ON b.employee_id = e.id
WHERE e.active = true;

GRANT SELECT ON public.v_bank_hours_summary TO authenticated;
