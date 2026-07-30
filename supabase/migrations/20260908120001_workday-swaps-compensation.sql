-- =============================================================================
-- Trocas de dia / compensação (workday_swaps)
-- =============================================================================
-- Cadastro no setor de Pessoas (mesma aba de Feriados) de dias em que os
-- funcionários TROCAM um dia pelo outro: trabalham numa data (ex.: um domingo,
-- ou a "ponte" que emenda um feriado) em TROCA da folga em outra data.
--
-- Regra de leitura no ponto/folha (DIA FLEX — work_date e off_date iguais):
--   • TRABALHADO → lido como dia útil NORMAL, mesmo caindo em sábado/domingo/
--     feriado. As horas NÃO viram hora extra 100% — só o excedente da jornada
--     esperada conta como HE, igual a um dia comum.
--   • NÃO trabalhado → NEUTRO: sem jornada esperada, NÃO gera falta nem déficit
--     (o funcionário pode ter tirado a folga da troca). work_date e off_date têm
--     o MESMO tratamento — o rótulo (trabalhado vs folga) é só pro cadastro/UI.
--
-- Vale para TODOS os funcionários (igual aos feriados nacionais). O lado
-- TypeScript (computePeriodFolha/splitDayMinutes) aplica a mesma regra no
-- cálculo da folha; esta migration alinha o lado SQL (banco de horas).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.workday_swaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,               -- dia trabalhado que conta como NORMAL
  off_date  date NULL,                    -- folga compensatória (sem falta); NULL se não houver
  name text NOT NULL DEFAULT '',          -- descrição (ex.: "Ponte Corpus Christi")
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  -- work_date e off_date não podem ser a mesma data (não é troca)
  CONSTRAINT workday_swaps_distinct_dates CHECK (off_date IS NULL OR off_date <> work_date)
);

-- Uma troca por data trabalhada (evita duplicata que dobraria a regra).
CREATE UNIQUE INDEX IF NOT EXISTS uq_workday_swaps_work_date
  ON public.workday_swaps(work_date);

CREATE INDEX IF NOT EXISTS idx_workday_swaps_off_date
  ON public.workday_swaps(off_date)
  WHERE off_date IS NOT NULL;

ALTER TABLE public.workday_swaps ENABLE ROW LEVEL SECURITY;

-- RLS espelhando `holidays`: leitura aberta a autenticados, mutação restrita.
DROP POLICY IF EXISTS "workday_swaps_select" ON public.workday_swaps;
CREATE POLICY "workday_swaps_select" ON public.workday_swaps
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "workday_swaps_mutate" ON public.workday_swaps;
CREATE POLICY "workday_swaps_mutate" ON public.workday_swaps
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

COMMENT ON TABLE public.workday_swaps IS
  'Trocas de dia / compensação: work_date (trabalhado, lido como dia útil normal) '
  'trocado por off_date (folga sem falta). Aplica-se a todos os funcionários.';

