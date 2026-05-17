-- =============================================================================
-- Issue #5 (audit RH): proteção contra dupla contagem de HE.
--
-- ANTES: resolve_monthly_overtime() com decision='pay' criava financial_entry
-- (HE paga) mas NÃO debitava nada do banco_de_horas. A HE ficava acumulada
-- via derivado de timesheet. Se depois operador usasse pay_bank_hours() pra
-- aquele mesmo período, pagava 2× a mesma HE.
--
-- DEPOIS: quando decision IN ('pay', 'split') E pay_minutes > 0, função cria
-- também um movement payout (minutos NEGATIVOS) no banco, vinculado ao
-- financial_entry via reference_id. Saldo do banco zera naturalmente:
--   +pay_minutes (derivado timesheet) + -pay_minutes (movement payout) = 0
--
-- Pra decision='bank', segue criando só o credit (sem financial_entry) —
-- mesma lógica de antes.
-- =============================================================================

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
  v_pay_movement_id uuid;
  v_fin_id        uuid;
  v_resolution_id uuid;
  v_user          uuid;
  v_existing_payout integer;
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

  -- ── Crédito no banco quando decision in ('bank','split') ──
  IF p_bank_minutes > 0 THEN
    INSERT INTO public.bank_hours_movements (
      employee_id, movement_type, minutes, movement_date, reason, created_by
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

  -- ── Pagamento de HE ──
  IF p_pay_minutes > 0 AND v_pay_amount > 0 THEN
    -- Detecta se já existe payout pra esse mês — evita debitar 2×
    -- quando operador "re-resolve" a mesma HE (UPSERT mais embaixo
    -- atualiza o resolution, mas movements não desfazem automático).
    SELECT COALESCE(SUM(ABS(minutes)), 0)::integer INTO v_existing_payout
      FROM public.bank_hours_movements bhm
      JOIN public.overtime_resolutions r
        ON r.bank_movement_id = bhm.id  -- relação reversa (legacy: bank_movement_id apontava só pra credit)
      WHERE r.employee_id = p_employee_id
        AND r.month = p_month
        AND bhm.movement_type = 'payout';

    -- Cria movement payout pra debitar do banco (− minutos), evitando
    -- dupla contagem quando depois operador usar pay_bank_hours.
    -- Vinculado ao financial_entry via reference_id (preenchido após o INSERT).
    INSERT INTO public.bank_hours_movements (
      employee_id, movement_type, minutes, movement_date, reason, created_by
    ) VALUES (
      p_employee_id, 'payout', -p_pay_minutes,
      (p_month + interval '1 month - 1 day')::date,
      'HE paga (resolução mensal) — ' || to_char(p_month, 'MM/YYYY')
        || ' · ' || (p_pay_minutes/60.0)::numeric(8,2)
        || 'h × R$ ' || v_hourly_rate::numeric(10,2)
        || ' × ' || v_multiplier
        || COALESCE(' · ' || p_notes, ''),
      v_user
    )
    RETURNING id INTO v_pay_movement_id;

    INSERT INTO public.financial_entries (
      type, amount, status, description,
      reference_id, reference_type, entry_date, created_at, updated_at
    ) VALUES (
      'despesa', v_pay_amount, 'pendente',
      'HE ' || to_char(p_month, 'MM/YYYY') || ' — ' || (p_pay_minutes/60.0)::numeric(8,2)
        || 'h × R$ ' || v_hourly_rate::numeric(10,2) || ' × ' || v_multiplier
        || COALESCE(' · ' || p_notes, ''),
      v_pay_movement_id::text, 'bank_hours_payout',
      (p_month + interval '1 month - 1 day')::date,
      now(), now()
    )
    RETURNING id INTO v_fin_id;

    -- Linka movement payout ao financial_entry (bidirecional)
    UPDATE public.bank_hours_movements
       SET reference_id = v_fin_id
     WHERE id = v_pay_movement_id;
  END IF;

  -- ── Salva resolução (idempotente: ON CONFLICT atualiza) ──
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

COMMENT ON FUNCTION public.resolve_monthly_overtime(uuid, date, text, integer, integer, integer, text) IS
  'Resolve HE do mês: cria credit (bank), payout (pay) ou ambos (split). Quando paga, debita banco pra evitar dupla contagem com pay_bank_hours posterior.';
