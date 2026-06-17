-- ─────────────────────────────────────────────────────────────────────────────
-- MOTOR ÚNICO DE PONTO — Fase 2b (lockstep SQL com o TS)
-- ─────────────────────────────────────────────────────────────────────────────
-- Decisão do usuário (2026-06-17): um motor só pra funcionários, relatórios que se
-- COMPLEMENTAM, convergindo TUDO na REGRA DA FOLHA (src/lib/hourlyPayroll.splitDayMinutes,
-- usada por src/lib/salaryPayroll/computePeriodFolha — a verdade do pagamento).
--
-- `calculate_day_summary` (base SQL do banco de horas / Espelho) passa a calcular
-- `worked_min` IGUAL ao TS (calculateDaySummary, que agora deriva do pontoEngine):
--   • SEM dedupe de 5min (a folha não dedupa);
--   • SEM desconto fixo de 1h de almoço em 2 batidas;
--   • almoço (1h) só é deduzido quando o dia é LONGO (>6h) e CRUZA O MEIO-DIA
--     (entrou antes das 13:00 e saiu depois), descontando dentro da janela 12:00–14:00
--     só o que faltar pra 1h — exatamente a regra `splitDayMinutes`.
--
-- Efeito: corrige o "almoço fantasma" que penalizava turnos parciais à tarde
-- (ex.: 13:08→18:00 dava 232; agora 292). A agregação (tolerância/mínimo/status/
-- overtime diário) e a assinatura da função ficam INALTERADAS.
--
-- HISTÓRICO: a FOLHA (pagamento) já usava esta regra → nenhuma folha/saldo PAGO muda.
-- O banco de horas é derivado ao vivo; daqui pra frente reflete a regra correta.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: elemento jsonb de batida ("08:00", "12:37*", etc.) → minutos do dia.
-- Tira tudo que não é dígito/':' (aspas, '*', '\') igual ao timeToMin do TS.
CREATE OR REPLACE FUNCTION public.punch_to_min(p jsonb)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(split_part(t, ':', 1), '')::int, 0) * 60
       + COALESCE(NULLIF(split_part(t, ':', 2), '')::int, 0)
  FROM (SELECT regexp_replace(p::text, '[^0-9:]', '', 'g') AS t) s;
$$;

CREATE OR REPLACE FUNCTION public.calculate_day_summary(
  p_punches jsonb,
  p_expected_min integer,
  p_tolerance_min integer,
  p_minimum_overtime integer,
  p_is_holiday boolean DEFAULT false,
  p_has_lunch boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
  v_count int;
  v_worked int := 0;
  v_worked_in_win int := 0;   -- minutos trabalhados dentro da janela de almoço 12–14
  v_idx int;
  v_a int; v_b int; v_pair int;
  v_first int; v_last int;
  v_on_shift_win int; v_break_win int; v_lunch int;
  v_diff int; v_status text;
  -- Constantes da regra splitDayMinutes:
  c_win_start CONSTANT int := 720;  -- 12:00
  c_win_end   CONSTANT int := 840;  -- 14:00
  c_cut       CONSTANT int := 780;  -- 13:00 (entrou antes / saiu depois)
  c_long      CONSTANT int := 360;  -- dia longo > 6h
  c_lunch     CONSTANT int := 60;   -- almoço padrão 1h
BEGIN
  IF p_punches IS NULL OR jsonb_typeof(p_punches) <> 'array' THEN
    v_count := 0;
  ELSE
    v_count := jsonb_array_length(p_punches);
  END IF;

  -- 1 batida ou nº ÍMPAR → INCONSISTENTE → PENDENTE (não soma horas).
  IF v_count = 1 OR (v_count > 1 AND v_count % 2 <> 0) THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'irregular',
      'partial_reason', CASE WHEN v_count = 1 THEN 'somente_uma_batida' ELSE 'punches_impar' END,
      'punch_count', v_count);
  END IF;

  -- Sem batidas → falta / fim de semana / feriado.
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

  -- Soma os pares reais (2 batidas = 1 par = jornada inteira) + acumula o que foi
  -- trabalhado dentro de 12–14 (pra saber quanta pausa de almoço já houve).
  v_idx := 0;
  WHILE v_idx < v_count - 1 LOOP
    BEGIN
      v_a := public.punch_to_min(p_punches->v_idx);
      v_b := public.punch_to_min(p_punches->(v_idx + 1));
      v_pair := v_b - v_a;
      IF v_pair < 0 THEN v_pair := v_pair + 1440; END IF;   -- turno noturno
      v_worked := v_worked + v_pair;
      IF v_b >= v_a THEN
        v_worked_in_win := v_worked_in_win
          + GREATEST(0, LEAST(v_b, c_win_end) - GREATEST(v_a, c_win_start));
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    v_idx := v_idx + 2;
  END LOOP;

  -- Almoço (1h) SÓ em dia longo que cruza o meio-dia (regra splitDayMinutes).
  -- Desconta dentro de 12–14 só o que faltar pra 1h de pausa.
  IF v_last > v_first AND v_first < c_cut AND v_last > c_cut AND (v_last - v_first) > c_long THEN
    v_on_shift_win := GREATEST(0, LEAST(v_last, c_win_end) - GREATEST(v_first, c_win_start));
    v_break_win := GREATEST(0, v_on_shift_win - v_worked_in_win);
    v_lunch := GREATEST(0, c_lunch - v_break_win);
    v_worked := GREATEST(0, v_worked - v_lunch);
  END IF;

  -- Agregação diária (tolerância/mínimo/status) — INALTERADA.
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
    'partial_reason', NULL,
    'punch_count', v_count);
END;
$function$;
