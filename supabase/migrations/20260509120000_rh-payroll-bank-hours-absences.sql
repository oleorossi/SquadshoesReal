-- =============================================================================
-- RH expansion — Folha, Banco de Horas, Ausências, Benefícios
-- =============================================================================
--
-- Adds the data layer for the "padrão grande empresa" RH features:
--   1. benefits_config            — tabela de configuração (singleton-like; primeira linha vence)
--                                   Define valores de VT/VR/VA/saúde, alíquotas
--                                   noturno/HE, divisor mensal de horas, etc.
--   2. employees + extras          — adiciona centro_custo, banco_horas_inicial,
--                                   recebe_vt/recebe_vr/recebe_va/plano_saude_proprio
--   3. bank_hours_movements        — cada lançamento (crédito/débito/ajuste) no banco
--                                   de horas em minutos. saldo = SUM(minutes).
--   4. absences                    — ausências (atestado, falta, licença, férias,
--                                   abono) com período inicial/final.
--   5. payroll_runs                — folha calculada por (employee, period YYYY-MM).
--                                   Persiste todos os componentes do cálculo.
--
-- Todas as tabelas seguem o padrão RLS-on + policies restritas a usuários
-- aprovados via is_approved_user(), igual às demais tabelas sensíveis do ERP.
-- =============================================================================

-- =====================================================
-- 1. benefits_config (configuração da folha)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.benefits_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Valores padrão de benefícios (podem ser sobrescritos por funcionário)
  vt_daily_value           numeric(10,2) NOT NULL DEFAULT 0,    -- valor por dia útil de VT
  vt_employee_discount_pct numeric(5,2)  NOT NULL DEFAULT 6,    -- desconto sobre salário (CLT teto 6%)
  vr_daily_value           numeric(10,2) NOT NULL DEFAULT 0,    -- vale-refeição por dia útil
  va_monthly_value         numeric(10,2) NOT NULL DEFAULT 0,    -- vale-alimentação mensal fixo
  health_plan_default      numeric(10,2) NOT NULL DEFAULT 0,    -- desconto plano de saúde

  -- Cálculo de horas
  monthly_hours            integer       NOT NULL DEFAULT 220,  -- divisor mensal (220h padrão CLT 44h/sem)
  overtime_50_pct          numeric(5,2)  NOT NULL DEFAULT 50,   -- HE em dia útil
  overtime_100_pct         numeric(5,2)  NOT NULL DEFAULT 100,  -- HE em domingo/feriado
  night_bonus_pct          numeric(5,2)  NOT NULL DEFAULT 20,   -- adicional noturno (CLT mínimo 20%)
  night_shift_start_min    integer       NOT NULL DEFAULT 1320, -- 22:00 em minutos do dia
  night_shift_end_min      integer       NOT NULL DEFAULT 300,  -- 05:00 em minutos do dia (cruza meia-noite)

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

-- =====================================================
-- 2. employees — campos de RH adicionais
-- =====================================================
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS cost_center            text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_hours_initial_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receives_vt            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS receives_vr            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receives_va            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS health_plan_value      numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.employees.bank_hours_initial_min IS
  'Saldo inicial do banco de horas em minutos, lançado no cadastro do funcionário. '
  'O saldo final = inicial + SUM(bank_hours_movements.minutes).';

COMMENT ON COLUMN public.employees.health_plan_value IS
  'Valor do plano de saúde descontado do funcionário (sobrescreve benefits_config.health_plan_default '
  'quando > 0).';

-- =====================================================
-- 3. bank_hours_movements (banco de horas)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.bank_hours_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  movement_type text NOT NULL CHECK (movement_type IN ('credit','debit','adjustment','compensation','payout')),
  minutes       integer NOT NULL,  -- positivo = crédito, negativo = débito
  reason        text DEFAULT '',
  reference_id  uuid,              -- opcional: link para time_record, payroll_run, etc
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_hours_employee_date
  ON public.bank_hours_movements(employee_id, movement_date);

ALTER TABLE public.bank_hours_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approved users select bank_hours" ON public.bank_hours_movements;
DROP POLICY IF EXISTS "approved users modify bank_hours" ON public.bank_hours_movements;
CREATE POLICY "approved users select bank_hours" ON public.bank_hours_movements
  FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "approved users modify bank_hours" ON public.bank_hours_movements
  FOR ALL TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

COMMENT ON TABLE public.bank_hours_movements IS
  'Cada lançamento do banco de horas em minutos. Saldo de um funcionário = '
  'employees.bank_hours_initial_min + SUM(minutes). Tipos: credit (HE não paga), '
  'debit (folga compensada), adjustment (ajuste manual com motivo), '
  'compensation (compensação em outro dia), payout (banco zerado por pagamento).';

