-- ============================================================================
-- AUDITORIA 2026-07-28 (M25): motor de dia TS × SQL divergiam e a aba
-- Pendências (v_time_pendings → calculate_day_summary) não mostrava o que a
-- Folha (TS splitDayMinutes) zera — e vice-versa:
--   • Batida DUPLA do relógio (<5 min, ex. 07:59 + 08:01 + 18:00): o TS via
--     3 batidas → dia pendente/0h (não pago); o SQL vivo também marcava
--     irregular. Regra unificada: DEDUPE <5 min nos DOIS motores → o dia é
--     pago e não vira pendência. (O TS ganhou o mesmo pré-passe em
--     src/lib/hourlyPayroll.ts nesta mesma auditoria.)
--   • Nº ÍMPAR ≥5 (batida EXTRA, ex. 08:00,12:00,13:00,17:00,18:00): o TS
--     calcula tratando a ÚLTIMA batida como SAÍDA (decisão do dono
--     2026-06-21); o SQL marcava irregular → pendência fantasma de dia que a
--     folha JÁ paga. Regra unificada: ímpar ≥5 calcula (span 1º→último);
--     só 1 ou 3 batidas viram 'irregular'.
-- Corpo base = definição VIVA no banco (motor único 2026-06-17: almoço só em
-- dia longo que cruza 12–14, janela c_win_*), NÃO as migrations
-- 20260721230000/280000 (corpos antigos com almoço inferido fixo — o banco
-- está à frente do repo nesse ponto). Este arquivo ordena DEPOIS delas, então
-- um replay completo também termina neste corpo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_day_summary(p_punches jsonb, p_expected_min integer, p_tolerance_min integer, p_minimum_overtime integer, p_is_holiday boolean DEFAULT false, p_has_lunch boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_count int;
  v_worked int := 0;
  v_worked_in_win int := 0;
  v_idx int;
  v_a int; v_b int; v_pair int;
  v_first int; v_last int;
  v_on_shift_win int; v_break_win int; v_lunch int;
  v_diff int; v_status text;
  v_partial_reason text := NULL;
  -- dedupe (<5 min, espelha o TS splitDayMinutes)
  v_clean jsonb := '[]'::jsonb;
  v_sorted jsonb;
  v_prev_min int := NULL;
  v_min int;
  i int;
  c_win_start CONSTANT int := 720;
  c_win_end   CONSTANT int := 840;
  c_cut       CONSTANT int := 780;
  c_long      CONSTANT int := 360;
  c_lunch     CONSTANT int := 60;
  c_dedupe    CONSTANT int := 5;
BEGIN
  -- Ordena numericamente ANTES de deduplicar/parear (paridade com o TS
  -- splitDayMinutes, que faz .sort()): o relógio pode entregar batidas fora de
  -- ordem e o pareamento por posição sairia trocado (Folha × Pendências
  -- divergiam no mesmo dia). punch_to_min devolve 0 pra batida ilegível (não
  -- lança) — seguro em ORDER BY.
  IF p_punches IS NOT NULL AND jsonb_typeof(p_punches) = 'array' AND jsonb_array_length(p_punches) > 0 THEN
    SELECT jsonb_agg(elem ORDER BY public.punch_to_min(elem))
      INTO v_sorted
      FROM jsonb_array_elements(p_punches) AS elem;
    p_punches := COALESCE(v_sorted, p_punches);
  END IF;

  -- Pré-passe (M25): batida DUPLA do relógio (<5 min da anterior BRUTA) é
  -- descartada, igual ao motor TS da folha. Compara sempre com a batida BRUTA
  -- anterior (não com a última mantida). [07:59,08:01,18:00] → [07:59,18:00].
  IF p_punches IS NOT NULL AND jsonb_typeof(p_punches) = 'array' THEN
    FOR i IN 0 .. jsonb_array_length(p_punches) - 1 LOOP
      BEGIN
        v_min := public.punch_to_min(p_punches->i);
        IF v_prev_min IS NULL OR ABS(v_min - v_prev_min) >= c_dedupe THEN
          v_clean := v_clean || jsonb_build_array(p_punches->i);
        END IF;
        v_prev_min := v_min;
      EXCEPTION WHEN OTHERS THEN
        v_clean := v_clean || jsonb_build_array(p_punches->i);
        v_prev_min := NULL;
      END;
    END LOOP;
    -- Se o dedupe transformou um conjunto PAR (≥4) em ÍMPAR, a batida "dupla"
    -- removida na verdade FECHAVA um par (ex.: [08,12,12:04,18] — 12:04 é a
    -- volta do almoço). Descartá-la zeraria um dia que a folha pagava certo →
    -- mantém o conjunto ORDENADO original (M25 review, 2026-07-28). O caso alvo
    -- do dedupe (repique tipo [07:59,08:01,18:00]) tem original ÍMPAR → não recai.
    IF jsonb_array_length(v_clean) % 2 = 1
       AND jsonb_array_length(p_punches) % 2 = 0
       AND jsonb_array_length(p_punches) >= 4 THEN
      NULL;  -- mantém p_punches (ordenado, sem dedupe)
    ELSE
      p_punches := v_clean;
    END IF;
  END IF;

  IF p_punches IS NULL OR jsonb_typeof(p_punches) <> 'array' THEN
    v_count := 0;
  ELSE
    v_count := jsonb_array_length(p_punches);
  END IF;

  -- Ímpar SÓ é irregular com 1 ou 3 batidas (não dá pra inferir a que falta).
  -- Ímpar ≥5 = batida EXTRA → calcula abaixo (última batida = saída), igual TS.
  IF v_count = 1 OR v_count = 3 THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'irregular',
      'partial_reason', CASE WHEN v_count = 1 THEN 'somente_uma_batida' ELSE 'punches_impar' END,
      'punch_count', v_count);
  END IF;

  IF v_count = 0 THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', CASE WHEN p_is_holiday THEN 'holiday'
                     WHEN p_expected_min = 0 THEN 'weekend'
                     ELSE 'absent' END,
      'partial_reason', NULL, 'punch_count', 0);
  END IF;

  BEGIN
    v_first := public.punch_to_min(p_punches->0);
    v_last  := public.punch_to_min(p_punches->(v_count - 1));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'irregular', 'partial_reason', 'parse_falhou', 'punch_count', v_count);
  END;

  IF v_count % 2 <> 0 THEN
    -- Ímpar ≥5 (batida EXTRA): última batida É a saída → span 1º→último
    -- (mesmo ramo do TS splitDayMinutes; o almoço sai no bloco 12–14 abaixo).
    v_pair := v_last - v_first;
    IF v_pair < 0 THEN v_pair := v_pair + 1440; END IF;
    v_worked := v_pair;
    IF v_last >= v_first THEN
      v_worked_in_win := GREATEST(0, LEAST(v_last, c_win_end) - GREATEST(v_first, c_win_start));
    END IF;
    v_partial_reason := 'batida_extra_ultima_saida';
  ELSE
    v_idx := 0;
    WHILE v_idx < v_count - 1 LOOP
      BEGIN
        v_a := public.punch_to_min(p_punches->v_idx);
        v_b := public.punch_to_min(p_punches->(v_idx + 1));
        v_pair := v_b - v_a;
        IF v_pair < 0 THEN v_pair := v_pair + 1440; END IF;
        v_worked := v_worked + v_pair;
        IF v_b >= v_a THEN
          v_worked_in_win := v_worked_in_win
            + GREATEST(0, LEAST(v_b, c_win_end) - GREATEST(v_a, c_win_start));
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      v_idx := v_idx + 2;
    END LOOP;
  END IF;

  IF v_last > v_first AND v_first < c_cut AND v_last > c_cut AND (v_last - v_first) > c_long THEN
    v_on_shift_win := GREATEST(0, LEAST(v_last, c_win_end) - GREATEST(v_first, c_win_start));
    v_break_win := GREATEST(0, v_on_shift_win - v_worked_in_win);
    v_lunch := GREATEST(0, c_lunch - v_break_win);
    v_worked := GREATEST(0, v_worked - v_lunch);
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
    'punch_count', v_count);
END;
$function$;
