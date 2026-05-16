-- =============================================================================
-- pay_bank_hours: registra pagamento de horas extras pra um funcionário.
--
-- Em uma única transação:
--   1. Valida saldo disponível e folha do mês não fechada
--   2. Cria bank_hours_movements (type='payout', minutes negativos)
--   3. Cria financial_entries (despesa, amount = horas × valor/hora)
--   4. Linka os dois via reference_id pra rastreabilidade bidirecional
--
-- Retorna JSON com movement_id, financial_entry_id, amount, created_at — UI
-- usa pra mostrar "X horas pagas (R$ Y) em DD/MM HH:MM".
-- =============================================================================

DROP FUNCTION IF EXISTS public.pay_bank_hours(uuid, numeric, numeric, date, text, uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.pay_bank_hours(
  p_employee_id     uuid,
  p_hours           numeric,
  p_hourly_rate     numeric,
  p_payment_date    date    DEFAULT CURRENT_DATE,
  p_notes           text    DEFAULT NULL,
  p_bank_account_id uuid    DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_minutes         integer;
  v_amount          numeric;
  v_employee        RECORD;
  v_balance_min     integer;
  v_period          text;
  v_payroll_status  text;
  v_movement_id     uuid;
  v_entry_id        uuid;
  v_account_id      uuid;
  v_now             timestamptz := now();
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Validações de entrada
  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'Funcionário é obrigatório';
  END IF;
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RAISE EXCEPTION 'Quantidade de horas deve ser maior que zero';
  END IF;
  IF p_hourly_rate IS NULL OR p_hourly_rate <= 0 THEN
    RAISE EXCEPTION 'Valor da hora deve ser maior que zero';
  END IF;

  -- Funcionário existe?
  SELECT id, name, salary, cost_center, department
    INTO v_employee
    FROM public.employees
   WHERE id = p_employee_id AND active = true;

  IF v_employee.id IS NULL THEN
    RAISE EXCEPTION 'Funcionário não encontrado ou inativo';
  END IF;

  -- Saldo disponível (movements + timesheet)
  SELECT (public.calculate_employee_bank_balance(p_employee_id, NULL, NULL)->>'balance_min')::integer
    INTO v_balance_min;

  v_minutes := CEIL(p_hours * 60)::integer;

  IF v_balance_min IS NULL OR v_balance_min < v_minutes THEN
    RAISE EXCEPTION 'Saldo insuficiente: disponível % min, solicitado % min (% horas)',
      COALESCE(v_balance_min, 0), v_minutes, p_hours;
  END IF;

  -- Bloqueio: folha do período já fechada?
  v_period := to_char(p_payment_date, 'YYYY-MM');
  SELECT status INTO v_payroll_status
    FROM public.payroll_runs
   WHERE employee_id = p_employee_id AND period = v_period
   LIMIT 1;

  IF v_payroll_status IS NOT NULL AND v_payroll_status <> 'rascunho' THEN
    RAISE EXCEPTION 'Folha do período % já está % — desfaça o status antes de registrar pagamento.',
      v_period, v_payroll_status;
  END IF;

  v_amount := ROUND(p_hours * p_hourly_rate, 2);

  -- 1. Cria o movement de débito (payout)
  INSERT INTO public.bank_hours_movements (
    employee_id, movement_date, movement_type, minutes, reason, created_by, created_at
  ) VALUES (
    p_employee_id, p_payment_date, 'payout', -v_minutes,
    COALESCE(NULLIF(trim(p_notes), ''),
             format('Pagamento %s h × R$ %s/h = R$ %s',
                    trim(both '0' from to_char(p_hours, 'FM999990.00')),
                    trim(both '0' from to_char(p_hourly_rate, 'FM999990.00')),
                    trim(both '0' from to_char(v_amount, 'FM999990.00')))),
    auth.uid(), v_now
  )
  RETURNING id INTO v_movement_id;

  -- 2. Cria o lançamento de despesa no financeiro
  -- Conta contábil padrão: tenta achar uma com nome contendo "salário" ou "folha"
  -- ou "RH"; senão deixa NULL (operador pode reconciliar depois).
  SELECT id INTO v_account_id
    FROM public.chart_of_accounts
   WHERE active = true
     AND (lower(name) LIKE '%sal[áa]rio%' OR lower(name) LIKE '%folha%' OR lower(name) LIKE '%hora extra%' OR lower(name) LIKE '%pessoal%')
   ORDER BY name
   LIMIT 1;

  INSERT INTO public.financial_entries (
    entry_date, type, description, amount,
    account_id, bank_account_id,
    reference_type, reference_id, status, created_at, updated_at
  ) VALUES (
    p_payment_date, 'despesa',
    format('Pagamento horas extras — %s (%s h)', v_employee.name,
           trim(both '0' from to_char(p_hours, 'FM999990.00'))),
    v_amount,
    v_account_id, p_bank_account_id,
    'bank_hours_payout', v_movement_id::text, 'pendente', v_now, v_now
  )
  RETURNING id INTO v_entry_id;

  -- 3. Linka o movement ao financial_entry pra rastreabilidade bidirecional
  UPDATE public.bank_hours_movements
     SET reference_id = v_entry_id
   WHERE id = v_movement_id;

  RETURN jsonb_build_object(
    'movement_id',        v_movement_id,
    'financial_entry_id', v_entry_id,
    'employee_id',        p_employee_id,
    'employee_name',      v_employee.name,
    'hours',              p_hours,
    'minutes',            v_minutes,
    'hourly_rate',        p_hourly_rate,
    'amount',             v_amount,
    'payment_date',       p_payment_date,
    'created_at',         v_now,
    'created_by',         auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_bank_hours(uuid, numeric, numeric, date, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.pay_bank_hours(uuid, numeric, numeric, date, text, uuid) IS
  'Registra pagamento de horas extras: cria movement payout (débito do banco) e financial_entries (despesa pendente) atomicamente.';
