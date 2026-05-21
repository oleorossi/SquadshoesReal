-- Status granular do dia: distinguir INCONSISTENTE (esqueceu almoço) vs IRREGULAR
-- (falha do relógio, batidas ímpares), conforme planejamento Portaria 671.
--
-- Antes: calculate_day_summary retornava 'partial' genérico em qualquer batida
-- ímpar ou só 1 batida. RH não conseguia distinguir "esqueceu de bater almoço"
-- (2 batidas) de "relógio falhou" (1 ou 3 batidas) — eram tratados igual.
--
-- Agora:
--   v_count=0 + expected>0 → 'absent'         (Falta)
--   v_count=0 + expected=0 → 'weekend'        (Domingo) ou 'holiday'
--   v_count=1              → 'irregular'      (Falha relógio — só 1 batida)
--   v_count par + has_lunch=true E expected ≥ tolerância almoço → 'inconsistent'
--   v_count ímpar (≥3)     → 'irregular'      (Falha relógio — quantidade ímpar)
--   v_count par ≥ 4        → 'normal'         (Dia bom)
--   v_count par = 2 em jornada contínua (sábado/turno sem almoço) → 'normal'
--
-- Param novo p_has_lunch (default TRUE): caller passa FALSE em jornada contínua
-- (sábado, turno noite sem intervalo, etc.). DEFAULT mantém retro-compat com
-- callers que não passam — assumem jornada com almoço.

DROP FUNCTION IF EXISTS public.calculate_day_summary(jsonb, integer, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.calculate_day_summary(jsonb, integer, integer, integer, boolean, boolean);

CREATE OR REPLACE FUNCTION public.calculate_day_summary(
  p_punches            jsonb,
  p_expected_min       int,
  p_tolerance_min      int,
  p_minimum_overtime   int,
  p_is_holiday         boolean DEFAULT false,
  p_has_lunch          boolean DEFAULT true
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

  -- IRREGULAR: 1 batida ou quantidade ímpar (≥3). Falha do relógio.
  IF v_count = 1 OR (v_count > 1 AND v_count % 2 <> 0) THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'irregular',
      'partial_reason', CASE WHEN v_count = 1 THEN 'somente_uma_batida' ELSE 'punches_impar' END,
      'punch_count', v_count
    );
  END IF;

  -- AUSÊNCIA: 0 batidas
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

  -- INCONSISTENTE: par = 2 batidas em dia que TEM almoço previsto.
  -- Sábado contínuo (p_has_lunch=false): 2 batidas é normal — não cai aqui.
  -- Dia útil com p_has_lunch=true: 2 batidas significa esqueceu o almoço.
  IF v_count = 2 AND p_has_lunch AND p_expected_min > 0 THEN
    -- Calcula mesmo assim pra dar transparência, mas marca status='inconsistent'
    BEGIN
      v_in  := regexp_replace((p_punches->0)::text, '[\"*]', '', 'g')::time;
      v_out := regexp_replace((p_punches->1)::text, '[\"*]', '', 'g')::time;
      v_pair := EXTRACT(EPOCH FROM (v_out - v_in))::int / 60;
      IF v_pair < 0 THEN v_pair := v_pair + 1440; END IF;
      v_worked := v_pair;
    EXCEPTION WHEN OTHERS THEN v_worked := 0;
    END;
    RETURN jsonb_build_object(
      'worked_min', v_worked, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'inconsistent',
      'partial_reason', 'esqueceu_almoco',
      'punch_count', v_count
    );
  END IF;

  -- NORMAL: par ≥ 4 ou (par = 2 sem almoço previsto)
  v_idx := 0;
  WHILE v_idx < v_count - 1 LOOP
    BEGIN
      v_in  := regexp_replace((p_punches->v_idx)::text,        '[\"*]', '', 'g')::time;
      v_out := regexp_replace((p_punches->(v_idx+1))::text,    '[\"*]', '', 'g')::time;
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

GRANT EXECUTE ON FUNCTION public.calculate_day_summary(jsonb, integer, integer, integer, boolean, boolean) TO authenticated;
