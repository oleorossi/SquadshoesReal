-- =============================================================================
-- calculate_day_summary: inferir 1h de almoço quando só 2 batidas
-- =============================================================================
-- Problema (descoberto em 24/05/2026):
--   A regra adicionada em 21/05 (mig 20260521130000) zerava worked_min quando
--   o funcionário batia apenas entrada e saída (sem registrar o almoço). O
--   padrão da Squad Shoes é justamente esse — a grande maioria não bate o
--   almoço explicitamente, só ponto de entrada e saída.
--
--   Resultado: combinada com o PR1 (commit 55c41b5) que faz "parcial soma
--   expected mas NÃO worked", todos os dias de trabalho viraram débito
--   artificial. 14 funcionários acumulavam -150h a -240h em ~30 dias úteis,
--   sendo que TODOS trabalharam normalmente. Total de débito artificial no
--   sistema: ~2222h.
--
-- Correção:
--   Em vez de zerar, inferir intervalo de almoço de 60min (padrão da empresa,
--   conforme work_schedules.lunch_start/lunch_end de todos: 12h-13h) e
--   calcular: worked = (saída - entrada) - 60min.
--
--   Status fica 'normal' (não mais 'inconsistent') mas partial_reason
--   = 'almoco_inferido' permite UI destacar visualmente como "atenção, batidas
--   incompletas — RH ajuste se necessário".
--
-- Não afeta:
--   - 1 batida (irregular, continua zerando)
--   - 4+ batidas (almoço explícito, continua calculando direto)
--   - 0 batidas (absent/weekend/holiday, continua falta)
--   - 2 batidas em sábado/sem-almoço (continua somando pares direto)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_day_summary(
  p_punches          jsonb,
  p_expected_min     integer,
  p_tolerance_min    integer,
  p_minimum_overtime integer,
  p_is_holiday       boolean DEFAULT false,
  p_has_lunch        boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
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
BEGIN
  IF p_punches IS NULL OR jsonb_typeof(p_punches) <> 'array' THEN
    v_count := 0;
  ELSE
    v_count := jsonb_array_length(p_punches);
  END IF;

  -- Ímpar = IRREGULAR
  IF v_count = 1 OR (v_count > 1 AND v_count % 2 <> 0) THEN
    RETURN jsonb_build_object(
      'worked_min', 0, 'expected_min', p_expected_min, 'overtime_min', 0,
      'status', 'irregular',
      'partial_reason', CASE WHEN v_count = 1 THEN 'somente_uma_batida' ELSE 'punches_impar' END,
      'punch_count', v_count
    );
  END IF;

  -- Zero batidas = FALTA / DSR / FERIADO
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

  -- 2 batidas em dia útil com almoço esperado:
  -- Infere 60min de intervalo e calcula. Marca partial_reason pra UI saber
  -- que veio de inferência (mostrar alerta visual).
  IF v_count = 2 AND p_has_lunch AND p_expected_min > 0 THEN
    BEGIN
      v_in  := regexp_replace((p_punches->0)::text, '[\"*]', '', 'g')::time;
      v_out := regexp_replace((p_punches->1)::text, '[\"*]', '', 'g')::time;
      v_pair := EXTRACT(EPOCH FROM (v_out - v_in))::int / 60;
      IF v_pair < 0 THEN v_pair := v_pair + 1440; END IF;
      v_worked := GREATEST(v_pair - v_lunch_default_min, 0);
      v_partial_reason := 'almoco_inferido';
    EXCEPTION WHEN OTHERS THEN
      -- Se parse falhar, mantém comportamento conservador (zera)
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
    -- 4+ batidas par OU 2 batidas em sábado/sem-almoço = soma pares
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
  END IF;

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
    'partial_reason', v_partial_reason,
    'punch_count', v_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calculate_day_summary(jsonb, integer, integer, integer, boolean, boolean) TO authenticated;
