-- =============================================================================
-- BANCO DE HORAS — sistema completo
-- =============================================================================
-- Frontend (useRH.ts) referenciava 3 tables que NÃO existiam:
--   - bank_hours_balance       (saldo agregado por funcionário)
--   - bank_hours_movements     (lançamentos de crédito/débito)
--   - payroll_runs             (folha de pagamento por período)
-- Existia employee_bank_hours legacy mas com schema incompatível.
--
-- User: "Falha ao carregar bank_hours_balance: Could not find the table
--       'public.bank_hours_balance' in the schema cache"
--       "fazer isso de forma completa com várias funcionalidade e relatórios"
--
-- Esta migration cria:
--   #1 bank_hours_movements (lançamentos manuais + auto-import)
--   #2 payroll_runs (folha por período, gate pra mexer no banco)
--   #3 calculate_employee_bank_balance() — RPC que combina movements
--      + saldo derivado de time_records vs work_schedules
--   #4 bank_hours_balance VIEW — saldo de cada funcionário ativo
--   #5 v_bank_hours_per_sector — agregação por departamento (relatório)
--   #6 v_bank_hours_summary — KPIs gerais
--   #7 Trigger updated_at em payroll_runs
--
-- Aplicada em produção via Supabase MCP em 2026-05-08.
-- =============================================================================

-- #1 bank_hours_movements
CREATE TABLE IF NOT EXISTS public.bank_hours_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  movement_date date NOT NULL,
  minutes       integer NOT NULL,
  movement_type text NOT NULL DEFAULT 'manual'
                CHECK (movement_type IN ('credit','debit','compensation','timesheet_auto','adjustment','manual')),
  description   text,
  reference_id  uuid,
  reference_type text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_hours_mov_emp_date
  ON public.bank_hours_movements (employee_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_hours_mov_period
  ON public.bank_hours_movements (movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_hours_mov_ref
  ON public.bank_hours_movements (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

ALTER TABLE public.bank_hours_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read bank_hours_movements" ON public.bank_hours_movements;
CREATE POLICY "Authenticated can read bank_hours_movements"
  ON public.bank_hours_movements FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Approved can write bank_hours_movements" ON public.bank_hours_movements;
CREATE POLICY "Approved can write bank_hours_movements"
  ON public.bank_hours_movements FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.bank_hours_movements IS
  'Lançamentos de banco de horas. minutes positivo = crédito, negativo = débito.';

-- #2 payroll_runs
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period      text NOT NULL,
  status      text NOT NULL DEFAULT 'rascunho'
              CHECK (status IN ('rascunho','aprovado','pago','cancelado')),
  base_salary numeric(12,2),
  overtime_minutes integer DEFAULT 0,
  overtime_amount numeric(12,2) DEFAULT 0,
  deductions  numeric(12,2) DEFAULT 0,
  net_salary  numeric(12,2),
  paid_at     timestamptz,
  notes       text,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (employee_id, period)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_employee_period
  ON public.payroll_runs (employee_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status
  ON public.payroll_runs (status, period DESC);

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read payroll_runs" ON public.payroll_runs;
CREATE POLICY "Authenticated can read payroll_runs"
  ON public.payroll_runs FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Approved can write payroll_runs" ON public.payroll_runs;
CREATE POLICY "Approved can write payroll_runs"
  ON public.payroll_runs FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- #3 RPC: calcula saldo do banco de horas (movements + derivado de timesheet)
DROP FUNCTION IF EXISTS public.calculate_employee_bank_balance(uuid, date, date) CASCADE;
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

    IF v_punches IS NOT NULL AND jsonb_typeof(v_punches) = 'array' THEN
      v_punch_idx := 0;
      WHILE v_punch_idx < jsonb_array_length(v_punches) - 1 LOOP
        BEGIN
          v_in_time := (v_punches->v_punch_idx)::text::time;
          v_out_time := (v_punches->(v_punch_idx + 1))::text::time;
          v_worked_min := v_worked_min + EXTRACT(EPOCH FROM (v_out_time - v_in_time))::int / 60;
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

-- #4 VIEW bank_hours_balance
DROP VIEW IF EXISTS public.bank_hours_balance CASCADE;
CREATE VIEW public.bank_hours_balance AS
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  e.department,
  e.role,
  0 AS initial_min,
  COALESCE(SUM(m.minutes), 0)::int AS movements_min,
  COALESCE(SUM(m.minutes), 0)::int AS balance_min,
  COUNT(m.id)::int AS movement_count,
  MAX(m.movement_date) AS last_movement_date
FROM public.employees e
LEFT JOIN public.bank_hours_movements m ON m.employee_id = e.id
WHERE e.active = true
GROUP BY e.id, e.name, e.department, e.role;
GRANT SELECT ON public.bank_hours_balance TO authenticated;

-- #5 v_bank_hours_per_sector
CREATE OR REPLACE VIEW public.v_bank_hours_per_sector AS
SELECT
  COALESCE(e.department, 'Sem setor') AS department,
  COUNT(DISTINCT e.id) AS employee_count,
  COALESCE(SUM(m.minutes), 0)::int AS total_balance_min,
  COALESCE(SUM(m.minutes) FILTER (WHERE m.minutes > 0), 0)::int AS total_credit_min,
  COALESCE(SUM(m.minutes) FILTER (WHERE m.minutes < 0), 0)::int AS total_debit_min,
  COUNT(DISTINCT m.id) AS movement_count
FROM public.employees e
LEFT JOIN public.bank_hours_movements m ON m.employee_id = e.id
WHERE e.active = true
GROUP BY e.department
ORDER BY total_balance_min DESC;
GRANT SELECT ON public.v_bank_hours_per_sector TO authenticated;

-- #6 v_bank_hours_summary
CREATE OR REPLACE VIEW public.v_bank_hours_summary AS
SELECT
  COUNT(DISTINCT e.id) AS total_employees,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) > 0) AS employees_with_credit,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) < 0) AS employees_with_debit,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) = 0) AS employees_balanced,
  COALESCE(SUM(b.balance_min), 0)::int AS total_balance_min,
  COALESCE(SUM(b.balance_min) FILTER (WHERE b.balance_min > 0), 0)::int AS total_credit_min,
  COALESCE(SUM(b.balance_min) FILTER (WHERE b.balance_min < 0), 0)::int AS total_debit_min,
  COUNT(DISTINCT e.department) AS sector_count
FROM public.employees e
LEFT JOIN public.bank_hours_balance b ON b.employee_id = e.id
WHERE e.active = true;
GRANT SELECT ON public.v_bank_hours_summary TO authenticated;

-- #7 Trigger
DROP TRIGGER IF EXISTS update_payroll_runs_updated_at ON public.payroll_runs;
CREATE TRIGGER update_payroll_runs_updated_at
  BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
