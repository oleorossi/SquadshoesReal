-- =============================================================================
-- Opção C — Auditoria de Timesheet: source-of-truth único + decisões do usuário
-- =============================================================================
-- 3 decisões do usuário:
--   1.D: Pendências de ponto resolvidas via aba dedicada (manual override).
--   2.C: minimum_overtime_minutes = 10 (tolerância CLT máxima).
--   3.B: HE apurada SEMANALMENTE (CLT 44h) — dia curto compensa dia longo.
--
-- Estruturas criadas:
--   • time_record_manual_overrides — auditoria de complementos manuais
--   • RPC apply_manual_punch_completion — adiciona batida com marker '*'
--   • RPC calculate_day_summary — fonte única de cálculo por dia
--   • RPC calculate_employee_bank_balance — refatorada com lógica semanal
--   • VIEW v_pending_time_records — dias com batida ímpar precisando revisão
--   • VIEW v_employee_pending_summary — total pendente por funcionário
-- =============================================================================

-- ── 1. Defaults: minimum_overtime_minutes = 10 ───────────────────────────────

UPDATE public.work_schedules
   SET minimum_overtime_minutes = 10
 WHERE COALESCE(minimum_overtime_minutes, 0) = 0;

ALTER TABLE public.work_schedules
  ALTER COLUMN minimum_overtime_minutes SET DEFAULT 10;


-- ── 2. Tabela de auditoria de overrides manuais ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.time_record_manual_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time_record_id  uuid NOT NULL REFERENCES public.time_records(id) ON DELETE CASCADE,
  added_punch     time NOT NULL,
  position        int NOT NULL,                 -- índice na nova array de punches
  reason          text NOT NULL DEFAULT 'completed-by-rh',
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  punches_before  jsonb NOT NULL,
  punches_after   jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tr_manual_overrides_record
  ON public.time_record_manual_overrides(time_record_id);
CREATE INDEX IF NOT EXISTS idx_tr_manual_overrides_created
  ON public.time_record_manual_overrides(created_at DESC);

ALTER TABLE public.time_record_manual_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view manual overrides" ON public.time_record_manual_overrides;
CREATE POLICY "Auth users can view manual overrides"
  ON public.time_record_manual_overrides FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth users can insert manual overrides" ON public.time_record_manual_overrides;
CREATE POLICY "Auth users can insert manual overrides"
  ON public.time_record_manual_overrides FOR INSERT TO authenticated WITH CHECK (true);


-- ── 3. RPC: completa um dia ímpar com batida manual ──────────────────────────

