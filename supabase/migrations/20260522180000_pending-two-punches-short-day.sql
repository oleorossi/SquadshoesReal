-- ============================================================================
-- Pendências: detectar dia útil com 2 batidas e jornada anormalmente curta
-- ============================================================================
-- Bug raiz (relatado em 22/05/2026): funcionário registrava 2 batidas em
-- dia útil tipo 08:16 e 13:13. O sistema interpretava como "entrou de
-- manhã e saiu antes do almoço passar", deduzia 60min de almoço e mostrava
-- 03:57 trabalhado silenciosamente. O gestor não tinha como saber que
-- aquele dia precisava de revisão.
--
-- Fix: a view v_pending_time_records agora também pega os casos onde há
-- 2 batidas em dia útil E a jornada líquida (após deduzir almoço se as
-- batidas atravessam o almoço) é < 75% do esperado. Esses são flagged
-- como issue_type='dia_incompleto_suspeito' e aparecem em Pendências.
--
-- Decisão de design: usamos schedule "default" pra calcular o expected.
-- Não tentamos resolver work_schedule individual por funcionário aqui
-- (complexo + caro pra view SQL); o frontend tem sua própria detecção
-- mais precisa em calculateDaySummary (espelha essa lógica).
-- ============================================================================

DROP VIEW IF EXISTS public.v_pending_time_records CASCADE;

CREATE OR REPLACE VIEW public.v_pending_time_records
WITH (security_invoker = true) AS
WITH default_sched AS (
  SELECT * FROM public.work_schedules
  WHERE is_default = true
  LIMIT 1
),
records_with_gap AS (
  SELECT
    tr.*,
    jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) AS pc,
    -- Para o caso 2-batidas suspeito, calcula gap líquido em minutos:
    -- se ambas as batidas atravessam o almoço (default 12:00-13:00),
    -- deduz 60min; senão usa gap bruto.
    CASE WHEN jsonb_array_length(COALESCE(tr.punches,'[]'::jsonb)) = 2 THEN
      (
        -- minutos entre as 2 batidas
        (
          EXTRACT(HOUR FROM (tr.punches->>1)::time) * 60 +
          EXTRACT(MINUTE FROM (tr.punches->>1)::time)
        ) -
        (
          EXTRACT(HOUR FROM (tr.punches->>0)::time) * 60 +
          EXTRACT(MINUTE FROM (tr.punches->>0)::time)
        )
        -
        -- Se atravessou o almoço, deduz a duração do intervalo
        CASE WHEN
          (EXTRACT(HOUR FROM (tr.punches->>0)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>0)::time)) <=
            (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60 +
             EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time))
          AND
          (EXTRACT(HOUR FROM (tr.punches->>1)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>1)::time)) >=
            (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60 +
             EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
        THEN
          (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60 +
           EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
          -
          (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60 +
           EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time))
        ELSE 0 END
      )::int
    ELSE NULL END AS net_minutes_if_2,
    -- Expected daily minutes do schedule default (entrada→almoço + volta→saída)
    (
      (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60 +
       EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time)) -
      (EXTRACT(HOUR FROM (SELECT entry_time FROM default_sched)::time) * 60 +
       EXTRACT(MINUTE FROM (SELECT entry_time FROM default_sched)::time))
      +
      (EXTRACT(HOUR FROM (SELECT exit_time FROM default_sched)::time) * 60 +
       EXTRACT(MINUTE FROM (SELECT exit_time FROM default_sched)::time)) -
      (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60 +
       EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
    )::int AS expected_min
  FROM public.time_records tr
)
SELECT
  rwg.id AS time_record_id,
  rwg.employee_name,
  rwg.employee_external_id,
  e.id AS employee_id,
  rwg.department,
  rwg.record_date,
  EXTRACT(ISODOW FROM rwg.record_date)::int AS dow,
  rwg.punches,
  rwg.pc AS punch_count,
  CASE
    WHEN rwg.pc = 1 THEN 'somente_uma_batida'
    WHEN rwg.pc = 3 THEN 'falta_saida_apos_almoco'
    WHEN rwg.pc = 5 THEN 'batida_extra'
    WHEN rwg.pc % 2 != 0 THEN 'punches_impar'
    WHEN rwg.pc = 2
      AND EXTRACT(ISODOW FROM rwg.record_date)::int BETWEEN 1 AND 5
      AND rwg.net_minutes_if_2 IS NOT NULL
      AND rwg.expected_min > 0
      AND rwg.net_minutes_if_2 < (rwg.expected_min * 0.75)::int
      THEN 'dia_incompleto_suspeito'
    ELSE NULL
  END AS issue_type,
  EXISTS (
    SELECT 1 FROM public.time_record_manual_overrides o WHERE o.time_record_id = rwg.id
  ) AS has_manual_override
FROM records_with_gap rwg
LEFT JOIN public.employees e
  ON (rwg.employee_external_id = e.external_id
   OR LOWER(TRIM(rwg.employee_name)) = LOWER(TRIM(e.name)))
WHERE rwg.pc > 0
  AND (
    rwg.pc % 2 != 0  -- ímpar (1, 3, 5, 7...)
    OR (
      -- 2 batidas em dia útil com jornada anormalmente curta
      rwg.pc = 2
      AND EXTRACT(ISODOW FROM rwg.record_date)::int BETWEEN 1 AND 5
      AND rwg.net_minutes_if_2 IS NOT NULL
      AND rwg.expected_min > 0
      AND rwg.net_minutes_if_2 < (rwg.expected_min * 0.75)::int
    )
  );

GRANT SELECT ON public.v_pending_time_records TO authenticated;

-- Atualizar v_employee_pending_summary pra incluir o novo issue type
DROP VIEW IF EXISTS public.v_employee_pending_summary CASCADE;

CREATE OR REPLACE VIEW public.v_employee_pending_summary
WITH (security_invoker = true) AS
SELECT
  e.id AS employee_id,
  e.name,
  e.department,
  COUNT(p.time_record_id) AS pending_count,
  MIN(p.record_date) AS oldest_pending,
  MAX(p.record_date) AS newest_pending,
  COUNT(*) FILTER (WHERE p.issue_type = 'somente_uma_batida') AS only_one_punch,
  COUNT(*) FILTER (WHERE p.issue_type = 'falta_saida_apos_almoco') AS missing_exit,
  COUNT(*) FILTER (WHERE p.issue_type = 'batida_extra') AS extra_punch,
  COUNT(*) FILTER (WHERE p.issue_type = 'dia_incompleto_suspeito') AS suspicious_short_day
FROM public.employees e
LEFT JOIN public.v_pending_time_records p ON p.employee_id = e.id
WHERE e.active = true
GROUP BY e.id, e.name, e.department;

GRANT SELECT ON public.v_employee_pending_summary TO authenticated;

COMMENT ON VIEW public.v_pending_time_records IS
  'Pendências de ponto: dias com batidas ímpares OU 2 batidas em dia útil com jornada anormalmente curta (< 75% do esperado, sugere falta de batida).';

COMMENT ON VIEW public.v_employee_pending_summary IS
  'Resumo de pendências por funcionário ativo. Inclui suspicious_short_day desde 22/05/2026.';
