-- =============================================================================
-- Padrão de batidas por funcionário + sugestões automáticas nas pendências
-- =============================================================================
-- Objetivo: quando RH abre uma pendência (parcial/inconsistente/irregular),
-- já mostrar batida sugerida baseada em:
--   (a) Padrão observado — mediana das batidas válidas dos últimos 60 dias
--   (b) Schedule oficial — fallback quando observado tem < 5 dias
--
-- Decisão de produto:
--   * Observado >= 15 dias  -> confidence='high'
--   * Observado 5..14 dias  -> confidence='medium'
--   * Observado < 5 dias    -> confidence='low' + source='schedule'
--
-- A função preserva batidas reais existentes; só preenche os buracos por shape:
--   0 batidas -> padrão completo + flag pra cadastrar ausência
--   1 batida  -> [batida, lunch_start, lunch_end, exit] do padrão
--   2 batidas -> [entrada, lunch_start, lunch_end, saida] - injeta almoço entre as 2
--   3 batidas -> [b1, b2, b3, exit do padrão] - injeta saída final
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- VIEW v_employee_punch_pattern
-- Por employee: mediana de 1ª/2ª/3ª/4ª batida dos últimos 60 dias úteis
-- considerando só dias com EXATAMENTE 4 batidas válidas (HH:MM, ordem ASC).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_employee_punch_pattern AS
WITH valid_days AS (
  SELECT
    e.id AS employee_id,
    e.name AS employee_name,
    e.external_id,
    tr.record_date,
    (tr.punches->>0)::time AS p1,
    (tr.punches->>1)::time AS p2,
    (tr.punches->>2)::time AS p3,
    (tr.punches->>3)::time AS p4
  FROM public.time_records tr
  JOIN public.employees e
    ON e.external_id = tr.employee_external_id
   AND e.external_id IS NOT NULL
   AND e.external_id <> ''
  WHERE tr.record_date >= CURRENT_DATE - INTERVAL '60 days'
    AND tr.record_date >= public.get_bank_hours_cutoff()
    AND jsonb_array_length(tr.punches) = 4
    AND EXTRACT(isodow FROM tr.record_date) BETWEEN 1 AND 5
    -- Filtro defensivo: cada batida deve ser HH:MM válido
    AND (tr.punches->>0) ~ '^[0-2][0-9]:[0-5][0-9]$'
    AND (tr.punches->>1) ~ '^[0-2][0-9]:[0-5][0-9]$'
    AND (tr.punches->>2) ~ '^[0-2][0-9]:[0-5][0-9]$'
    AND (tr.punches->>3) ~ '^[0-2][0-9]:[0-5][0-9]$'
    -- Ordem crescente (descarta dias bizarros tipo 18:00 antes de 08:00)
    AND (tr.punches->>0)::time < (tr.punches->>1)::time
    AND (tr.punches->>1)::time < (tr.punches->>2)::time
    AND (tr.punches->>2)::time < (tr.punches->>3)::time
),
medians AS (
  SELECT
    employee_id,
    employee_name,
    external_id,
    COUNT(*) AS observed_days,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY p1) AS entry_observed,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY p2) AS lunch_start_observed,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY p3) AS lunch_end_observed,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY p4) AS exit_observed
  FROM valid_days
  GROUP BY employee_id, employee_name, external_id
)
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  e.external_id,
  e.department,
  COALESCE(m.observed_days, 0) AS observed_days,
  m.entry_observed,
  m.lunch_start_observed,
  m.lunch_end_observed,
  m.exit_observed,
  ws.entry_time AS entry_schedule,
  ws.lunch_start AS lunch_start_schedule,
  ws.lunch_end AS lunch_end_schedule,
  ws.exit_time AS exit_schedule,
  COALESCE(ws.tolerance_minutes, 10) AS tolerance_minutes
FROM public.employees e
LEFT JOIN medians m ON m.employee_id = e.id
LEFT JOIN public.work_schedules ws
  ON ws.id = e.work_schedule_id
  OR (e.work_schedule_id IS NULL AND ws.is_default = true)
WHERE e.active = true;

COMMENT ON VIEW public.v_employee_punch_pattern IS
  'Padrão de batidas por funcionário: mediana das 4 batidas dos últimos 60 dias úteis com 4 batidas válidas + schedule oficial pra fallback.';

