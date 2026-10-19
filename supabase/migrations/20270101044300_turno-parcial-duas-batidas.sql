-- ============================================================================
-- Turno parcial com 2 batidas (19/10/2026 — Mariane 13:06→18:06).
--
-- A 20270101042200 mandava TODO n=2 pra fila (pra não inferir almoço em
-- jornada cheia 08→18). Isso também travava quem só veio de tarde/manhã.
--
-- Regra nova (espelha src/lib/ponto/interpretDayPunches.ts
-- twoPunchesNeedLunchMarks + splitDayMinutes):
--   n=2 turno parcial (não cruza 12h→13h; não é virada) → PAGA o par
--   n=2 jornada cheia / virada                               → irregular (fila)
--   1, 3, ímpar ≥5                                      → irregular (igual)
--   par ≥4                                              → soma dos pares
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.two_punches_need_lunch_marks(p_punches jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_a int;
  v_b int;
  v_first int;
  v_last int;
  v_t time;
BEGIN
  IF p_punches IS NULL OR jsonb_typeof(p_punches) <> 'array'
     OR jsonb_array_length(p_punches) <> 2 THEN
    RETURN false;
  END IF;

  BEGIN
    v_t := regexp_replace((p_punches->0)::text, '[\\"*]', '', 'g')::time;
    v_a := (EXTRACT(HOUR FROM v_t)::int * 60) + EXTRACT(MINUTE FROM v_t)::int;
    v_t := regexp_replace((p_punches->1)::text, '[\\"*]', '', 'g')::time;
    v_b := (EXTRACT(HOUR FROM v_t)::int * 60) + EXTRACT(MINUTE FROM v_t)::int;
  EXCEPTION WHEN OTHERS THEN
    RETURN true; -- parse falhou → manda pra fila
  END;

  -- Virada: entrada diurna (≥05h) + saída madrugada (<05h), ordem do relógio.
  IF v_a >= 5 * 60 AND v_b < 5 * 60 THEN
    RETURN true;
  END IF;

  v_first := LEAST(v_a, v_b);
  v_last := GREATEST(v_a, v_b);
  -- Entrou antes das 12h e saiu ≥13h sem bater almoço.
  RETURN v_first < 12 * 60 AND v_last >= 13 * 60;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.calculate_day_summary(
  p_punches jsonb,
  p_expected_min integer,
  p_tolerance_min integer,
  p_minimum_overtime integer,
  p_is_holiday boolean DEFAULT false,
  p_has_lunch boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_partial_reason text := NULL;
  v_clean jsonb := '[]'::jsonb;
  v_prev_min int := NULL;
  v_t time;
  v_min int;
  i int;
  v_n2_pending boolean := false;
BEGIN
  IF p_punches IS NOT NULL AND jsonb_typeof(p_punches) = 'array' THEN
    FOR i IN 0 .. jsonb_array_length(p_punches) - 1 LOOP
      BEGIN
        v_t := regexp_replace((p_punches->i)::text, '[\\"*]', '', 'g')::time;
        v_min := (EXTRACT(HOUR FROM v_t)::int * 60) + EXTRACT(MINUTE FROM v_t)::int;
        IF v_prev_min IS NULL OR ABS(v_min - v_prev_min) >= 5 THEN
          v_clean := v_clean || jsonb_build_array(p_punches->i);
        END IF;
        v_prev_min := v_min;
      EXCEPTION WHEN OTHERS THEN
        v_clean := v_clean || jsonb_build_array(p_punches->i);
        v_prev_min := NULL;
      END;
    END LOOP;
    p_punches := v_clean;
  END IF;

  IF p_punches IS NULL OR jsonb_typeof(p_punches) <> 'array' THEN
    v_count := 0;
  ELSE
    v_count := jsonb_array_length(p_punches);
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

  -- Ímpar → pendência. n=2 só pendência se cruza almoço / virada.
  IF (v_count % 2) <> 0 THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'irregular',
      'partial_reason', CASE
        WHEN v_count = 1 THEN 'somente_uma_batida'
        WHEN v_count = 3 THEN 'punches_impar'
        ELSE 'punches_impar'
      END,
      'punch_count', v_count
    );
  END IF;

  IF v_count = 2 THEN
    v_n2_pending := public.two_punches_need_lunch_marks(p_punches);
    IF v_n2_pending THEN
      RETURN jsonb_build_object(
        'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
        'status', 'irregular',
        'partial_reason', 'faltam_batidas_almoco',
        'punch_count', v_count
      );
    END IF;
    -- turno parcial: cai no pareamento abaixo
  ELSIF v_count < 4 THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'irregular',
      'partial_reason', 'punches_impar',
      'punch_count', v_count
    );
  END IF;

  -- Par ≥2 válido (parcial n=2 ou ≥4): soma dos pares reais.
  v_idx := 0;
  WHILE v_idx < v_count - 1 LOOP
    BEGIN
      v_in  := regexp_replace((p_punches->v_idx)::text,        '[\\"*]', '', 'g')::time;
      v_out := regexp_replace((p_punches->(v_idx+1))::text,    '[\\"*]', '', 'g')::time;
      v_pair := EXTRACT(EPOCH FROM (v_out - v_in))::int / 60;
      IF v_pair < 0 THEN v_pair := v_pair + 1440; END IF;
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
  ELSIF v_diff < 0 AND p_expected_min > 0 THEN
    v_status := CASE WHEN v_worked > 0 THEN 'late' ELSE 'absent' END;
  ELSE v_status := 'normal';
  END IF;

  RETURN jsonb_build_object(
    'worked_min', v_worked,
    'expected_min', p_expected_min,
    'overtime_min', GREATEST(v_diff, 0),
    'absence_min', GREATEST(-v_diff, 0),
    'diff_min', v_diff,
    'status', v_status,
    'partial_reason', v_partial_reason,
    'punch_count', v_count
  );
