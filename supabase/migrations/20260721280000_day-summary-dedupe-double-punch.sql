-- ============================================================================
-- AUDITORIA HORAS 2026-06-09 (#19, rodada final): batida DUPLA do relógio
-- (ex.: 07:59 + 08:01) era deduplicada só no JS (useTimesheet, <5 min) — o
-- SQL contava o par fantasma de 2 min, mudando a contagem de pares do dia
-- (4 batidas → "normal" no SQL vs 2 → infer-lunch no JS) e o saldo.
-- Pré-passe de dedupe adicionado em calculate_day_summary (vale pra TODOS os
-- callers: calculate_employee_bank_balance v10, snapshot, espelho). Espelha
-- o JS: descarta batida a menos de 5 min da anterior (sem reordenar — a
-- ordem original preserva o tratamento de virada de meia-noite).
-- Restante do corpo = 20260721230000 (canônica infer-lunch), inalterado.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_day_summary(p_punches jsonb, p_expected_min integer, p_tolerance_min integer, p_minimum_overtime integer, p_is_holiday boolean DEFAULT false, p_has_lunch boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
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
  -- dedupe (<5 min, espelha o JS)
  v_clean jsonb := '[]'::jsonb;
  v_prev_min int := NULL;
  v_t time;
  v_min int;
  i int;
BEGIN
  -- Pré-passe: remove batida dupla do relógio (<5 min da anterior)
  IF p_punches IS NOT NULL AND jsonb_typeof(p_punches) = 'array' THEN
    FOR i IN 0 .. jsonb_array_length(p_punches) - 1 LOOP
      BEGIN
        v_t := regexp_replace((p_punches->i)::text, '[\\"*]', '', 'g')::time;
        v_min := (EXTRACT(HOUR FROM v_t)::int * 60) + EXTRACT(MINUTE FROM v_t)::int;
        IF v_prev_min IS NULL OR ABS(v_min - v_prev_min) >= 5 THEN
          v_clean := v_clean || jsonb_build_array(p_punches->i);
        END IF;
        v_prev_min := v_min;  -- compara sempre com a batida BRUTA anterior (igual ao JS)
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
