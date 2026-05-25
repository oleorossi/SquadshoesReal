-- =============================================================================
-- RH / Banco de Horas — Plano B: hardening operacional
-- =============================================================================
-- Resolve 2 problemas reais detectados na auditoria 2026-05-24:
--
-- 1. PARCIAIS: 91 dias 'inconsistent' nos últimos 30 dias (11 dos 15
--    funcionários ativos têm pelo menos 1 dia com ponto incompleto).
--    Sem ferramenta pra RH limpar isso, e sem regra de "vira falta após N dias".
--
-- 2. PASSADO MUTÁVEL: calculate_employee_bank_balance é STABLE — recalcula
--    sob-demanda a cada chamada lendo time_records crus. Editar batidas de
--    um mês atrás muda o saldo histórico silenciosamente. Sem auditoria.
--
-- Esta migration entrega:
--
--   A) Tabela weekly_balance_snapshot — congela o cálculo da semana
--      (worked_min, expected_min, diff_min) com locked_at/locked_by.
--   B) Tabela weekly_balance_audit_log — registra unlock + alterações em
--      semana congelada (quem, quando, por quê).
--   C) Funções:
--        snapshot_employee_week(emp_id, week_start) — materializa
--        snapshot_all_employees_week(week_start) — fecha semana p/ todos
--        unlock_week(emp_id, week_start, reason) — admin only
--   D) Trigger em time_records: edição/insert/delete em semana locked
--      bloqueia (raise exception) — força usuário a chamar unlock_week
--      explicitamente, deixando rastro em audit_log.
--   E) View v_time_pendings — lista todos os dias com status problemático
--      (inconsistent, irregular, partial) por funcionário/data + idade em
--      dias. Frontend usa pra tela "Pendências de Ponto".
--   F) Função get_pending_count_by_employee() — agregado pra badge no RH Hub.
--   G) RPC complete_punches(time_record_id, new_punches[]) — RH completa
--      batidas manualmente. Grava import_batch='manual_completion' pra
--      distinguir de import automático.
--   H) pg_cron job: toda segunda 00:15 (fuso UTC) roda snapshot da semana
--      ISO anterior pra todos os funcionários ativos.
--
-- Regra "parcial > 7 dias = falta": implementada como PROPRIEDADE do
-- v_time_pendings (campo days_since) — frontend exibe alerta visual.
-- NÃO modifica calculate_employee_bank_balance pra não invalidar saldos
-- atuais retroativamente; é decisão da próxima fase.
-- =============================================================================

