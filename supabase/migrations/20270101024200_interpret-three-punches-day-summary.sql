-- ============================================================================
-- Diário de ponto 2026-09-12: 3 batidas com saída real NÃO são pendência.
--
-- Espelha src/lib/ponto/interpretDayPunches.ts + splitDayMinutes:
--   n=3, última > 13:00 → infere a pausa do almoço e conta manhã+tarde.
--   n=3, última ≤ 13:00 → continua irregular (falta a saída final).
--   n=1 e ímpar ≥5      → pendência (auditoria 2026-07-30 intacta).
--
-- calculate_day_summary: deixa de zerar n=3 interpretável.
-- v_pending_time_records: tira esses dias da fila (senão o diário pagaria
-- e a tela ainda pediria 18:00 em cima da saída real).
-- v_employee_pending_summary herda o filtro (é VIEW em cima desta).
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
  v_lunch_default_min int := 60;
  v_clean jsonb := '[]'::jsonb;
  v_prev_min int := NULL;
  v_t time;
  v_min int;
  i int;
  v_three_done boolean := false;
  v_a int;
  v_b int;
  v_c int;
  v_tmp int;
  v_lunch_out int;
  v_i1a int := 0;
  v_i1b int := 0;
  v_i2a int := 0;
  v_i2b int := 0;
  v_on_shift int;
  v_worked_win int;
  v_break int;
  v_lunch_top int;
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

  -- n=3 com saída real: infere a pausa do almoço (decisão 2026-09-12).
  IF v_count = 3 THEN
    BEGIN
      v_t := regexp_replace((p_punches->0)::text, '[\\"*]', '', 'g')::time;
      v_a := (EXTRACT(HOUR FROM v_t)::int * 60) + EXTRACT(MINUTE FROM v_t)::int;
      v_t := regexp_replace((p_punches->1)::text, '[\\"*]', '', 'g')::time;
      v_b := (EXTRACT(HOUR FROM v_t)::int * 60) + EXTRACT(MINUTE FROM v_t)::int;
      v_t := regexp_replace((p_punches->2)::text, '[\\"*]', '', 'g')::time;
      v_c := (EXTRACT(HOUR FROM v_t)::int * 60) + EXTRACT(MINUTE FROM v_t)::int;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
        'status', 'irregular', 'partial_reason', 'punches_impar', 'punch_count', v_count
      );
    END;

    IF v_a > v_b THEN v_tmp := v_a; v_a := v_b; v_b := v_tmp; END IF;
    IF v_b > v_c THEN v_tmp := v_b; v_b := v_c; v_c := v_tmp; END IF;
    IF v_a > v_b THEN v_tmp := v_a; v_a := v_b; v_b := v_tmp; END IF;

    -- Última ainda na janela de almoço → falta a saída final.
    IF v_c <= (13 * 60) THEN
      RETURN jsonb_build_object(
        'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
        'status', 'irregular', 'partial_reason', 'punches_impar', 'punch_count', v_count
      );
    END IF;

    IF v_b >= (12 * 60 + 30) THEN
      -- Faltou a saída do almoço. Intervalos: [p1 → 12:00] + [p2 → p3].
      v_lunch_out := LEAST(12 * 60, v_b);
      IF v_lunch_out > v_a THEN
        v_i1a := v_a; v_i1b := v_lunch_out;
        v_worked := v_worked + (v_i1b - v_i1a);
      END IF;
      v_i2a := v_b; v_i2b := v_c;
      IF v_i2b > v_i2a THEN v_worked := v_worked + (v_i2b - v_i2a); END IF;
    ELSE
      -- Faltou a volta do almoço. Intervalos: [p1 → p2] + [13:00 → p3].
      v_i1a := v_a; v_i1b := v_b;
      IF v_i1b > v_i1a THEN v_worked := v_worked + (v_i1b - v_i1a); END IF;
      IF v_c > (13 * 60) THEN
        v_i2a := 13 * 60; v_i2b := v_c;
        v_worked := v_worked + (v_i2b - v_i2a);
      END IF;
    END IF;

    -- Almoço mínimo de 1h em 12:00–14:00, dia longo que cruza o meio-dia.
    IF v_c > v_a AND v_a < (13 * 60) AND v_c > (13 * 60) AND (v_c - v_a) > 360 THEN
      v_on_shift := GREATEST(0, LEAST(v_c, 14 * 60) - GREATEST(v_a, 12 * 60));
      v_worked_win := 0;
      IF v_i1b >= v_i1a THEN
        v_worked_win := v_worked_win + GREATEST(0, LEAST(v_i1b, 14 * 60) - GREATEST(v_i1a, 12 * 60));
      END IF;
      IF v_i2b >= v_i2a THEN
        v_worked_win := v_worked_win + GREATEST(0, LEAST(v_i2b, 14 * 60) - GREATEST(v_i2a, 12 * 60));
      END IF;
      v_break := GREATEST(0, v_on_shift - v_worked_win);
      v_lunch_top := GREATEST(0, 60 - v_break);
      v_worked := GREATEST(0, v_worked - v_lunch_top);
    END IF;

    v_three_done := true;
    v_partial_reason := 'almoco_inferido';
  END IF;

  IF NOT v_three_done THEN
    IF v_count = 1 OR (v_count > 1 AND v_count % 2 <> 0) THEN
      RETURN jsonb_build_object(
        'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
        'status', 'irregular',
        'partial_reason', CASE WHEN v_count = 1 THEN 'somente_uma_batida' ELSE 'punches_impar' END,
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

    IF v_count = 2 AND p_has_lunch AND p_expected_min > 0 THEN
      BEGIN
        v_in  := regexp_replace((p_punches->0)::text, '[\\"*]', '', 'g')::time;
        v_out := regexp_replace((p_punches->1)::text, '[\\"*]', '', 'g')::time;
        v_pair := EXTRACT(EPOCH FROM (v_out - v_in))::int / 60;
        IF v_pair < 0 THEN v_pair := v_pair + 1440; END IF;
        v_worked := GREATEST(v_pair - v_lunch_default_min, 0);
        v_partial_reason := 'almoco_inferido';
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object(
          'worked_min', 0,
          'expected_min', p_expected_min,
          'overtime_min', 0,
          'status', 'irregular',
          'partial_reason', 'parse_falhou',
          'punch_count', v_count
        );
      END;
    ELSE
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
    END IF;
  END IF;

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
    CASE WHEN jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) = 2 THEN (
      (EXTRACT(HOUR FROM (tr.punches->>1)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>1)::time))
      - (EXTRACT(HOUR FROM (tr.punches->>0)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>0)::time))
      - CASE WHEN
          (EXTRACT(HOUR FROM (tr.punches->>0)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>0)::time)) <=
          (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60
            + EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time))
          AND
          (EXTRACT(HOUR FROM (tr.punches->>1)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>1)::time)) >=
          (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60
            + EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
        THEN
          (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60
            + EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
          - (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60
            + EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time))
        ELSE 0 END
    )::integer ELSE NULL END AS net_minutes_if_2,
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
    WHEN rwg.pc = 3 AND COALESCE(rwg.last_punch_min, 0) <= (13 * 60) THEN 'falta_saida_apos_almoco'
    WHEN rwg.pc = 5 THEN 'batida_extra'
    WHEN rwg.pc % 2 <> 0 THEN 'punches_impar'
    WHEN rwg.pc = 2
      AND EXTRACT(ISODOW FROM rwg.record_date)::integer BETWEEN 1 AND 5
      AND rwg.net_minutes_if_2 IS NOT NULL
      AND rwg.expected_min > 0
      AND rwg.net_minutes_if_2 < (rwg.expected_min * 0.75)::integer
      THEN 'dia_incompleto_suspeito'
    ELSE NULL
  END AS issue_type,
  EXISTS (
    SELECT 1 FROM public.time_record_manual_overrides o WHERE o.time_record_id = rwg.id
  ) AS has_manual_override,
  (rwg.employee_id IS NULL) AS employee_match_ambiguous
FROM records_with_gap rwg
WHERE rwg.pc > 0
  AND (
    (
      rwg.pc % 2 <> 0
      AND NOT (
        rwg.pc = 3
        AND COALESCE(rwg.last_punch_min, 0) > (13 * 60)
      )
    )
    OR (
      rwg.pc = 2
      AND EXTRACT(ISODOW FROM rwg.record_date)::integer BETWEEN 1 AND 5
      AND rwg.net_minutes_if_2 IS NOT NULL
      AND rwg.expected_min > 0
      AND rwg.net_minutes_if_2 < (rwg.expected_min * 0.75)::integer
    )
  );

REVOKE ALL ON TABLE public.v_pending_time_records FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.v_pending_time_records TO authenticated, service_role;

COMMENT ON VIEW public.v_pending_time_records IS
  'Pendências de batida e jornada curta por time_records.employee_id. n=3 com última batida depois das 13:00 sai da fila (saída real; falta só o almoço). FK nula é não resolvida e nunca escolhida por nome/crachá.';

COMMIT;
