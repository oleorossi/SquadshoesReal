-- Sistema de resolução mensal de horas extras: usuário decide se HE vai pro
-- banco de horas ou é paga na folha. Squad Shoes sem acordo formal —
-- compensação no mesmo mês (CLT art. 59, acordo tácito).

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS overtime_multiplier numeric NOT NULL DEFAULT 1.20,
  ADD COLUMN IF NOT EXISTS hourly_rate numeric;

COMMENT ON COLUMN public.employees.overtime_multiplier IS
  'Multiplicador da hora extra (ex: 1.20 = +20%). Default 1.20. Pode ser ajustado por funcionário (acordo individual).';
COMMENT ON COLUMN public.employees.hourly_rate IS
  'Valor da hora normal em R$. Se NULL, sistema calcula a partir de salary/220 (jornada padrão 220h/mês).';

CREATE TABLE IF NOT EXISTS public.overtime_resolutions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id                 uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  month                       date NOT NULL,
  overtime_minutes_total      integer NOT NULL DEFAULT 0,
  hourly_rate_snapshot        numeric NOT NULL,
  multiplier_snapshot         numeric NOT NULL,
  decision                    text NOT NULL CHECK (decision IN ('bank', 'pay', 'split')),
  bank_minutes                integer NOT NULL DEFAULT 0,
  pay_minutes                 integer NOT NULL DEFAULT 0,
  pay_amount                  numeric NOT NULL DEFAULT 0,
  bank_movement_id            uuid REFERENCES public.bank_hours_movements(id) ON DELETE SET NULL,
  financial_entry_id          uuid REFERENCES public.financial_entries(id) ON DELETE SET NULL,
  notes                       text,
  resolved_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, month)
);

CREATE INDEX IF NOT EXISTS idx_overtime_resolutions_employee_month
  ON public.overtime_resolutions(employee_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_overtime_resolutions_month
  ON public.overtime_resolutions(month DESC);

ALTER TABLE public.overtime_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_overtime_resolutions_all ON public.overtime_resolutions;
CREATE POLICY rls_overtime_resolutions_all ON public.overtime_resolutions
  FOR ALL TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente','rh']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','rh']));

DROP FUNCTION IF EXISTS public.resolve_monthly_overtime(uuid, date, text, integer, integer, integer, text);

CREATE OR REPLACE FUNCTION public.resolve_monthly_overtime(
  p_employee_id   uuid,
  p_month         date,
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
BEGIN
  IF NOT user_has_any_role(ARRAY['admin','gerente','rh']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  v_user := auth.uid();
  p_month := date_trunc('month', p_month)::date;

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

  SELECT id, salary, overtime_multiplier, hourly_rate
    INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Funcionário não encontrado';
  END IF;

  v_hourly_rate := COALESCE(v_emp.hourly_rate, v_emp.salary / 220.0, 0);
  v_multiplier  := COALESCE(v_emp.overtime_multiplier, 1.20);
  v_pay_amount  := ROUND((p_pay_minutes / 60.0) * v_hourly_rate * v_multiplier, 2);

  IF p_bank_minutes > 0 THEN
    INSERT INTO public.bank_hours_movements (
      employee_id, movement_type, minutes, movement_date, description, created_by
    ) VALUES (
      p_employee_id, 'credit', p_bank_minutes,
      (p_month + interval '1 month - 1 day')::date,
      COALESCE('Banco — HE ' || to_char(p_month, 'MM/YYYY')
        || COALESCE(' · ' || p_notes, ''),
        'Banco — HE ' || to_char(p_month, 'MM/YYYY')),
      v_user
    )
    RETURNING id INTO v_bank_id;
  END IF;

  IF p_pay_minutes > 0 AND v_pay_amount > 0 THEN
    INSERT INTO public.financial_entries (
      type, category, amount, status, description,
      reference_id, reference_type, entry_date, created_by
    ) VALUES (
      'despesa', 'folha_horas_extras', v_pay_amount, 'confirmed',
      'HE ' || to_char(p_month, 'MM/YYYY') || ' — ' || (p_pay_minutes/60.0)::numeric(8,2)
        || 'h × R$ ' || v_hourly_rate::numeric(10,2) || ' × ' || v_multiplier
        || COALESCE(' · ' || p_notes, ''),
      p_employee_id, 'employee_overtime',
      (p_month + interval '1 month - 1 day')::date,
      v_user
    )
    RETURNING id INTO v_fin_id;
  END IF;

  INSERT INTO public.overtime_resolutions (
    employee_id, month, overtime_minutes_total,
    hourly_rate_snapshot, multiplier_snapshot,
    decision, bank_minutes, pay_minutes, pay_amount,
    bank_movement_id, financial_entry_id, notes, resolved_by
  ) VALUES (
    p_employee_id, p_month, p_total_minutes,
    v_hourly_rate, v_multiplier,
    p_decision, p_bank_minutes, p_pay_minutes, v_pay_amount,
    v_bank_id, v_fin_id, p_notes, v_user
  )
  ON CONFLICT (employee_id, month) DO UPDATE SET
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

GRANT EXECUTE ON FUNCTION public.resolve_monthly_overtime(uuid, date, text, integer, integer, integer, text) TO authenticated;