GRANT SELECT ON public.v_employee_punch_pattern TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION suggest_punches_for_record(time_record_id)
-- Retorna jsonb { suggested[], source, confidence, reason, missing_count,
--                 observed_days, pattern{observed[], schedule[]} }
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.suggest_punches_for_record(p_time_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_rec        record;
  v_pattern    record;
  v_existing   text[];
  v_n          int;
  v_p1         text;
  v_p2         text;
  v_p3         text;
  v_p4         text;
  v_suggested  text[];
  v_source     text;
  v_confidence text;
  v_reason     text;
  v_is_absent  boolean := false;
  v_obs_array  jsonb;
  v_sch_array  jsonb;
BEGIN
  -- 1. Buscar o registro
  SELECT
    tr.id,
    tr.employee_external_id,
    tr.employee_name,
    tr.record_date,
    tr.punches,
    e.id AS employee_id
  INTO v_rec
  FROM public.time_records tr
  LEFT JOIN public.employees e
    ON e.external_id = tr.employee_external_id
   AND e.external_id IS NOT NULL
   AND e.external_id <> ''
  WHERE tr.id = p_time_record_id;

  IF v_rec.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_existing := ARRAY(SELECT jsonb_array_elements_text(v_rec.punches));
  v_n := COALESCE(array_length(v_existing, 1), 0);

  -- 2. Padrão
  SELECT * INTO v_pattern
  FROM public.v_employee_punch_pattern
  WHERE employee_id = v_rec.employee_id;

  -- 3. Detectar ausência justificada cobrindo o dia
  IF v_rec.employee_id IS NOT NULL THEN
    v_is_absent := public.is_employee_absent_on(v_rec.employee_id, v_rec.record_date);
  END IF;

  -- 4. Escolher source/confidence
  IF v_pattern.observed_days >= 5 THEN
    v_source := 'observed';
    v_confidence := CASE WHEN v_pattern.observed_days >= 15 THEN 'high' ELSE 'medium' END;
    v_p1 := to_char(v_pattern.entry_observed, 'HH24:MI');
    v_p2 := to_char(v_pattern.lunch_start_observed, 'HH24:MI');
    v_p3 := to_char(v_pattern.lunch_end_observed, 'HH24:MI');
    v_p4 := to_char(v_pattern.exit_observed, 'HH24:MI');
  ELSIF v_pattern.entry_schedule IS NOT NULL THEN
    v_source := 'schedule';
    v_confidence := 'low';
    v_p1 := to_char(v_pattern.entry_schedule, 'HH24:MI');
    v_p2 := to_char(v_pattern.lunch_start_schedule, 'HH24:MI');
    v_p3 := to_char(v_pattern.lunch_end_schedule, 'HH24:MI');
    v_p4 := to_char(v_pattern.exit_schedule, 'HH24:MI');
  ELSE
    -- Sem padrão observado nem schedule — não dá pra sugerir
    RETURN jsonb_build_object(
      'suggested', '[]'::jsonb,
      'source', 'none',
      'confidence', 'none',
      'reason', 'Funcionário sem schedule cadastrado e sem histórico suficiente — não dá pra sugerir.',
      'missing_count', GREATEST(0, 4 - v_n),
      'observed_days', COALESCE(v_pattern.observed_days, 0),
      'is_absent_covered', v_is_absent
    );
  END IF;

  -- 5. Detectar gap por shape
  IF v_n = 0 THEN
    v_suggested := ARRAY[v_p1, v_p2, v_p3, v_p4];
    v_reason := CASE
      WHEN v_is_absent
      THEN 'Dia vazio mas COBERTO por ausência justificada — não complete batidas, isenção já aplicada.'
      ELSE 'Dia vazio — verifique se é ausência justificada antes de aplicar. Se foi trabalhado, padrão completo abaixo.'
    END;
  ELSIF v_n = 1 THEN
    v_suggested := ARRAY[v_existing[1], v_p2, v_p3, v_p4];
    v_reason := 'Só 1 batida registrada — faltam saída p/ almoço, retorno e saída final.';
  ELSIF v_n = 2 THEN
    -- 2 batidas: entrada + saída final → inserir almoço no meio
    v_suggested := ARRAY[v_existing[1], v_p2, v_p3, v_existing[2]];
    v_reason := 'Faltou marcar entrada/saída do almoço — sugestão preserva sua entrada e saída reais.';
  ELSIF v_n = 3 THEN
    v_suggested := ARRAY[v_existing[1], v_existing[2], v_existing[3], v_p4];
    v_reason := 'Faltou marcar a saída final — sugestão preserva as 3 batidas reais.';
  ELSE
    -- 4+ batidas: retorna as existentes (provavelmente está irregular por outro motivo)
    v_suggested := v_existing;
    v_reason := 'Já existem 4+ batidas — revise se há horários inválidos ou desordenados.';
  END IF;

  -- 6. Montar arrays do padrão para o frontend exibir
  v_obs_array := CASE
    WHEN v_pattern.observed_days >= 5 THEN jsonb_build_array(
      to_char(v_pattern.entry_observed, 'HH24:MI'),
      to_char(v_pattern.lunch_start_observed, 'HH24:MI'),
      to_char(v_pattern.lunch_end_observed, 'HH24:MI'),
      to_char(v_pattern.exit_observed, 'HH24:MI')
    )
    ELSE NULL
  END;
  v_sch_array := CASE
    WHEN v_pattern.entry_schedule IS NOT NULL THEN jsonb_build_array(
      to_char(v_pattern.entry_schedule, 'HH24:MI'),
      to_char(v_pattern.lunch_start_schedule, 'HH24:MI'),
      to_char(v_pattern.lunch_end_schedule, 'HH24:MI'),
      to_char(v_pattern.exit_schedule, 'HH24:MI')
    )
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'suggested', to_jsonb(v_suggested),
    'source', v_source,
    'confidence', v_confidence,
    'reason', v_reason,
    'missing_count', GREATEST(0, 4 - v_n),
    'observed_days', COALESCE(v_pattern.observed_days, 0),
    'is_absent_covered', v_is_absent,
    'pattern', jsonb_build_object(
      'observed', v_obs_array,
      'schedule', v_sch_array
    )
  );
