-- Pagamento parcial/total do SALDO ACUMULADO de banco de horas.
-- Diferente de resolve_monthly_overtime (decide destino das HE NOVAS do mês),
-- esta saca horas de um saldo já existente:
--   - funcionário tem ex. 24h acumuladas
--   - usuário escolhe pagar 10h → 14h permanecem no banco
--   - débito de 10h em bank_hours_movements (movement_type='payment')
--   - lançamento de despesa em financial_entries (vai pro financeiro)
--   - valor = (min/60) × hourly_rate × overtime_multiplier
CREATE OR REPLACE FUNCTION public.pay_bank_hours_balance(
  p_employee_id uuid,
  p_pay_minutes integer,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_emp          record;
  v_balance      jsonb;
  v_balance_min  int;
  v_hourly_rate  numeric;
  v_multiplier   numeric;
  v_pay_amount   numeric;
  v_fin_id       uuid;
  v_mov_id       uuid;
  v_user         uuid;
BEGIN
  IF NOT user_has_any_role(ARRAY['admin','gerente','rh']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  v_user := auth.uid();

  IF p_pay_minutes IS NULL OR p_pay_minutes <= 0 THEN
    RAISE EXCEPTION 'Informe uma quantidade de minutos positiva pra pagar';
  END IF;

  SELECT id, name, salary, overtime_multiplier, hourly_rate
    INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN RAISE EXCEPTION 'Funcionário não encontrado'; END IF;

  v_balance := public.calculate_employee_bank_balance(p_employee_id);
  v_balance_min := COALESCE((v_balance->>'balance_min')::int, 0);

  IF p_pay_minutes > v_balance_min THEN
    RAISE EXCEPTION 'Saldo insuficiente: funcionário tem % min no banco, tentou pagar % min',
      v_balance_min, p_pay_minutes;
  END IF;

  v_hourly_rate := COALESCE(v_emp.hourly_rate, v_emp.salary / 220.0, 0);
  v_multiplier  := COALESCE(v_emp.overtime_multiplier, 1.20);
  v_pay_amount  := ROUND((p_pay_minutes / 60.0) * v_hourly_rate * v_multiplier, 2);

  IF v_pay_amount <= 0 THEN
    RAISE EXCEPTION 'Valor calculado inválido — verifique hourly_rate/salary do funcionário';
  END IF;

  INSERT INTO public.financial_entries (
    type, category, amount, status, description,
    reference_id, reference_type, entry_date, created_by
  )
  VALUES (
    'despesa', 'folha_horas_extras', v_pay_amount, 'confirmed',
    'Pagamento de banco de horas — ' || v_emp.name || ' — ' ||
      (p_pay_minutes / 60.0)::numeric(8,2) || 'h x R$ ' || v_hourly_rate::numeric(10,2) ||
      ' x ' || v_multiplier || COALESCE(' — ' || p_notes, ''),
    p_employee_id, 'bank_hours_payment', CURRENT_DATE, v_user
  )
  RETURNING id INTO v_fin_id;

  INSERT INTO public.bank_hours_movements (
    employee_id, movement_type, minutes, movement_date, description,
    reference_id, reference_type, created_by
  )
  VALUES (
    p_employee_id, 'payment', -p_pay_minutes, CURRENT_DATE,
    'Pagamento de ' || (p_pay_minutes / 60.0)::numeric(8,2) || 'h — R$ ' ||
      v_pay_amount::numeric(10,2) || COALESCE(' — ' || p_notes, ''),
    v_fin_id, 'financial_entry', v_user
  )
  RETURNING id INTO v_mov_id;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id,
    'employee_name', v_emp.name,
    'paid_minutes', p_pay_minutes,
    'paid_hours', ROUND(p_pay_minutes / 60.0, 2),
    'hourly_rate', v_hourly_rate,
    'multiplier', v_multiplier,
    'pay_amount', v_pay_amount,
    'balance_before_min', v_balance_min,
    'balance_after_min', v_balance_min - p_pay_minutes,
    'financial_entry_id', v_fin_id,
    'bank_movement_id', v_mov_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_bank_hours_balance(uuid, integer, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.pay_bank_hours_balance IS
  'Saca horas do saldo acumulado de banco de horas: débito no banco + despesa no financeiro. Valor = (min/60) x hourly_rate x overtime_multiplier.';