-- View consolidada do saldo
CREATE OR REPLACE VIEW public.bank_hours_balance AS
SELECT
  e.id                          AS employee_id,
  e.name                        AS employee_name,
  e.bank_hours_initial_min      AS initial_min,
  COALESCE(SUM(m.minutes), 0)   AS movements_min,
  e.bank_hours_initial_min + COALESCE(SUM(m.minutes), 0) AS balance_min
FROM public.employees e
LEFT JOIN public.bank_hours_movements m ON m.employee_id = e.id
GROUP BY e.id, e.name, e.bank_hours_initial_min;

-- =====================================================
-- 4. absences (ausências / atestados / faltas)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  absence_type text NOT NULL CHECK (absence_type IN (
    'atestado','licenca_maternidade','licenca_paternidade','licenca_obito','licenca_casamento',
    'falta_justificada','falta_injustificada','ferias','folga','abono','suspensao'
  )),
  paid          boolean NOT NULL DEFAULT false,  -- afasta sem perder remuneração?
  hours_per_day numeric DEFAULT NULL,            -- NULL = dia inteiro; preenchido = ausência parcial
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

-- =====================================================
-- 5. payroll_runs (folha de pagamento mensal)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period      text NOT NULL,  -- YYYY-MM (ex: '2026-04')

  -- Cabeçalho
  base_salary             numeric(10,2) NOT NULL DEFAULT 0,
  hourly_rate             numeric(10,4) NOT NULL DEFAULT 0,

  -- Horas trabalhadas
  worked_minutes          integer NOT NULL DEFAULT 0,
  expected_minutes        integer NOT NULL DEFAULT 0,
  business_days           integer NOT NULL DEFAULT 0,
  business_days_worked    integer NOT NULL DEFAULT 0,
  absent_days             integer NOT NULL DEFAULT 0,

  -- Adicionais
  overtime_50_minutes     integer NOT NULL DEFAULT 0,
  overtime_100_minutes    integer NOT NULL DEFAULT 0,
  night_minutes           integer NOT NULL DEFAULT 0,
  overtime_50_value       numeric(10,2) NOT NULL DEFAULT 0,
  overtime_100_value      numeric(10,2) NOT NULL DEFAULT 0,
  night_bonus_value       numeric(10,2) NOT NULL DEFAULT 0,
  dsr_value               numeric(10,2) NOT NULL DEFAULT 0,

  -- Benefícios (proventos)
  vr_value                numeric(10,2) NOT NULL DEFAULT 0,
  va_value                numeric(10,2) NOT NULL DEFAULT 0,

  -- Descontos
  vt_total_value          numeric(10,2) NOT NULL DEFAULT 0,  -- valor total VT pago pela empresa
  vt_employee_discount    numeric(10,2) NOT NULL DEFAULT 0,  -- parte descontada do funcionário (≤6%)
  health_plan_discount    numeric(10,2) NOT NULL DEFAULT 0,
  inss_value              numeric(10,2) NOT NULL DEFAULT 0,
  irrf_value              numeric(10,2) NOT NULL DEFAULT 0,
  absence_discount        numeric(10,2) NOT NULL DEFAULT 0,  -- desconto por faltas injustificadas
  advances_total          numeric(10,2) NOT NULL DEFAULT 0,  -- soma de employee_advances no período

  -- Totais
  total_proventos         numeric(10,2) NOT NULL DEFAULT 0,
  total_descontos         numeric(10,2) NOT NULL DEFAULT 0,
  total_liquido           numeric(10,2) NOT NULL DEFAULT 0,

  status      text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aprovado','pago')),
  notes       text DEFAULT '',
  approved_at timestamptz,
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (employee_id, period)
);

CREATE INDEX IF NOT EXISTS idx_payroll_period ON public.payroll_runs(period);

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approved users select payroll" ON public.payroll_runs;
DROP POLICY IF EXISTS "approved users modify payroll" ON public.payroll_runs;
CREATE POLICY "approved users select payroll" ON public.payroll_runs
  FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "approved users modify payroll" ON public.payroll_runs
  FOR ALL TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

COMMENT ON TABLE public.payroll_runs IS
  'Folha de pagamento por (employee, period). Cada linha representa o cálculo '
  'do mês para um funcionário. Alíquotas e bases (INSS/IRRF) são calculadas no '
  'TS via tabela vigente; valores resultantes ficam congelados aqui após aprovação.';