END;
$fn$;

COMMENT ON FUNCTION public.suggest_punches_for_record(uuid) IS
  'Sugere completar batidas de um time_record baseado no padrão observado (60d) com fallback pro schedule. Preserva batidas reais existentes, só preenche buracos por shape.';

GRANT EXECUTE ON FUNCTION public.suggest_punches_for_record(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- VIEW v_time_pendings — adiciona suggestion inline
-- (recria mantendo todos os campos existentes + suggestion jsonb)
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_time_pendings;
CREATE VIEW public.v_time_pendings AS
SELECT
  tr.id,
  tr.employee_external_id,
  tr.employee_name,
  e.id AS employee_id,
  e.department,
  tr.record_date,
  tr.punches,
  jsonb_array_length(tr.punches) AS punches_count,
  EXTRACT(isodow FROM tr.record_date)::integer AS dow,
  (CURRENT_DATE - tr.record_date) AS days_since,
  public.calculate_day_summary(
    tr.punches,
    COALESCE(public.get_employee_expected_minutes(e.id, tr.record_date), 0),
    COALESCE(ws.tolerance_minutes, 10),
    COALESCE(ws.minimum_overtime_minutes, 10),
    EXISTS (
      SELECT 1 FROM public.holidays h
      WHERE h.holiday_date = tr.record_date AND COALESCE(h.optional, false) = false
    ),
    EXTRACT(isodow FROM tr.record_date)::integer BETWEEN 1 AND 5
  ) AS day_summary,
  CASE
    WHEN (CURRENT_DATE - tr.record_date) > 7 THEN 'overdue'
    WHEN (CURRENT_DATE - tr.record_date) > 3 THEN 'aging'
    ELSE 'fresh'
  END AS urgency,
  public.suggest_punches_for_record(tr.id) AS suggestion
FROM public.time_records tr
LEFT JOIN public.employees e
  ON (e.external_id = tr.employee_external_id
      AND e.external_id IS NOT NULL
      AND e.external_id <> '')
  OR lower(trim(e.name)) = lower(trim(tr.employee_name))
LEFT JOIN public.work_schedules ws
  ON ws.id = e.work_schedule_id
  OR (e.work_schedule_id IS NULL AND ws.is_default = true)
WHERE tr.record_date >= public.get_bank_hours_cutoff()
  AND tr.record_date >= CURRENT_DATE - INTERVAL '90 days'
  AND EXTRACT(isodow FROM tr.record_date) BETWEEN 1 AND 5
  AND NOT EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE h.holiday_date = tr.record_date AND COALESCE(h.optional, false) = false
  );

COMMENT ON VIEW public.v_time_pendings IS
  'Pendências de ponto (últimos 90d úteis pós-cutoff) com sugestão de completar via padrão observado/schedule do funcionário.';

GRANT SELECT ON public.v_time_pendings TO authenticated;