DROP FUNCTION IF EXISTS public.apply_manual_punch_completion(uuid, time, text);
CREATE OR REPLACE FUNCTION public.apply_manual_punch_completion(
  p_time_record_id uuid,
  p_punch_time     time,
  p_reason         text DEFAULT 'completed-by-rh'
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_record record;
  v_old_punches jsonb;
  v_new_punches jsonb;
  v_punch_str text;
  v_position int;
  v_count int;
BEGIN
  SELECT * INTO v_record FROM public.time_records WHERE id = p_time_record_id;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'time_record % não encontrado', p_time_record_id;
  END IF;

  v_old_punches := COALESCE(v_record.punches, '[]'::jsonb);
  v_count := jsonb_array_length(v_old_punches);

  -- Marca como manual com asterisco no fim (compatível com hook frontend
  -- que já strippava '*' em src/hooks/useTimesheet.ts)
  v_punch_str := to_char(p_punch_time, 'HH24:MI') || '*';

  -- Insere mantendo ordem cronológica (sort após append)
  v_new_punches := v_old_punches || to_jsonb(v_punch_str);
  -- Re-sorta: extrai HH:MM (ignora *) e ordena
  WITH expanded AS (
    SELECT value, regexp_replace(value::text, '[\"*]', '', 'g')::time AS t
      FROM jsonb_array_elements(v_new_punches) AS value
  )
  SELECT jsonb_agg(value ORDER BY t) INTO v_new_punches FROM expanded;

  -- Calcula posição final do novo punch na array sortada
  SELECT idx-1 INTO v_position FROM (
    SELECT row_number() OVER () AS idx, value
      FROM jsonb_array_elements(v_new_punches)
  ) sub WHERE value::text = to_jsonb(v_punch_str)::text LIMIT 1;

  UPDATE public.time_records
     SET punches = v_new_punches
   WHERE id = p_time_record_id;

  INSERT INTO public.time_record_manual_overrides
    (time_record_id, added_punch, position, reason, created_by, punches_before, punches_after)
  VALUES
    (p_time_record_id, p_punch_time, COALESCE(v_position,v_count), p_reason, auth.uid(), v_old_punches, v_new_punches);

  RETURN jsonb_build_object(
    'success', true,
    'time_record_id', p_time_record_id,
    'punches_before', v_old_punches,
    'punches_after', v_new_punches,
    'new_punch_count', jsonb_array_length(v_new_punches)
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.apply_manual_punch_completion(uuid, time, text) TO authenticated;


-- ── 4. RPC canonical: calcula resumo de UM dia (single source of truth) ──────

DROP FUNCTION IF EXISTS public.calculate_day_summary(jsonb, integer, integer, integer, boolean);
CREATE OR REPLACE FUNCTION public.calculate_day_summary(
  p_punches            jsonb,
  p_expected_min       int,
  p_tolerance_min      int,
  p_minimum_overtime   int,
  p_is_holiday         boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $fn$
DECLARE
  v_count int;
  v_worked int := 0;
  v_pair_count int := 0;
  v_idx int;
  v_in time;
  v_out time;
  v_pair int;
  v_diff int;
  v_status text;
BEGIN
  IF p_punches IS NULL OR jsonb_typeof(p_punches) <> 'array' THEN
    v_count := 0;
  ELSE
    v_count := jsonb_array_length(p_punches);
  END IF;

  -- Punches ímpares = dia partial (não soma worked, status = 'partial')
  IF v_count > 1 AND v_count % 2 <> 0 THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'partial',
      'partial_reason', 'punches_impar',
      'punch_count', v_count
    );
  END IF;

  IF v_count = 1 THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'partial',
      'partial_reason', 'somente_uma_batida',
      'punch_count', v_count
    );
  END IF;

  IF v_count = 0 THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', CASE WHEN p_is_holiday THEN 'holiday'
                     WHEN p_expected_min = 0 THEN 'weekend'
                     ELSE 'absent' END,
      'partial_reason', NULL,
      'punch_count', 0
    );
  END IF;

  -- Pares de punches (com correção de turno noturno)
  v_idx := 0;
  WHILE v_idx < v_count - 1 LOOP
    BEGIN
      v_in  := regexp_replace((p_punches->v_idx)::text,        '[\"*]', '', 'g')::time;
      v_out := regexp_replace((p_punches->(v_idx+1))::text,    '[\"*]', '', 'g')::time;
      v_pair := EXTRACT(EPOCH FROM (v_out - v_in))::int / 60;
      IF v_pair < 0 THEN v_pair := v_pair + 1440; END IF; -- overnight fix
      v_worked := v_worked + v_pair;
      v_pair_count := v_pair_count + 1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    v_idx := v_idx + 2;
  END LOOP;

  v_diff := v_worked - p_expected_min;
  IF ABS(v_diff) <= p_tolerance_min THEN v_diff := 0; END IF;
  IF v_diff > 0 AND v_diff < p_minimum_overtime THEN v_diff := 0; END IF;

  IF p_is_holiday AND v_worked > 0 THEN v_status := 'holiday';
  ELSIF v_diff > 0 THEN v_status := 'overtime';
  ELSIF v_diff < 0 AND p_expected_min > 0 THEN v_status := 'absent';
  ELSE v_status := 'normal';
  END IF;

  RETURN jsonb_build_object(
    'worked_min', v_worked,
    'expected_min', p_expected_min,
    'overtime_min', GREATEST(v_diff, 0),
    'absence_min', GREATEST(-v_diff, 0),
    'diff_min', v_diff,
    'status', v_status,
    'partial_reason', NULL,
    'punch_count', v_count
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.calculate_day_summary(jsonb, int, int, int, boolean) TO authenticated;


-- ── 5. Refactor calculate_employee_bank_balance: lógica SEMANAL CLT ──────────

DROP FUNCTION IF EXISTS public.calculate_employee_bank_balance(uuid, date, date);
CREATE OR REPLACE FUNCTION public.calculate_employee_bank_balance(
  p_employee_id uuid,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_emp record;
  v_sched record;
  v_movements_min int := 0;
  v_timesheet_min int := 0;
  v_days_worked int := 0;
  v_days_partial int := 0;
  v_total_min int;
  v_expected_per_day int;
  v_weekly_target_min int;
  v_tolerance_min int;
  v_min_overtime int;
  v_record record;
  v_sum jsonb;

  v_week_key date;     -- ISO week start (Monday) do dia atual
  v_week_worked int := 0;
  v_week_expected int := 0;
  v_week_partial int := 0;
  v_week_diff int;
  v_prev_week_key date := NULL;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN RETURN jsonb_build_object('error','Funcionário não encontrado'); END IF;

  SELECT * INTO v_sched FROM public.work_schedules
   WHERE id = v_emp.work_schedule_id OR (v_emp.work_schedule_id IS NULL AND is_default = true)
   LIMIT 1;

  v_weekly_target_min := COALESCE(v_sched.weekly_hours, 44) * 60;
  v_expected_per_day  := ROUND(v_weekly_target_min::numeric / 5);
  v_tolerance_min     := COALESCE(v_sched.tolerance_minutes, 10);
  v_min_overtime      := COALESCE(v_sched.minimum_overtime_minutes, 10);

  -- Lançamentos manuais
  SELECT COALESCE(SUM(minutes), 0) INTO v_movements_min
    FROM public.bank_hours_movements
   WHERE employee_id = p_employee_id
     AND (p_from IS NULL OR movement_date >= p_from)
     AND (p_to   IS NULL OR movement_date <= p_to);

  -- Loop por dia ORDENADO ASC. Agrega por semana (ISO Mon..Sun).
  -- Quando muda de semana, calcula HE/déficit semanal e vai pro saldo.
  FOR v_record IN
    SELECT tr.*, EXTRACT(ISODOW FROM tr.record_date)::int AS dow,
           date_trunc('week', tr.record_date)::date AS week_start
      FROM public.time_records tr
     WHERE (tr.employee_external_id = v_emp.external_id
            OR LOWER(TRIM(tr.employee_name)) = LOWER(TRIM(v_emp.name)))
       AND (p_from IS NULL OR tr.record_date >= p_from)
       AND (p_to   IS NULL OR tr.record_date <= p_to)
     ORDER BY tr.record_date ASC
  LOOP
    v_week_key := v_record.week_start;

    -- Mudou de semana → fecha a anterior
    IF v_prev_week_key IS NOT NULL AND v_week_key <> v_prev_week_key THEN
      v_week_diff := v_week_worked - v_week_expected;
      IF ABS(v_week_diff) <= v_tolerance_min THEN v_week_diff := 0; END IF;
      IF v_week_diff > 0 AND v_week_diff < v_min_overtime THEN v_week_diff := 0; END IF;
      v_timesheet_min := v_timesheet_min + v_week_diff;

      v_week_worked := 0;
      v_week_expected := 0;
    END IF;

    -- Calcula o dia via canonical
    v_sum := public.calculate_day_summary(
      v_record.punches,
      CASE WHEN v_record.dow = 7 THEN 0
           WHEN v_record.dow = 6 AND v_sched.saturday_entry IS NOT NULL THEN
             EXTRACT(EPOCH FROM (v_sched.saturday_exit - v_sched.saturday_entry))::int / 60
           WHEN v_record.dow = 6 THEN 0
           ELSE v_expected_per_day
      END,
      v_tolerance_min,
      v_min_overtime,
      false
    );

    IF (v_sum->>'status') = 'partial' THEN
      v_days_partial := v_days_partial + 1;
    ELSE
      v_days_worked := v_days_worked + 1;
      v_week_worked := v_week_worked + (v_sum->>'worked_min')::int;
      v_week_expected := v_week_expected + (v_sum->>'expected_min')::int;
    END IF;

    v_prev_week_key := v_week_key;
  END LOOP;

  -- Fecha a última semana
  IF v_prev_week_key IS NOT NULL THEN
    v_week_diff := v_week_worked - v_week_expected;
    IF ABS(v_week_diff) <= v_tolerance_min THEN v_week_diff := 0; END IF;
    IF v_week_diff > 0 AND v_week_diff < v_min_overtime THEN v_week_diff := 0; END IF;
    v_timesheet_min := v_timesheet_min + v_week_diff;
  END IF;

  v_total_min := v_movements_min + v_timesheet_min;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id,
    'employee_name', v_emp.name,
    'department', v_emp.department,
    'movements_min', v_movements_min,
    'timesheet_min', v_timesheet_min,
    'balance_min', v_total_min,
    'days_worked', v_days_worked,
    'days_partial', v_days_partial,
    'expected_per_day_min', v_expected_per_day,
    'weekly_target_min', v_weekly_target_min,
    'minimum_overtime_min', v_min_overtime,
    'tolerance_min', v_tolerance_min,
    'period_from', p_from,
    'period_to', p_to,
    'apuracao', 'semanal_clt'
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.calculate_employee_bank_balance(uuid, date, date) TO authenticated;


-- ── 6. View de pendências (para a aba nova de complementação manual) ────────

DROP VIEW IF EXISTS public.v_pending_time_records CASCADE;
CREATE OR REPLACE VIEW public.v_pending_time_records
WITH (security_invoker = true) AS
SELECT
  tr.id AS time_record_id,
  tr.employee_name,
  tr.employee_external_id,
  e.id AS employee_id,
  tr.department,
  tr.record_date,
  EXTRACT(ISODOW FROM tr.record_date)::int AS dow,
  tr.punches,
  jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) AS punch_count,
  CASE
    WHEN jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) = 1 THEN 'somente_uma_batida'
    WHEN jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) = 3 THEN 'falta_saida_apos_almoco'
    WHEN jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) = 5 THEN 'batida_extra'
    WHEN jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) % 2 != 0 THEN 'punches_impar'
    ELSE NULL
  END AS issue_type,
  EXISTS (
    SELECT 1 FROM public.time_record_manual_overrides o WHERE o.time_record_id = tr.id
  ) AS has_manual_override
