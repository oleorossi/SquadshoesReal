-- ============================================================================
-- AUDITORIA HORAS 2026-06-09 — fixes SQL (parte 2):
--
-- #10 pay_bank_hours validava saldo com p_skip_missing=false enquanto toda a
--     UI (BankHours/Espelho/view) usa true → "saldo insuficiente" com a tela
--     mostrando positivo. Alinhado para true. (snapshot_employee_week mantém
--     false DE PROPÓSITO — comentário no código: materializa débito real.)
--
-- #5  resolve_monthly_overtime (versão VIVA, que já tinha split + re-resolve
--     limpo + débito no 'pay' — o arquivo 20260625120000 do repo está
--     desatualizado): dois bugs residuais:
--     (a) decisão 'bank' inseria movement 'credit' com os minutos da HE — mas
--         o saldo derivado do ponto (timesheet_min do
--         calculate_employee_bank_balance) JÁ inclui essa HE → contava 2×.
--         Agora 'bank' não insere movement: a resolução fica registrada e a
--         derivação do ponto é a fonte única do crédito.
--     (b) v_pay_amount ignorava o multiplicador (1,0 fixo no snapshot) → HE
--         paga a 1,0× enquanto a UI calcula 1,2×. Agora usa
--         employees.overtime_multiplier (fallback 1,2) e grava no snapshot.
-- ============================================================================

-- ── #10 ─────────────────────────────────────────────────────────────────────
DO $patch$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='pay_bank_hours' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN
    RAISE WARNING 'pay_bank_hours não encontrada — patch skip_missing NÃO aplicado';
    RETURN;
  END IF;
  IF v_src LIKE '%skip-missing-ui-fix%' THEN RETURN; END IF;
  IF position('calculate_employee_bank_balance(p_employee_id, NULL, NULL)' IN v_src) = 0 THEN
    RAISE WARNING 'pay_bank_hours: chamada 3-arg não encontrada — patch NÃO aplicado';
    RETURN;
  END IF;
  v_src := replace(v_src,
    'calculate_employee_bank_balance(p_employee_id, NULL, NULL)',
    'calculate_employee_bank_balance(p_employee_id, NULL, NULL, true /* skip-missing-ui-fix */)');
  EXECUTE v_src;
  RAISE NOTICE 'pay_bank_hours: skip_missing alinhado com a UI';
END
$patch$;

