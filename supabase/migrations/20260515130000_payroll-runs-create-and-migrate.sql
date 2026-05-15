-- =============================================================================
-- Cria payroll_runs (schema consolidado) + dropa employee_payroll órfã
-- =============================================================================
-- Contexto: o frontend (useRH/useEmployees) sempre usou `payroll_runs`, mas a
-- migration original 20260509120000 que cria essa tabela nunca foi aplicada
-- por completo no banco — o que ficou foi uma `employee_payroll` órfã (vazia,
-- 0 linhas, frontend nunca leu/gravou nela). Assim, todas as features de
-- folha (Payroll.tsx, vales, HE) só ficavam quebradas no runtime.
--
-- Esta migration consolida: schema original (20260509120000) + evolução
-- (20260628150000 — colunas extras, trigger pra ligar vales/HE, RPC), recria
-- a view v_employee_fgts_provision pra apontar pra payroll_runs (a v1
-- temporária dela apontava pra employee_payroll), e dropa employee_payroll.
--
-- Aplicada via MCP em 2026-05-15. Como employee_payroll estava vazia, não
-- houve migração de dados.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period      text NOT NULL,
  base_salary             numeric(10,2) NOT NULL DEFAULT 0,
  hourly_rate             numeric(10,4) NOT NULL DEFAULT 0,
  worked_minutes          integer NOT NULL DEFAULT 0,
  expected_minutes        integer NOT NULL DEFAULT 0,
  business_days           integer NOT NULL DEFAULT 0,
  business_days_worked    integer NOT NULL DEFAULT 0,
  absent_days             integer NOT NULL DEFAULT 0,
  overtime_amount         numeric(10,2) NOT NULL DEFAULT 0,
  overtime_50_minutes     integer NOT NULL DEFAULT 0,
  overtime_100_minutes    integer NOT NULL DEFAULT 0,
  night_minutes           integer NOT NULL DEFAULT 0,
  overtime_50_value       numeric(10,2) NOT NULL DEFAULT 0,
  overtime_100_value      numeric(10,2) NOT NULL DEFAULT 0,
  night_bonus_value       numeric(10,2) NOT NULL DEFAULT 0,
  dsr_value               numeric(10,2) NOT NULL DEFAULT 0,
  overtime_paid_value     numeric(10,2) NOT NULL DEFAULT 0,
  vr_value                numeric(10,2) NOT NULL DEFAULT 0,
  va_value                numeric(10,2) NOT NULL DEFAULT 0,
  vt_total_value          numeric(10,2) NOT NULL DEFAULT 0,
  vt_employee_discount    numeric(10,2) NOT NULL DEFAULT 0,
  health_plan_discount    numeric(10,2) NOT NULL DEFAULT 0,
  inss_value              numeric(10,2) NOT NULL DEFAULT 0,
  irrf_value              numeric(10,2) NOT NULL DEFAULT 0,
  absence_discount        numeric(10,2) NOT NULL DEFAULT 0,
  advances_total          numeric(10,2) NOT NULL DEFAULT 0,
  deductions_amount       numeric(10,2) NOT NULL DEFAULT 0,
  net_salary              numeric(10,2) NOT NULL DEFAULT 0,
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

-- Liga vales (employee_advances) e HE (overtime_resolutions) à folha
ALTER TABLE public.employee_advances
  ADD COLUMN IF NOT EXISTS payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_employee_advances_payroll_run
  ON public.employee_advances (payroll_run_id) WHERE payroll_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_advances_emp_period
  ON public.employee_advances (employee_id, advance_date);

ALTER TABLE public.overtime_resolutions
  ADD COLUMN IF NOT EXISTS payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_overtime_resolutions_payroll_run
  ON public.overtime_resolutions (payroll_run_id) WHERE payroll_run_id IS NOT NULL;

-- Trigger: marca/libera vales e HE conforme status da folha
CREATE OR REPLACE FUNCTION public.tg_payroll_link_advances_and_overtime()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_period_start date;
  v_period_end   date;
BEGIN
  v_period_start := (NEW.period || '-01')::date;
  v_period_end   := (v_period_start + interval '1 month - 1 day')::date;
  IF NEW.status IN ('aprovado','pago') AND (OLD.status IS NULL OR OLD.status='rascunho') THEN
    UPDATE public.employee_advances
       SET payroll_run_id = NEW.id, status = 'deducted', updated_at = now()
     WHERE employee_id = NEW.employee_id
       AND advance_date >= v_period_start AND advance_date <= v_period_end
       AND (payroll_run_id IS NULL OR payroll_run_id = NEW.id);
    UPDATE public.overtime_resolutions
       SET payroll_run_id = NEW.id
     WHERE employee_id = NEW.employee_id
       AND month = v_period_start
       AND (payroll_run_id IS NULL OR payroll_run_id = NEW.id);
    IF NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
  ELSIF NEW.status='rascunho' AND OLD.status IN ('aprovado','pago') THEN
    UPDATE public.employee_advances
       SET payroll_run_id = NULL, status = 'pending', updated_at = now()
     WHERE payroll_run_id = NEW.id;
    UPDATE public.overtime_resolutions SET payroll_run_id = NULL WHERE payroll_run_id = NEW.id;
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_link_advances_and_overtime ON public.payroll_runs;
CREATE TRIGGER trg_payroll_link_advances_and_overtime
  BEFORE UPDATE OF status ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_link_advances_and_overtime();

