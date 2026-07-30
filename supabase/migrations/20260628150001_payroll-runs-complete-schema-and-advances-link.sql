-- =============================================================================
-- Folha de pagamento: schema completo + link com vales + HE pagas
-- =============================================================================
-- Problema P0 detectado em 2026-05-13:
--
-- 1. Frontend (Payroll.tsx + useRH.ts:PayrollRun) assume colunas que NÃO
--    EXISTEM em payroll_runs: advances_total, total_proventos, total_descontos,
--    total_liquido, inss_value, irrf_value, vr_value, va_value, vt_*,
--    health_plan_discount, absence_discount, overtime_50_value,
--    overtime_100_value, night_bonus_value, dsr_value, approved_at.
--    PostgREST descartava silenciosamente → cálculo de folha ficava no client
--    mas nunca persistia componentes.
--
-- 2. employee_advances.status fica eternamente em 'pending' — não há
--    payroll_run_id pra rastrear qual folha descontou cada vale. Risco:
--    calcular folha 2× desconta vale 2×; reabrir folha esquece de liberar.
--
-- 3. overtime_resolutions cria financial_entry de HE paga, mas a folha do
--    funcionário não enxerga esse adicional. Operador paga HE separado da
--    folha → dois pagamentos.
--
-- Solução:
--   A) Adicionar TODAS as colunas que o frontend manda em payroll_runs.
--   B) Adicionar payroll_run_id em employee_advances + valores 'deducted'/'paid'
--      no status. Trigger marca/libera automaticamente quando folha muda status.
--   C) overtime_resolutions.payroll_run_id pra ligar à folha (já cria
--      financial_entry, agora liga também à folha do funcionário).
-- =============================================================================


-- ─── A. payroll_runs: colunas completas ─────────────────────────────────────
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS advances_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_proventos numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_descontos numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_liquido numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inss_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS irrf_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vr_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS va_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vt_total_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vt_employee_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_plan_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS absence_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_50_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_100_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS night_bonus_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dsr_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_paid_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

COMMENT ON COLUMN public.payroll_runs.advances_total IS
  'Soma dos vales (employee_advances) do funcionário no período. Já descontado em total_liquido.';
COMMENT ON COLUMN public.payroll_runs.overtime_paid_value IS
  'Valor das horas extras decididas como "pay" em overtime_resolutions deste período. '
  'Soma com base_salary nos proventos e fecha o ciclo: HE paga aparece NA folha (não em entry separada).';
COMMENT ON COLUMN public.payroll_runs.approved_at IS
  'Quando o gerente aprovou a folha (status passou de rascunho para aprovado).';


-- ─── B. employee_advances: link com folha + status estendido ───────────────
ALTER TABLE public.employee_advances
  ADD COLUMN IF NOT EXISTS payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employee_advances_payroll_run
  ON public.employee_advances (payroll_run_id)
  WHERE payroll_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_advances_emp_period
  ON public.employee_advances (employee_id, advance_date);

COMMENT ON COLUMN public.employee_advances.payroll_run_id IS
  'Folha que descontou este vale. NULL = ainda pendente. '
  'Setado automaticamente via trigger quando folha vira "aprovado".';


-- ─── C. overtime_resolutions: link com folha ───────────────────────────────
ALTER TABLE public.overtime_resolutions
  ADD COLUMN IF NOT EXISTS payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_overtime_resolutions_payroll_run
  ON public.overtime_resolutions (payroll_run_id)
  WHERE payroll_run_id IS NOT NULL;


-- ─── Trigger: marca/libera vales e HE pagas conforme status da folha ───────
-- Aprovado: payroll_run_id = NEW.id em todos os advances do período
--           + overtime_resolutions com decision IN ('pay','split') do mesmo
--             funcionário/mês ligam aqui.
-- Rascunho (volta): payroll_run_id = NULL (libera pra próxima folha)
CREATE OR REPLACE FUNCTION public.tg_payroll_link_advances_and_overtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_start date;
  v_period_end   date;