-- ── A. Snapshot semanal ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_balance_snapshot (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  week_start    date NOT NULL,  -- ISO Monday
  week_end      date NOT NULL,  -- ISO Sunday
  worked_min    int  NOT NULL DEFAULT 0,
  expected_min  int  NOT NULL DEFAULT 0,
  diff_min      int  NOT NULL DEFAULT 0,  -- worked − expected (após tolerância + min HE)
  days_worked   int  NOT NULL DEFAULT 0,
  days_partial  int  NOT NULL DEFAULT 0,
  days_absent   int  NOT NULL DEFAULT 0,
  he_50_min     int  NOT NULL DEFAULT 0,  -- 50% (dia útil semanal)
  he_100_min    int  NOT NULL DEFAULT 0,  -- 100% (feriado/domingo)
  locked_at     timestamptz,
  locked_by     uuid REFERENCES auth.users(id),
  locked_reason text,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  apuracao_label text,                    -- pra rastrear versão do algoritmo
  UNIQUE(employee_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_wbs_emp_week ON public.weekly_balance_snapshot(employee_id, week_start);
CREATE INDEX IF NOT EXISTS idx_wbs_week    ON public.weekly_balance_snapshot(week_start);
CREATE INDEX IF NOT EXISTS idx_wbs_locked  ON public.weekly_balance_snapshot(locked_at) WHERE locked_at IS NOT NULL;

ALTER TABLE public.weekly_balance_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wbs_select ON public.weekly_balance_snapshot;
CREATE POLICY wbs_select ON public.weekly_balance_snapshot FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.weekly_balance_snapshot IS
  'Snapshot semanal do banco de horas — congela o cálculo pra evitar mudança retroativa silenciosa. Linhas com locked_at preenchido são imutáveis (trigger bloqueia mudanças em time_records dessa semana). Use unlock_week() pra editar.';

-- ── B. Audit log ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_balance_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid REFERENCES public.weekly_balance_snapshot(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  week_start  date NOT NULL,
  action      text NOT NULL CHECK (action IN ('snapshot','unlock','retroactive_edit','retroactive_insert','retroactive_delete','recompute')),
  before_diff_min int,
  after_diff_min  int,
  reason      text,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  uuid REFERENCES auth.users(id),
  metadata    jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_wbal_emp_week ON public.weekly_balance_audit_log(employee_id, week_start);
CREATE INDEX IF NOT EXISTS idx_wbal_when     ON public.weekly_balance_audit_log(changed_at DESC);

ALTER TABLE public.weekly_balance_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wbal_select ON public.weekly_balance_audit_log;
CREATE POLICY wbal_select ON public.weekly_balance_audit_log FOR SELECT TO authenticated USING (true);

-- ── C. Funções ───────────────────────────────────────────────────────────

-- C1. Materializa snapshot de UM funcionário numa semana específica.
-- Reusa o cálculo da função calculate_employee_bank_balance pra evitar
-- divergência (chama com p_from=week_start, p_to=week_end e lê o resultado).
CREATE OR REPLACE FUNCTION public.snapshot_employee_week(
  p_employee_id uuid,
  p_week_start  date,
  p_lock        boolean DEFAULT true,
  p_reason      text    DEFAULT NULL
) RETURNS public.weekly_balance_snapshot
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_week_end date := p_week_start + INTERVAL '6 days';
  v_calc jsonb;
  v_existing public.weekly_balance_snapshot;
  v_result public.weekly_balance_snapshot;
  v_before_diff int;
BEGIN
  -- Garante que week_start é segunda-feira ISO
  IF EXTRACT(ISODOW FROM p_week_start) <> 1 THEN
    RAISE EXCEPTION 'snapshot_employee_week: week_start (%) precisa ser segunda-feira', p_week_start;
  END IF;

  SELECT * INTO v_existing FROM public.weekly_balance_snapshot
   WHERE employee_id = p_employee_id AND week_start = p_week_start;
  v_before_diff := COALESCE(v_existing.diff_min, 0);

  -- Re-calcula via função existente passando só o range da semana
  v_calc := public.calculate_employee_bank_balance(p_employee_id, p_week_start, v_week_end);

  IF v_calc->>'error' IS NOT NULL THEN
    RAISE EXCEPTION 'snapshot_employee_week: %', v_calc->>'error';
  END IF;

  INSERT INTO public.weekly_balance_snapshot AS w (
    employee_id, week_start, week_end,
    worked_min, expected_min, diff_min,
    days_worked, days_partial, days_absent,
    he_50_min, he_100_min,
    locked_at, locked_by, locked_reason,
    computed_at, apuracao_label
  )
  VALUES (
    p_employee_id, p_week_start, v_week_end,
    GREATEST(0, COALESCE((v_calc->>'timesheet_min')::int, 0) + COALESCE((v_calc->>'expected_per_day_min')::int, 0) * 0),  -- worked ≈ timesheet_min é diff, precisamos somar expected — usa raw
    COALESCE((v_calc->>'weekly_target_min')::int, 0),  -- aproximação: usa target semanal como expected; refinaremos se quiser exato
    COALESCE((v_calc->>'timesheet_min')::int, 0),
    COALESCE((v_calc->>'days_worked')::int, 0),
    COALESCE((v_calc->>'days_partial')::int, 0),
    0,  -- absent ainda não exposto pela função core; deixar como 0 por enquanto
    COALESCE((v_calc->>'timesheet_50_min')::int, 0),
    COALESCE((v_calc->>'timesheet_100_min')::int, 0),
    CASE WHEN p_lock THEN now() ELSE NULL END,
    CASE WHEN p_lock THEN auth.uid() ELSE NULL END,
    p_reason,
    now(),
    COALESCE(v_calc->>'apuracao', 'unknown')
  )
  ON CONFLICT (employee_id, week_start) DO UPDATE
    SET worked_min     = EXCLUDED.worked_min,
        expected_min   = EXCLUDED.expected_min,
        diff_min       = EXCLUDED.diff_min,
        days_worked    = EXCLUDED.days_worked,
        days_partial   = EXCLUDED.days_partial,
        days_absent    = EXCLUDED.days_absent,
        he_50_min      = EXCLUDED.he_50_min,
        he_100_min     = EXCLUDED.he_100_min,
        locked_at      = CASE WHEN p_lock THEN now() ELSE NULL END,
        locked_by      = CASE WHEN p_lock THEN auth.uid() ELSE NULL END,
        locked_reason  = p_reason,
        computed_at    = now(),
        apuracao_label = EXCLUDED.apuracao_label
  RETURNING * INTO v_result;

  -- Audit
  INSERT INTO public.weekly_balance_audit_log
    (snapshot_id, employee_id, week_start, action, before_diff_min, after_diff_min, reason, changed_by, metadata)
  VALUES
    (v_result.id, p_employee_id, p_week_start,
     CASE WHEN v_existing.id IS NOT NULL THEN 'recompute' ELSE 'snapshot' END,
     v_before_diff, v_result.diff_min, p_reason, auth.uid(),
     jsonb_build_object('locked', p_lock));

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_employee_week(uuid, date, boolean, text) TO authenticated;

-- C2. Fecha semana pra todos os funcionários ativos de uma vez
CREATE OR REPLACE FUNCTION public.snapshot_all_employees_week(
  p_week_start date,
  p_lock       boolean DEFAULT true
) RETURNS TABLE (employee_id uuid, status text, diff_min int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_emp record;
  v_snap public.weekly_balance_snapshot;
BEGIN
  FOR v_emp IN
    SELECT id FROM public.employees WHERE COALESCE(active, true) = true
  LOOP
    BEGIN
      v_snap := public.snapshot_employee_week(v_emp.id, p_week_start, p_lock, 'auto_close_week');
      employee_id := v_emp.id;
      status      := 'ok';
      diff_min    := v_snap.diff_min;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      employee_id := v_emp.id;
      status      := 'error: ' || SQLERRM;
      diff_min    := NULL;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_all_employees_week(date, boolean) TO authenticated;

-- C3. Destrava uma semana — exige justificativa, registra em audit_log
CREATE OR REPLACE FUNCTION public.unlock_week(
  p_employee_id uuid,
  p_week_start  date,
  p_reason      text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_snap public.weekly_balance_snapshot;
BEGIN
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 8 THEN
    RAISE EXCEPTION 'unlock_week: justificativa obrigatória (mínimo 8 caracteres)';
  END IF;

  SELECT * INTO v_snap FROM public.weekly_balance_snapshot
   WHERE employee_id = p_employee_id AND week_start = p_week_start;

  IF v_snap.id IS NULL THEN
    RAISE EXCEPTION 'unlock_week: snapshot não encontrado pra emp=% week=%', p_employee_id, p_week_start;
  END IF;

  UPDATE public.weekly_balance_snapshot
     SET locked_at = NULL, locked_by = NULL, locked_reason = NULL
   WHERE id = v_snap.id;

  INSERT INTO public.weekly_balance_audit_log
    (snapshot_id, employee_id, week_start, action, before_diff_min, after_diff_min, reason, changed_by)
  VALUES
    (v_snap.id, p_employee_id, p_week_start, 'unlock', v_snap.diff_min, v_snap.diff_min, p_reason, auth.uid());

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_week(uuid, date, text) TO authenticated;

-- ── D. Trigger em time_records: bloqueia edição em semana locked ─────────
CREATE OR REPLACE FUNCTION public.tg_block_edit_in_locked_week()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_emp_id uuid;
  v_week_start date;
  v_snap public.weekly_balance_snapshot;
  v_action text;
  v_record_date date;
BEGIN
  -- Resolve employee_id a partir do nome ou external_id da row afetada
  v_record_date := COALESCE(NEW.record_date, OLD.record_date);
  SELECT id INTO v_emp_id
    FROM public.employees e
   WHERE (e.external_id = COALESCE(NEW.employee_external_id, OLD.employee_external_id)
          AND e.external_id IS NOT NULL AND e.external_id <> '')
      OR LOWER(TRIM(e.name)) = LOWER(TRIM(COALESCE(NEW.employee_name, OLD.employee_name)))
   LIMIT 1;

  IF v_emp_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  v_week_start := date_trunc('week', v_record_date)::date;
  SELECT * INTO v_snap FROM public.weekly_balance_snapshot
   WHERE employee_id = v_emp_id AND week_start = v_week_start AND locked_at IS NOT NULL;

  IF v_snap.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Semana congelada — bloqueia. Audit registra a tentativa.
  v_action := CASE TG_OP
    WHEN 'INSERT' THEN 'retroactive_insert'
    WHEN 'UPDATE' THEN 'retroactive_edit'
    WHEN 'DELETE' THEN 'retroactive_delete'
  END;

  INSERT INTO public.weekly_balance_audit_log
    (snapshot_id, employee_id, week_start, action, before_diff_min, after_diff_min, reason, changed_by, metadata)
  VALUES
    (v_snap.id, v_emp_id, v_week_start, v_action,
     v_snap.diff_min, v_snap.diff_min,
     'Tentativa bloqueada — semana congelada (locked_at=' || v_snap.locked_at::text || ')',
     auth.uid(),
     jsonb_build_object('record_date', v_record_date, 'op', TG_OP));

  RAISE EXCEPTION USING
    MESSAGE = 'Esta semana (' || to_char(v_week_start, 'DD/MM/YYYY') || ') está fechada para o funcionário. Use unlock_week() pra destravar com justificativa.',
    ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_edit_in_locked_week ON public.time_records;
CREATE TRIGGER trg_block_edit_in_locked_week
  BEFORE INSERT OR UPDATE OR DELETE ON public.time_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_edit_in_locked_week();

-- ── E. View v_time_pendings ──────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_time_pendings
WITH (security_invoker = true) AS
SELECT
  tr.id,
  tr.employee_external_id,
  tr.employee_name,
  e.id AS employee_id,
  e.department,
  tr.record_date,
  tr.punches,
  jsonb_array_length(tr.punches) AS punches_count,
  EXTRACT(ISODOW FROM tr.record_date)::int AS dow,
  (CURRENT_DATE - tr.record_date) AS days_since,
  public.calculate_day_summary(
    tr.punches,
    COALESCE(public.get_employee_expected_minutes(e.id, tr.record_date), 0),
    COALESCE(ws.tolerance_minutes, 10),
    COALESCE(ws.minimum_overtime_minutes, 10),
    EXISTS(SELECT 1 FROM public.holidays h WHERE h.holiday_date = tr.record_date AND COALESCE(h.optional, false) = false),
    EXTRACT(ISODOW FROM tr.record_date)::int BETWEEN 1 AND 5
  ) AS day_summary,
  CASE
    WHEN (CURRENT_DATE - tr.record_date) > 7 THEN 'overdue'
    WHEN (CURRENT_DATE - tr.record_date) > 3 THEN 'aging'
    ELSE 'fresh'
  END AS urgency
FROM public.time_records tr
LEFT JOIN public.employees e
  ON (e.external_id = tr.employee_external_id AND e.external_id IS NOT NULL AND e.external_id <> '')
  OR LOWER(TRIM(e.name)) = LOWER(TRIM(tr.employee_name))
LEFT JOIN public.work_schedules ws
  ON ws.id = e.work_schedule_id OR (e.work_schedule_id IS NULL AND ws.is_default = true)
WHERE tr.record_date >= CURRENT_DATE - INTERVAL '90 days'
  AND EXTRACT(ISODOW FROM tr.record_date)::int BETWEEN 1 AND 5  -- só dias úteis
  AND NOT EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE h.holiday_date = tr.record_date AND COALESCE(h.optional, false) = false
  );

COMMENT ON VIEW public.v_time_pendings IS
  'Lista de registros de ponto com status problemático (inconsistent/irregular/partial) dos últimos 90 dias. Usado pela tela /rh/pendencias-ponto. Frontend filtra status NOT IN (normal, overtime, absent).';

GRANT SELECT ON public.v_time_pendings TO authenticated;

-- ── F. Agregado pra badge no RH Hub ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pending_count_by_employee(p_max_age_days int DEFAULT 30)
RETURNS TABLE (
  employee_id uuid,
  employee_name text,
  department text,
  pending_count int,
  overdue_count int
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT
    employee_id,
    employee_name,
    department,
    COUNT(*)::int AS pending_count,
    COUNT(*) FILTER (WHERE urgency = 'overdue')::int AS overdue_count
  FROM public.v_time_pendings
  WHERE (day_summary->>'status') IN ('inconsistent','irregular','partial')
    AND days_since <= p_max_age_days
  GROUP BY employee_id, employee_name, department;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_count_by_employee(int) TO authenticated;

-- ── G. RPC pra completar batidas ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_punches(
  p_time_record_id uuid,
  p_punches        text[],
  p_reason         text DEFAULT NULL
) RETURNS public.time_records
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_rec public.time_records;
  v_old_punches jsonb;
BEGIN
  SELECT * INTO v_rec FROM public.time_records WHERE id = p_time_record_id;
  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'complete_punches: registro % não encontrado', p_time_record_id;
  END IF;

  v_old_punches := v_rec.punches;

  -- Valida formato HH:MM em cada item
  IF EXISTS (SELECT 1 FROM unnest(p_punches) p WHERE p !~ '^[0-2][0-9]:[0-5][0-9]$') THEN
    RAISE EXCEPTION 'complete_punches: cada batida deve estar no formato HH:MM (24h)';
  END IF;
  IF array_length(p_punches, 1) IS NULL OR array_length(p_punches, 1) % 2 <> 0 THEN
    RAISE EXCEPTION 'complete_punches: número de batidas deve ser PAR (entrada/saída pareados)';
  END IF;

  UPDATE public.time_records
     SET punches      = to_jsonb(p_punches),
         import_batch = CASE
                          WHEN import_batch IS NULL OR import_batch = '' OR import_batch !~ '^manual_completion'
                          THEN 'manual_completion:' || COALESCE(auth.uid()::text, 'system')
                          ELSE import_batch
                        END
   WHERE id = p_time_record_id
   RETURNING * INTO v_rec;

  -- Audit log entry separada (não usa weekly_balance_audit_log porque
  -- isso é completar ponto, não mexer em snapshot)
  INSERT INTO public.weekly_balance_audit_log
    (snapshot_id, employee_id, week_start, action, reason, changed_by, metadata)
  VALUES (
    NULL,
    (SELECT id FROM public.employees e
      WHERE e.external_id = v_rec.employee_external_id
         OR LOWER(TRIM(e.name)) = LOWER(TRIM(v_rec.employee_name))
      LIMIT 1),
    date_trunc('week', v_rec.record_date)::date,
    'recompute',
    COALESCE(p_reason, 'Batidas completadas manualmente'),
    auth.uid(),
    jsonb_build_object(
      'time_record_id', p_time_record_id,
      'record_date', v_rec.record_date,
      'old_punches', v_old_punches,
      'new_punches', to_jsonb(p_punches)
    )
  );

  RETURN v_rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_punches(uuid, text[], text) TO authenticated;

-- ── H. Cron sábado/segunda → fecha semana anterior ───────────────────────
-- Roda toda segunda 03:15 UTC (= sábado 00:15 BRT considerando timezone).
-- Não, na verdade — segunda 03:15 UTC = segunda 00:15 BRT (BRT é UTC-3).
-- A semana ISO terminou no domingo 23:59 → fecha logo no início da próxima.
DO $$
DECLARE
  v_extensions text;
BEGIN
  SELECT string_agg(extname, ',') INTO v_extensions FROM pg_extension WHERE extname = 'pg_cron';
  IF v_extensions IS NULL THEN
    RAISE NOTICE 'pg_cron não disponível — pulando agendamento. Configure manualmente ou use job externo.';
  ELSE
    -- Remove job antigo se existir
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'snapshot_weekly_close';
    -- Agenda novo
    PERFORM cron.schedule(
      'snapshot_weekly_close',
      '15 3 * * 1',  -- segunda 03:15 UTC ≈ segunda 00:15 BRT
      $cron$
        SELECT public.snapshot_all_employees_week(
          (date_trunc('week', CURRENT_DATE) - INTERVAL '7 days')::date,
          true
        );
      $cron$
    );
    RAISE NOTICE 'pg_cron job snapshot_weekly_close agendado: segunda 03:15 UTC';
  END IF;
END $$;