-- RPC: vales + HE pendentes do funcionário no período
CREATE OR REPLACE FUNCTION public.get_payroll_inputs_for_period(p_employee_id uuid, p_period text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_period_start date := (p_period || '-01')::date;
  v_period_end   date := (v_period_start + interval '1 month - 1 day')::date;
  v_advances jsonb; v_advances_total numeric;
  v_overtime jsonb; v_overtime_pay numeric;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'date',advance_date,'amount',amount,'description',description,'status',status,'payroll_run_id',payroll_run_id)),'[]'::jsonb), COALESCE(SUM(amount),0)
    INTO v_advances, v_advances_total
    FROM public.employee_advances
   WHERE employee_id = p_employee_id
     AND advance_date >= v_period_start AND advance_date <= v_period_end
     AND (payroll_run_id IS NULL OR EXISTS (
            SELECT 1 FROM public.payroll_runs pr
             WHERE pr.id = employee_advances.payroll_run_id
               AND pr.employee_id = p_employee_id AND pr.period = p_period));
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'month',month,'decision',decision,'pay_minutes',pay_minutes,'bank_minutes',bank_minutes,'pay_amount',pay_amount,'payroll_run_id',payroll_run_id)),'[]'::jsonb),
         COALESCE(SUM(CASE WHEN decision IN ('pay','split') THEN pay_amount ELSE 0 END),0)
    INTO v_overtime, v_overtime_pay
    FROM public.overtime_resolutions
   WHERE employee_id = p_employee_id AND month = v_period_start;
  RETURN jsonb_build_object('advances',v_advances,'advances_total',v_advances_total,'overtime_resolutions',v_overtime,'overtime_paid_value',v_overtime_pay);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_payroll_inputs_for_period(uuid, text) TO authenticated;

-- Recria v_employee_fgts_provision apontando pra payroll_runs
DROP VIEW IF EXISTS public.v_employee_fgts_provision CASCADE;
CREATE VIEW public.v_employee_fgts_provision AS
SELECT
  pr.employee_id,
  e.name AS employee_name,
  pr.period,
  pr.base_salary,
  pr.overtime_amount,
  ROUND((pr.base_salary + COALESCE(pr.overtime_amount, 0)), 2) AS fgts_base,
  ROUND((pr.base_salary + COALESCE(pr.overtime_amount, 0)) * 0.08, 2) AS fgts_valor,
  pr.status AS payroll_status
FROM public.payroll_runs pr
JOIN public.employees e ON e.id = pr.employee_id
WHERE pr.status IN ('aprovado','pago');
GRANT SELECT ON public.v_employee_fgts_provision TO authenticated;

-- Recria v_clt_provisions_summary (caiu via CASCADE)
CREATE OR REPLACE VIEW public.v_clt_provisions_summary AS
SELECT
  to_char(CURRENT_DATE, 'YYYY-MM') AS period,
  (SELECT COUNT(*) FROM public.employees WHERE active = true) AS active_employees,
  COALESCE((SELECT SUM(provisao_mes_atual) FROM public.v_employee_13o_provision), 0) AS provisao_13o_mes_atual,
  COALESCE((SELECT SUM(provisao_acumulada) FROM public.v_employee_13o_provision), 0) AS provisao_13o_acumulada,
  COALESCE((SELECT SUM(provisao_total) FROM public.v_employee_vacation_balance), 0) AS provisao_ferias_total,
  COALESCE((SELECT SUM(fgts_valor) FROM public.v_employee_fgts_provision
            WHERE period = to_char(CURRENT_DATE, 'YYYY-MM')), 0) AS fgts_mes_atual,
  COALESCE((SELECT SUM(fgts_valor) FROM public.v_employee_fgts_provision
            WHERE period LIKE to_char(CURRENT_DATE, 'YYYY') || '%'), 0) AS fgts_ano_atual;
GRANT SELECT ON public.v_clt_provisions_summary TO authenticated;

-- Drop tabela órfã
DROP TABLE IF EXISTS public.employee_payroll;