FROM public.time_records tr
LEFT JOIN public.employees e
  ON (tr.employee_external_id = e.external_id
   OR LOWER(TRIM(tr.employee_name)) = LOWER(TRIM(e.name)))
WHERE jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) > 0
  AND jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) % 2 != 0;

GRANT SELECT ON public.v_pending_time_records TO authenticated;


-- ── 7. View resumo: total pendente por funcionário ───────────────────────────

DROP VIEW IF EXISTS public.v_employee_pending_summary CASCADE;
CREATE OR REPLACE VIEW public.v_employee_pending_summary
WITH (security_invoker = true) AS
SELECT
  e.id AS employee_id,
  e.name,
  e.department,
  COUNT(p.time_record_id) AS pending_count,
  MIN(p.record_date) AS oldest_pending,
  MAX(p.record_date) AS newest_pending,
  COUNT(p.time_record_id) FILTER (WHERE p.issue_type = 'somente_uma_batida') AS only_one_punch,
  COUNT(p.time_record_id) FILTER (WHERE p.issue_type = 'falta_saida_apos_almoco') AS missing_exit,
  COUNT(p.time_record_id) FILTER (WHERE p.issue_type = 'batida_extra') AS extra_punch
FROM public.employees e
LEFT JOIN public.v_pending_time_records p ON p.employee_id = e.id
GROUP BY e.id, e.name, e.department;

GRANT SELECT ON public.v_employee_pending_summary TO authenticated;
