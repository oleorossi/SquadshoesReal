-- =============================================================================
-- RH expansion — partes que faltaram da migration 20260509120000
-- =============================================================================
--
-- Estado encontrado em produção (ssvxfoybzmjlypnipqzn):
--   ✗ benefits_config           (faltando — frontend usa em useRH/SmartDashboard/payrollCalc)
--   ✓ bank_hours_movements      (já existe)
--   ✗ absences                  (faltando)
--   ✓ payroll_runs              (já existe)
--   ✗ employees.cost_center, bank_hours_initial_min, receives_vt/vr/va, health_plan_value
--
-- Esta migration aplica APENAS o que falta, idempotente. NÃO recria a view
-- bank_hours_balance — ela foi corrigida em audit round 6 (LATERAL JOIN com
-- calculate_employee_bank_balance) e re-aplicar a versão antiga regrediria
-- o fix.
-- =============================================================================

-- 1. benefits_config (configuração da folha) ---------------------------------
CREATE TABLE IF NOT EXISTS public.benefits_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vt_daily_value           numeric(10,2) NOT NULL DEFAULT 0,
  vt_employee_discount_pct numeric(5,2)  NOT NULL DEFAULT 6,
  vr_daily_value           numeric(10,2) NOT NULL DEFAULT 0,
  va_monthly_value         numeric(10,2) NOT NULL DEFAULT 0,
  health_plan_default      numeric(10,2) NOT NULL DEFAULT 0,
  monthly_hours            integer       NOT NULL DEFAULT 220,
  overtime_50_pct          numeric(5,2)  NOT NULL DEFAULT 50,
  overtime_100_pct         numeric(5,2)  NOT NULL DEFAULT 100,
  night_bonus_pct          numeric(5,2)  NOT NULL DEFAULT 20,
  night_shift_start_min    integer       NOT NULL DEFAULT 1320, -- 22:00
  night_shift_end_min      integer       NOT NULL DEFAULT 300,  -- 05:00
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.benefits_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approved users select benefits_config" ON public.benefits_config;
DROP POLICY IF EXISTS "approved users modify benefits_config" ON public.benefits_config;
CREATE POLICY "approved users select benefits_config" ON public.benefits_config
  FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "approved users modify benefits_config" ON public.benefits_config
  FOR ALL TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

-- Garante uma linha default
INSERT INTO public.benefits_config (notes)
SELECT 'Configuração padrão. Edite valores conforme acordo coletivo.'
WHERE NOT EXISTS (SELECT 1 FROM public.benefits_config);

-- 2. employees — colunas RH faltando -----------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS cost_center            text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_hours_initial_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receives_vt            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS receives_vr            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_va            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS health_plan_value      numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.employees.bank_hours_initial_min IS
  'Saldo inicial do banco de horas em minutos, lançado no cadastro. Saldo final = '
  'inicial + SUM(bank_hours_movements.minutes) + derivado timesheet.';

COMMENT ON COLUMN public.employees.health_plan_value IS
  'Valor do plano de saúde descontado (sobrescreve benefits_config.health_plan_default '
  'quando > 0).';

-- 3. absences (ausências / atestados / faltas) ------------------------------
CREATE TABLE IF NOT EXISTS public.absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  absence_type text NOT NULL CHECK (absence_type IN (
    'atestado','licenca_maternidade','licenca_paternidade','licenca_obito','licenca_casamento',
    'falta_justificada','falta_injustificada','ferias','folga','abono','suspensao'
  )),
  paid          boolean NOT NULL DEFAULT false,
  hours_per_day numeric DEFAULT NULL,
  document_url  text DEFAULT '',
  notes         text DEFAULT '',
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_absences_employee_period
  ON public.absences(employee_id, start_date, end_date);

ALTER TABLE public.absences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approved users select absences" ON public.absences;
DROP POLICY IF EXISTS "approved users modify absences" ON public.absences;
CREATE POLICY "approved users select absences" ON public.absences
  FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "approved users modify absences" ON public.absences
  FOR ALL TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

COMMENT ON TABLE public.absences IS
  'Ausências do funcionário com período. Usado para relatório de absenteísmo e '
  'desconto na folha (faltas injustificadas).';