END;
$function$;

CREATE OR REPLACE VIEW public.v_pending_time_records
WITH (security_invoker = true) AS
WITH default_sched AS (
  SELECT * FROM public.work_schedules
  WHERE is_default = true
  ORDER BY created_at, id
  LIMIT 1
),
records_with_gap AS (
  SELECT
    tr.*,
    jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) AS pc,
    (
      SELECT MAX(
        (SPLIT_PART(regexp_replace(elem, '[^0-9:]', '', 'g'), ':', 1)::int * 60)
        + COALESCE(NULLIF(SPLIT_PART(regexp_replace(elem, '[^0-9:]', '', 'g'), ':', 2), '')::int, 0)
      )
      FROM jsonb_array_elements_text(COALESCE(tr.punches, '[]'::jsonb)) AS elem
      WHERE regexp_replace(elem, '[^0-9:]', '', 'g') ~ '^[0-2][0-9]:[0-5][0-9]$'
    ) AS last_punch_min,
    (
      (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60
        + EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time))
      - (EXTRACT(HOUR FROM (SELECT entry_time FROM default_sched)::time) * 60
        + EXTRACT(MINUTE FROM (SELECT entry_time FROM default_sched)::time))
      + (EXTRACT(HOUR FROM (SELECT exit_time FROM default_sched)::time) * 60
        + EXTRACT(MINUTE FROM (SELECT exit_time FROM default_sched)::time))
      - (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60
        + EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
    )::integer AS expected_min
  FROM public.time_records tr
)
SELECT
  rwg.id AS time_record_id,
  rwg.employee_name,
  rwg.employee_external_id,
  rwg.employee_id,
  rwg.department,
  rwg.record_date,
  EXTRACT(ISODOW FROM rwg.record_date)::integer AS dow,
  rwg.punches,
  rwg.pc AS punch_count,
  CASE
    WHEN rwg.pc = 1 THEN 'somente_uma_batida'
    WHEN rwg.pc = 2 THEN 'faltam_batidas_almoco'
    WHEN rwg.pc = 3 THEN 'punches_impar'
    WHEN rwg.pc = 5 THEN 'batida_extra'
    WHEN rwg.pc % 2 <> 0 THEN 'punches_impar'
    ELSE NULL
  END AS issue_type,
  EXISTS (
    SELECT 1 FROM public.time_record_manual_overrides o WHERE o.time_record_id = rwg.id
  ) AS has_manual_override,
  (rwg.employee_id IS NULL) AS employee_match_ambiguous
FROM records_with_gap rwg
WHERE rwg.pc > 0
  AND (
    (rwg.pc % 2) <> 0
    OR (rwg.pc = 2 AND public.two_punches_need_lunch_marks(rwg.punches))
    OR (rwg.pc > 2 AND rwg.pc < 4)
  );

REVOKE ALL ON TABLE public.v_pending_time_records FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.v_pending_time_records TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.two_punches_need_lunch_marks(jsonb) TO authenticated, service_role;

COMMENT ON VIEW public.v_pending_time_records IS
  'Pendências de batida. n=2 turno parcial (só manhã/tarde) NÃO entra; n=2 jornada cheia/virada e ímpar sim (20270101044300).';

COMMENT ON FUNCTION public.calculate_day_summary(jsonb, integer, integer, integer, boolean, boolean) IS
  'Diário do dia: par ≥4 e n=2 turno parcial contam horas; n=2 com almoço faltando / virada e ímpar = irregular.';

COMMENT ON FUNCTION public.two_punches_need_lunch_marks(jsonb) IS
  'Espelho de twoPunchesNeedLunchMarks (TS): true = n=2 ainda precisa de almoço ou é virada.';

COMMIT;