-- ── #5 — base: definição VIVA (pg_get_functiondef 2026-06-09) ───────────────
CREATE OR REPLACE FUNCTION public.resolve_monthly_overtime(p_employee_id uuid, p_month date, p_decision text, p_bank_minutes integer, p_pay_minutes integer, p_total_minutes integer, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp record; v_hourly_rate numeric; v_pay_amount numeric;
  v_bank_id uuid; v_pay_movement_id uuid; v_fin_id uuid; v_resolution_id uuid; v_user uuid;
  v_old_bank_id uuid; v_old_fin_id uuid;
  v_multiplier numeric;
BEGIN
  IF NOT user_has_any_role(ARRAY['admin','gerente','rh']) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  v_user := auth.uid();
  p_month := date_trunc('month', p_month)::date;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('overtime_monthly:' || p_employee_id::text || ':' || p_month::text, 0)
  );

  IF p_decision NOT IN ('bank','pay','split') THEN RAISE EXCEPTION 'decision inválida: %', p_decision; END IF;
  IF p_decision = 'bank' THEN p_pay_minutes := 0; p_bank_minutes := p_total_minutes;
  ELSIF p_decision = 'pay' THEN p_bank_minutes := 0; p_pay_minutes := p_total_minutes;
  ELSIF p_decision = 'split' THEN
    IF (p_bank_minutes + p_pay_minutes) <> p_total_minutes THEN RAISE EXCEPTION 'split inconsistente'; END IF;
  END IF;

  SELECT id, salary, hourly_rate, COALESCE(overtime_multiplier, 1.2) AS mult
    INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Funcionário não encontrado'; END IF;
  v_multiplier  := v_emp.mult;
  v_hourly_rate := COALESCE(v_emp.hourly_rate, v_emp.salary / 220.0, 0);
  -- (b) HE paga com multiplicador do funcionário (antes: 1,0 fixo)
  v_pay_amount  := ROUND((p_pay_minutes / 60.0) * v_hourly_rate * v_multiplier, 2);

  SELECT bank_movement_id, financial_entry_id INTO v_old_bank_id, v_old_fin_id
    FROM public.overtime_resolutions
   WHERE employee_id = p_employee_id AND month = p_month;
  IF v_old_bank_id IS NOT NULL THEN
    DELETE FROM public.bank_hours_movements WHERE id = v_old_bank_id;
  END IF;
  IF v_old_fin_id IS NOT NULL THEN
    UPDATE public.financial_entries
       SET status = 'cancelado',
           notes = COALESCE(notes,'') || E'\n[' || now()::date || '] Cancelado por nova resolução de HE mensal'
     WHERE id = v_old_fin_id AND status NOT IN ('cancelado','estornado');
  END IF;

  -- (a) decisão 'bank': NÃO inserir movement de crédito. O saldo derivado do
  -- ponto (timesheet_min) já inclui a HE do mês — inserir crédito contava 2×.
  -- A resolução (bank_minutes) fica registrada em overtime_resolutions.
  v_bank_id := NULL;

  IF p_pay_minutes > 0 AND v_pay_amount > 0 THEN
    INSERT INTO public.bank_hours_movements (employee_id, movement_type, minutes, movement_date, description, created_by)
    VALUES (p_employee_id, 'payment', -p_pay_minutes, (p_month + interval '1 month - 1 day')::date,
      'HE paga (resolução mensal) — ' || to_char(p_month, 'MM/YYYY')
        || ' · ' || (p_pay_minutes/60.0)::numeric(8,2) || 'h × R$ ' || v_hourly_rate::numeric(10,2)
        || ' × ' || v_multiplier::numeric(4,2)
        || COALESCE(' · ' || p_notes, ''), v_user)
    RETURNING id INTO v_pay_movement_id;

    INSERT INTO public.financial_entries (type, amount, status, description, reference_id, reference_type, entry_date, created_at, updated_at)
    VALUES ('despesa', v_pay_amount, 'pendente',
      'HE ' || to_char(p_month, 'MM/YYYY') || ' — ' || (p_pay_minutes/60.0)::numeric(8,2)
        || 'h × R$ ' || v_hourly_rate::numeric(10,2) || ' × ' || v_multiplier::numeric(4,2)
        || COALESCE(' · ' || p_notes, ''),
      v_pay_movement_id::text, 'bank_hours_payout', (p_month + interval '1 month - 1 day')::date, now(), now())
    RETURNING id INTO v_fin_id;

    UPDATE public.bank_hours_movements SET reference_id = v_fin_id WHERE id = v_pay_movement_id;
  END IF;

  INSERT INTO public.overtime_resolutions (
    employee_id, month, overtime_minutes_total, hourly_rate_snapshot, multiplier_snapshot,
    decision, bank_minutes, pay_minutes, pay_amount, bank_movement_id, financial_entry_id, notes, resolved_by
  ) VALUES (
    p_employee_id, p_month, p_total_minutes, v_hourly_rate, v_multiplier,
    p_decision, p_bank_minutes, p_pay_minutes, v_pay_amount, v_bank_id, v_fin_id, p_notes, v_user
  )
  ON CONFLICT (employee_id, month) DO UPDATE SET
    overtime_minutes_total = EXCLUDED.overtime_minutes_total,
    hourly_rate_snapshot   = EXCLUDED.hourly_rate_snapshot,
    multiplier_snapshot    = EXCLUDED.multiplier_snapshot,
    decision = EXCLUDED.decision,
    bank_minutes = EXCLUDED.bank_minutes, pay_minutes = EXCLUDED.pay_minutes, pay_amount = EXCLUDED.pay_amount,
    bank_movement_id = EXCLUDED.bank_movement_id, financial_entry_id = EXCLUDED.financial_entry_id,
    notes = EXCLUDED.notes, resolved_by = EXCLUDED.resolved_by, resolved_at = now()
  RETURNING id INTO v_resolution_id;

  RETURN v_resolution_id;
END;
$function$;

-- Backfill (a): remove créditos 'bank' duplicados criados por resoluções
-- anteriores (o ponto já credita). Usa o FK rastreado na própria resolução.
DO $bf$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id, bank_movement_id FROM public.overtime_resolutions
     WHERE bank_movement_id IS NOT NULL
  LOOP
    DELETE FROM public.bank_hours_movements WHERE id = r.bank_movement_id;
    UPDATE public.overtime_resolutions SET bank_movement_id = NULL WHERE id = r.id;
  END LOOP;
END
$bf$;