-- =============================================================================
-- RPC v11: calculate_employee_bank_balance ciente de troca de dia.
-- =============================================================================
-- Base = v10 (diarista-aware). Adiciona:
--   • work_date da troca → NÃO cai no ramo feriado/domingo (HE 100%); é forçado a
--     dia útil NORMAL com a jornada padrão da escala (só excedente vira HE 50%).
--   • off_date da troca → folga: dia é pulado (não gera falta nem esperado).
-- Idempotente (CREATE OR REPLACE).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.calculate_employee_bank_balance(
  p_employee_id uuid,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date,
  p_skip_missing boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp record;
  v_sched record;
  v_cutoff date := public.get_bank_hours_cutoff();
  v_movements_min int := 0;
  v_movements_50  int := 0;
  v_movements_100 int := 0;
  v_timesheet_min int := 0;
  v_timesheet_50  int := 0;
  v_timesheet_100 int := 0;
  v_days_worked  int := 0;
  v_days_partial int := 0;
  v_days_absent  int := 0;
  v_days_missing int := 0;
  v_days_no_import int := 0;
  v_days_excused int := 0;
  v_total_min int;
  v_weekly_target_min int;
  v_tolerance_min int;
  v_min_overtime int;
  v_std_day_min int;               -- jornada padrão da escala (min) p/ dia trocado
  v_record record;
  v_sum jsonb;
  v_is_holiday boolean;
  v_is_swap_worked boolean;
  v_is_swap_off boolean;
  v_expected_for_day int;
  v_week_key date;
  v_week_worked int := 0;
  v_week_expected int := 0;
  v_week_diff int;
  v_prev_week_key date := NULL;
  v_effective_from date;
  v_effective_to   date;
  v_is_absent boolean;
  v_day_covered boolean;
  v_full_days int := 0;
  v_half_days int := 0;
  v_diaria_units numeric := 0;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN RETURN jsonb_build_object('error','Funcionario nao encontrado'); END IF;

  SELECT * INTO v_sched FROM public.work_schedules
   WHERE id = v_emp.work_schedule_id OR (v_emp.work_schedule_id IS NULL AND is_default = true)
   ORDER BY (id = v_emp.work_schedule_id) DESC, created_at ASC NULLS LAST, id
   LIMIT 1;

  v_weekly_target_min := COALESCE(v_sched.weekly_hours, 44) * 60;
  v_tolerance_min     := COALESCE(v_sched.tolerance_minutes, 10);
  v_min_overtime      := COALESCE(v_sched.minimum_overtime_minutes, 10);
  -- Jornada padrão do dia = saída − entrada − almoço (mesma conta de expectedDayMinutes
  -- no TS). Usada quando um dia de troca cai em dia não-escalado (dom/sáb).
  -- ⚠ almoço em COALESCE(..., 0): escala com entrada/saída mas SEM almoço cadastrado
  -- (lunch_* NULL) NÃO pode envenenar a subtração inteira pra NULL (senão cai no
  -- fallback weekly/5, divergindo do TS que trata almoço ausente como 0). Só quando
  -- entrada/saída em si são NULL (sem escala) é que o COALESCE externo usa weekly/5.
  v_std_day_min := GREATEST(0, COALESCE(
    (EXTRACT(EPOCH FROM (v_sched.exit_time - v_sched.entry_time))::int / 60)
      - COALESCE(EXTRACT(EPOCH FROM (v_sched.lunch_end - v_sched.lunch_start))::int / 60, 0),
    ROUND(v_weekly_target_min::numeric / 5)::int
  ));

  v_effective_from := GREATEST(
    COALESCE(p_from, v_cutoff), v_cutoff,
    COALESCE(v_emp.admission_date, '1900-01-01'::date)
  );
  v_effective_to := LEAST(
    COALESCE(p_to, CURRENT_DATE), CURRENT_DATE,
    COALESCE(v_emp.termination_date, '9999-12-31'::date)
  );

  -- DIARISTA: meia diaria proporcional. >=6h=1; 2-6h=0.5; <2h=0.
  IF v_emp.payment_type = 'diarista' THEN
    IF v_effective_from <= v_effective_to THEN
      WITH dias AS (
        SELECT tr.record_date,
          (SELECT COALESCE(SUM(
              EXTRACT(EPOCH FROM ((arr[gs+1]) - (arr[gs])))/60
              + CASE WHEN arr[gs+1] < arr[gs] THEN 1440 ELSE 0 END), 0)
            FROM (SELECT ARRAY(SELECT (v)::time FROM jsonb_array_elements_text(tr.punches) v ORDER BY (v)::time) arr) z,
                 generate_series(1, array_length(z.arr,1)-1, 2) gs
            WHERE array_length(z.arr,1) >= 2 AND array_length(z.arr,1) % 2 = 0
          ) AS worked_min
        FROM public.time_records tr
        WHERE (tr.employee_external_id = ANY(string_to_array(COALESCE(v_emp.external_id,''), ','))
               OR LOWER(TRIM(tr.employee_name)) = LOWER(TRIM(v_emp.name)))
          AND tr.record_date >= v_effective_from
          AND tr.record_date <= v_effective_to
          AND jsonb_array_length(tr.punches) >= 2
      )
      SELECT
        COUNT(*) FILTER (WHERE worked_min >= 360),
        COUNT(*) FILTER (WHERE worked_min >= 120 AND worked_min < 360)
      INTO v_full_days, v_half_days
      FROM dias;
    END IF;
    v_diaria_units := v_full_days + (v_half_days * 0.5);
    RETURN jsonb_build_object(
      'employee_id', p_employee_id, 'employee_name', v_emp.name, 'department', v_emp.department,
      'payment_type', 'diarista', 'daily_rate', v_emp.daily_rate,
      'days_worked', v_full_days + v_half_days, 'full_days', v_full_days, 'half_days', v_half_days,
      'diaria_units', v_diaria_units, 'daily_pay', ROUND(COALESCE(v_emp.daily_rate,0) * v_diaria_units, 2),
      'movements_min', 0, 'movements_50_min', 0, 'movements_100_min', 0,
      'timesheet_min', 0, 'timesheet_50_min', 0, 'timesheet_100_min', 0,
      'balance_min', 0, 'balance_50_min', 0, 'balance_100_min', 0,
      'days_partial', 0, 'days_absent', 0, 'days_missing', 0, 'days_no_import', 0, 'days_excused', 0,
      'weekly_target_min', 0, 'minimum_overtime_min', v_min_overtime, 'tolerance_min', v_tolerance_min,
      'period_from', p_from, 'period_to', p_to,
      'effective_from', v_effective_from, 'effective_to', v_effective_to,
      'cutoff_date', v_cutoff, 'skip_missing', p_skip_missing,
      'admission_date', v_emp.admission_date, 'termination_date', v_emp.termination_date,
      'apuracao', 'diarista_v10_half_day'
    );
  END IF;

  IF v_effective_from > v_effective_to THEN
    RETURN jsonb_build_object(
      'employee_id', p_employee_id, 'employee_name', v_emp.name, 'department', v_emp.department,
      'payment_type', COALESCE(v_emp.payment_type,'mensalista'),
      'movements_min', 0, 'movements_50_min', 0, 'movements_100_min', 0,
      'timesheet_min', 0, 'timesheet_50_min', 0, 'timesheet_100_min', 0,
      'balance_min', 0, 'balance_50_min', 0, 'balance_100_min', 0,
      'days_worked', 0, 'days_partial', 0, 'days_absent', 0,
      'days_missing', 0, 'days_no_import', 0, 'days_excused', 0,
      'weekly_target_min', v_weekly_target_min,
      'minimum_overtime_min', v_min_overtime, 'tolerance_min', v_tolerance_min,
      'period_from', p_from, 'period_to', p_to,
      'effective_from', v_effective_from, 'effective_to', v_effective_to,
      'cutoff_date', v_cutoff, 'skip_missing', p_skip_missing,
      'admission_date', v_emp.admission_date, 'termination_date', v_emp.termination_date,
      'note', 'Janela vazia (admissao apos periodo OU demissao antes)',
      'apuracao', 'semanal_individual_schedule_v11_workday_swaps'
    );
  END IF;

  SELECT
    COALESCE(SUM(minutes), 0),
    COALESCE(SUM(CASE WHEN overtime_pct = 50  THEN minutes ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN overtime_pct = 100 THEN minutes ELSE 0 END), 0)
  INTO v_movements_min, v_movements_50, v_movements_100
    FROM public.bank_hours_movements
   WHERE employee_id = p_employee_id
     AND movement_date >= v_effective_from AND movement_date <= v_effective_to;

  FOR v_record IN
    SELECT d::date AS record_date, EXTRACT(ISODOW FROM d)::int AS dow,
      date_trunc('week', d)::date AS week_start, tr.id IS NOT NULL AS has_record,
      COALESCE(tr.punches, '[]'::jsonb) AS punches
    FROM generate_series(v_effective_from, v_effective_to, '1 day') d
    LEFT JOIN public.time_records tr
      ON tr.record_date = d::date
      AND (tr.employee_external_id = v_emp.external_id
           OR LOWER(TRIM(tr.employee_name)) = LOWER(TRIM(v_emp.name)))
    ORDER BY d
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.holidays
       WHERE holiday_date = v_record.record_date AND COALESCE(optional, false) = false
    ) INTO v_is_holiday;

    -- Troca de dia (workday_swaps): work_date → dia útil normal; off_date → folga.
    SELECT EXISTS(SELECT 1 FROM public.workday_swaps WHERE work_date = v_record.record_date)
      INTO v_is_swap_worked;
    SELECT EXISTS(SELECT 1 FROM public.workday_swaps WHERE off_date = v_record.record_date)
      INTO v_is_swap_off;

    v_week_key := v_record.week_start;
    IF v_prev_week_key IS NOT NULL AND v_week_key <> v_prev_week_key THEN
      v_week_diff := v_week_worked - v_week_expected;
      IF ABS(v_week_diff) <= v_tolerance_min THEN v_week_diff := 0; END IF;
      IF v_week_diff > 0 AND v_week_diff < v_min_overtime THEN v_week_diff := 0; END IF;
      v_timesheet_min := v_timesheet_min + v_week_diff;
      v_timesheet_50  := v_timesheet_50  + v_week_diff;
      v_week_worked := 0; v_week_expected := 0;
    END IF;

    -- Ausência JUSTIFICADA (férias/atestado/licença) excusa QUALQUER dia, inclusive
    -- de troca — checa antes do bloco de troca.
    v_is_absent := public.is_employee_absent_on(p_employee_id, v_record.record_date);
    IF v_is_absent THEN
      v_days_excused := v_days_excused + 1;
      v_prev_week_key := v_week_key; CONTINUE;
    END IF;

    -- Troca de dia (workday_swaps): work_date E off_date são DIAS FLEX. TRABALHADO →
    -- dia útil NORMAL (jornada da escala; só o excedente vira HE 50%, nunca 100% de
    -- fim de semana/feriado). NÃO trabalhado → NEUTRO: sem falta nem déficit (o
    -- funcionário pode ter tirado a folga da troca). Tratar work_date e off_date igual
    -- elimina a divergência quando uma data é work_date de uma troca e off_date de
    -- outra, e alinha com a folha (computePeriodFolha) e o espelho.
    IF v_is_swap_worked OR v_is_swap_off THEN
      IF v_record.has_record THEN
        -- Esperado individual do dia; se 0 (dom/sáb não-escalado), usa a jornada padrão.
        v_expected_for_day := COALESCE(
          NULLIF(public.get_employee_expected_minutes(p_employee_id, v_record.record_date), 0),
          v_std_day_min);
        v_sum := public.calculate_day_summary(v_record.punches, v_expected_for_day, v_tolerance_min, v_min_overtime, false, true);
        IF (v_sum->>'status') IN ('partial','inconsistent','irregular') THEN
          v_days_partial := v_days_partial + 1;
        ELSIF (v_sum->>'worked_min')::int > 0 THEN
          v_days_worked := v_days_worked + 1;
          v_week_worked   := v_week_worked   + (v_sum->>'worked_min')::int;
          v_week_expected := v_week_expected + (v_sum->>'expected_min')::int;
        END IF;
        -- worked_min = 0 (batida vazia) → neutro, sem falta.
      END IF;
      -- sem registro → neutro (sem déficit pra quem não trabalhou a ponte).
      v_prev_week_key := v_week_key; CONTINUE;
    END IF;

    v_expected_for_day := COALESCE(public.get_employee_expected_minutes(p_employee_id, v_record.record_date), 0);

    IF v_is_holiday OR v_record.dow = 7 THEN
      IF v_record.has_record THEN
        v_sum := public.calculate_day_summary(v_record.punches, 0, v_tolerance_min, v_min_overtime, true);
        IF (v_sum->>'worked_min')::int > 0 THEN
          v_days_worked := v_days_worked + 1;
          v_timesheet_min := v_timesheet_min + (v_sum->>'worked_min')::int;
          v_timesheet_100 := v_timesheet_100 + (v_sum->>'worked_min')::int;
        END IF;
      END IF;
      v_prev_week_key := v_week_key; CONTINUE;
    END IF;

    IF v_expected_for_day = 0 THEN
      IF v_record.has_record THEN
        v_sum := public.calculate_day_summary(v_record.punches, 0, v_tolerance_min, v_min_overtime, false, (v_record.dow BETWEEN 1 AND 5));
        IF (v_sum->>'worked_min')::int > 0 THEN
          v_days_worked := v_days_worked + 1;
          v_week_worked := v_week_worked + (v_sum->>'worked_min')::int;
        END IF;
      END IF;
      v_prev_week_key := v_week_key; CONTINUE;
    END IF;

    IF NOT v_record.has_record THEN
      SELECT EXISTS(SELECT 1 FROM public.time_records WHERE record_date = v_record.record_date) INTO v_day_covered;
      IF v_day_covered THEN
        v_days_missing := v_days_missing + 1;
        IF NOT p_skip_missing THEN v_week_expected := v_week_expected + v_expected_for_day; END IF;
      ELSE
        v_days_no_import := v_days_no_import + 1;
      END IF;
      v_prev_week_key := v_week_key; CONTINUE;
    END IF;

    v_sum := public.calculate_day_summary(v_record.punches, v_expected_for_day, v_tolerance_min, v_min_overtime, false, (v_record.dow BETWEEN 1 AND 5));

    IF (v_sum->>'status') IN ('partial','inconsistent','irregular') THEN
      v_days_partial := v_days_partial + 1;
      v_week_expected := v_week_expected + (v_sum->>'expected_min')::int;
    ELSIF (v_sum->>'status') = 'absent' THEN
      v_days_absent := v_days_absent + 1;
      v_week_worked := v_week_worked + (v_sum->>'worked_min')::int;
      v_week_expected := v_week_expected + (v_sum->>'expected_min')::int;
    ELSE
      v_days_worked := v_days_worked + 1;
      v_week_worked := v_week_worked + (v_sum->>'worked_min')::int;
      v_week_expected := v_week_expected + (v_sum->>'expected_min')::int;
    END IF;

    v_prev_week_key := v_week_key;
  END LOOP;

  IF v_prev_week_key IS NOT NULL THEN
    v_week_diff := v_week_worked - v_week_expected;
    IF ABS(v_week_diff) <= v_tolerance_min THEN v_week_diff := 0; END IF;
    IF v_week_diff > 0 AND v_week_diff < v_min_overtime THEN v_week_diff := 0; END IF;
    v_timesheet_min := v_timesheet_min + v_week_diff;
    v_timesheet_50  := v_timesheet_50  + v_week_diff;
  END IF;

  v_total_min := v_movements_min + v_timesheet_min;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id, 'employee_name', v_emp.name, 'department', v_emp.department,
    'payment_type', COALESCE(v_emp.payment_type,'mensalista'),
    'movements_min', v_movements_min, 'movements_50_min', v_movements_50, 'movements_100_min', v_movements_100,
    'timesheet_min', v_timesheet_min, 'timesheet_50_min', v_timesheet_50, 'timesheet_100_min', v_timesheet_100,
    'balance_min', v_total_min,
    'balance_50_min', v_movements_50 + v_timesheet_50, 'balance_100_min', v_movements_100 + v_timesheet_100,
    'days_worked', v_days_worked, 'days_partial', v_days_partial, 'days_absent', v_days_absent,
    'days_missing', v_days_missing, 'days_no_import', v_days_no_import, 'days_excused', v_days_excused,
    'weekly_target_min', v_weekly_target_min,
    'minimum_overtime_min', v_min_overtime, 'tolerance_min', v_tolerance_min,
    'period_from', p_from, 'period_to', p_to,
    'effective_from', v_effective_from, 'effective_to', v_effective_to,
    'cutoff_date', v_cutoff, 'skip_missing', p_skip_missing,
    'admission_date', v_emp.admission_date, 'termination_date', v_emp.termination_date,
    'apuracao', 'semanal_individual_schedule_v11_workday_swaps'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calculate_employee_bank_balance(uuid, date, date, boolean) TO authenticated;
