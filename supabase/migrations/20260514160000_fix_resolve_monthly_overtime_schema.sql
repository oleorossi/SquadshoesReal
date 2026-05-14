-- FIX de bug pré-existente descoberto na auditoria do PR #11:
-- resolve_monthly_overtime inseria em financial_entries com colunas
-- inexistentes (category, created_by) e status 'confirmed'. A função
-- nunca tinha sido exercitada (overtime_resolutions tinha 0 rows), por
-- isso o bug passou. Schema real: sem 'category'/'created_by', despesas
-- usam status 'pendente', reference_id é TEXT.
CREATE OR REPLACE FUNCTION public.resolve_monthly_overtime(
  p_employee_id uuid, p_month date, p_decision text,
  p_bank_minutes integer, p_pay_minutes integer, p_total_minutes integer,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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
    RAISE EXCEPTION 'decision invalida';
  END IF;
  IF p_decision = 'bank' THEN
    p_pay_minutes := 0; p_bank_minutes := p_total_minutes;
  ELSIF p_decision = 'pay' THEN
    p_bank_minutes := 0; p_pay_minutes := p_total_minutes;
  ELSIF p_decision = 'split' THEN
    IF (p_bank_minutes + p_pay_minutes) <> p_total_minutes THEN
      RAISE EXCEPTION 'split inconsistente';
    END IF;
  END IF;
  SELECT id, salary, overtime_multiplier, hourly_rate INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Funcionario nao encontrado'; END IF;
  v_hourly_rate := COALESCE(v_emp.hourly_rate, v_emp.salary / 220.0, 0);
  v_multiplier  := COALESCE(v_emp.overtime_multiplier, 1.20);
  v_pay_amount  := ROUND((p_pay_minutes / 60.0) * v_hourly_rate * v_multiplier, 2);
  IF p_bank_minutes > 0 THEN
    INSERT INTO public.bank_hours_movements (employee_id, movement_type, minutes, movement_date, description, created_by)
    VALUES (p_employee_id, 'credit', p_bank_minutes, (p_month + interval '1 month - 1 day')::date,
      'Banco - HE ' || to_char(p_month, 'MM/YYYY') || COALESCE(' - ' || p_notes, ''), v_user)
    RETURNING id INTO v_bank_id;
  END IF;
  IF p_pay_minutes > 0 AND v_pay_amount > 0 THEN
    INSERT INTO public.financial_entries (type, amount, status, description, reference_id, reference_type, entry_date, notes)
    VALUES ('despesa', v_pay_amount, 'pendente',
      'HE ' || to_char(p_month, 'MM/YYYY') || ' - ' || (p_pay_minutes/60.0)::numeric(8,2) || 'h x R$ ' || v_hourly_rate::numeric(10,2) || ' x ' || v_multiplier,
      p_employee_id::text, 'employee_overtime', (p_month + interval '1 month - 1 day')::date, COALESCE(p_notes,''))
    RETURNING id INTO v_fin_id;
  END IF;
  INSERT INTO public.overtime_resolutions (employee_id, month, overtime_minutes_total, hourly_rate_snapshot, multiplier_snapshot, decision, bank_minutes, pay_minutes, pay_amount, bank_movement_id, financial_entry_id, notes, resolved_by)
  VALUES (p_employee_id, p_month, p_total_minutes, v_hourly_rate, v_multiplier, p_decision, p_bank_minutes, p_pay_minutes, v_pay_amount, v_bank_id, v_fin_id, p_notes, v_user)
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