BEGIN
  -- period é "YYYY-MM" — converte pra intervalo
  v_period_start := (NEW.period || '-01')::date;
  v_period_end   := (v_period_start + interval '1 month - 1 day')::date;

  IF NEW.status IN ('aprovado', 'pago')
     AND (OLD.status IS NULL OR OLD.status = 'rascunho') THEN
    -- Vai aprovar: marca advances e HE deste funcionário/mês
    UPDATE public.employee_advances
       SET payroll_run_id = NEW.id,
           status = 'deducted',
           updated_at = now()
     WHERE employee_id = NEW.employee_id
       AND advance_date >= v_period_start
       AND advance_date <= v_period_end
       AND (payroll_run_id IS NULL OR payroll_run_id = NEW.id);

    UPDATE public.overtime_resolutions
       SET payroll_run_id = NEW.id
     WHERE employee_id = NEW.employee_id
       AND month = v_period_start
       AND (payroll_run_id IS NULL OR payroll_run_id = NEW.id);

    -- approved_at é setado uma vez (no primeiro aprovado)
    IF NEW.approved_at IS NULL THEN
      NEW.approved_at := now();
    END IF;

  ELSIF NEW.status = 'rascunho' AND OLD.status IN ('aprovado', 'pago') THEN
    -- Reabertura: libera advances (volta pra pending) e HE (desliga da folha)
    UPDATE public.employee_advances
       SET payroll_run_id = NULL,
           status = 'pending',
           updated_at = now()
     WHERE payroll_run_id = NEW.id;

    UPDATE public.overtime_resolutions
       SET payroll_run_id = NULL
     WHERE payroll_run_id = NEW.id;

    NEW.approved_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_link_advances_and_overtime ON public.payroll_runs;
CREATE TRIGGER trg_payroll_link_advances_and_overtime
  BEFORE UPDATE OF status ON public.payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_payroll_link_advances_and_overtime();

COMMENT ON FUNCTION public.tg_payroll_link_advances_and_overtime() IS
  'Sincroniza employee_advances e overtime_resolutions com a folha quando '
  'status muda. Aprovado → marca todos os vales/HE do período como '
  'descontados nesta folha. Reaberto (rascunho) → libera pra próxima folha. '
  'Garante que vale nunca é descontado 2× nem fica preso após reabertura.';


-- ─── RPC: lista vales e HE pendentes de um funcionário no período ──────────
-- Frontend usa pra mostrar "5 vales pendentes (R$ 850) + HE paga R$ 320" no
-- card de cada funcionário ao calcular a folha.
CREATE OR REPLACE FUNCTION public.get_payroll_inputs_for_period(
  p_employee_id uuid,
  p_period text  -- 'YYYY-MM'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_start date := (p_period || '-01')::date;
  v_period_end   date := (v_period_start + interval '1 month - 1 day')::date;
  v_advances jsonb;
  v_advances_total numeric;
  v_overtime jsonb;
  v_overtime_pay numeric;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'date', advance_date, 'amount', amount,
           'description', description, 'status', status,
           'payroll_run_id', payroll_run_id
         )), '[]'::jsonb),
         COALESCE(SUM(amount), 0)
    INTO v_advances, v_advances_total
    FROM public.employee_advances
   WHERE employee_id = p_employee_id
     AND advance_date >= v_period_start
     AND advance_date <= v_period_end
     AND (payroll_run_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.payroll_runs pr
             WHERE pr.id = employee_advances.payroll_run_id
               AND pr.employee_id = p_employee_id
               AND pr.period = p_period
          ));

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'month', month, 'decision', decision,
           'pay_minutes', pay_minutes, 'bank_minutes', bank_minutes,
           'pay_amount', pay_amount, 'payroll_run_id', payroll_run_id
         )), '[]'::jsonb),
         COALESCE(SUM(CASE WHEN decision IN ('pay','split') THEN pay_amount ELSE 0 END), 0)
    INTO v_overtime, v_overtime_pay
    FROM public.overtime_resolutions
   WHERE employee_id = p_employee_id
     AND month = v_period_start;

  RETURN jsonb_build_object(
    'advances', v_advances,
    'advances_total', v_advances_total,
    'overtime_resolutions', v_overtime,
    'overtime_paid_value', v_overtime_pay
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_payroll_inputs_for_period(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.get_payroll_inputs_for_period(uuid, text) IS
  'Retorna vales pendentes + resoluções de HE do funcionário no período '
  '(YYYY-MM). Frontend usa pra montar a folha com todos os adicionais e '
  'descontos sincronizados.';
