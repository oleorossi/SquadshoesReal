-- ============================================================================
-- Pendências de ponto 2026-10-17: só 4 batidas (par completo) saem da fila.
--
-- Supercede a inferência de:
--   n=2 → almoço 1h implícito (pago como dia completo)
--   n=3 com última > 13:00 → pausa de almoço inferida (20270101024200)
--
-- Espelha src/lib/hourlyPayroll.ts splitDayMinutes + dayCellStatus.punchesNeedFix:
--   0 batidas          → absent / weekend / holiday (como antes)
--   1, 2, 3 ou ímpar≥5 → irregular (pendência; worked_min = 0)
--   par ≥4             → soma dos pares (almoço real nos gaps)
--
-- v_pending_time_records: lista TODO n=2 e TODO n=3 (e demais ímpares).
-- v_time_pendings herda via calculate_day_summary (status irregular).
-- ============================================================================

BEGIN;

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

  -- 0 batidas: ausência / folga / feriado.
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

  -- 1, 2, 3 ou ímpar ≥5 → pendência (decisão 2026-10-17). Só par ≥4 paga.
  IF v_count < 4 OR (v_count % 2) <> 0 THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'irregular',
      'partial_reason', CASE
        WHEN v_count = 1 THEN 'somente_uma_batida'
        WHEN v_count = 2 THEN 'faltam_batidas_almoco'
        WHEN v_count = 3 THEN 'punches_impar'
        ELSE 'punches_impar'
      END,
      'punch_count', v_count
    );
  END IF;

  -- Par ≥4: soma dos pares reais.
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

  -- p_has_lunch: assinatura legada; com 4+ batidas o almoço já está nos gaps.

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
    rwg.pc < 4
    OR (rwg.pc % 2) <> 0
  );

REVOKE ALL ON TABLE public.v_pending_time_records FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.v_pending_time_records TO authenticated, service_role;

COMMENT ON VIEW public.v_pending_time_records IS
  'Pendências de batida por time_records.employee_id. Só par ≥4 (4 slots) sai da fila — n=2 e n=3 sempre pendem (decisão 2026-10-17).';

COMMENT ON FUNCTION public.calculate_day_summary(jsonb, integer, integer, integer, boolean, boolean) IS
  'Diário do dia: só par ≥4 batidas conta horas; 1/2/3 e ímpar≥5 = irregular (pendência).';

COMMIT;
