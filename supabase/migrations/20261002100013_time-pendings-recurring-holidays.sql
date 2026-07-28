-- ============================================================================
-- AUDITORIA 2026-07-28 (M28): feriado `recurring` só valia nas telas de Ponto.
-- O quick-add de feriados nacionais grava com ano fixo E recurring=true; a view
-- v_time_pendings (badge + aba Pendências) comparava a data LITERAL
-- (h.holiday_date = tr.record_date) — no ano seguinte ao cadastro o feriado
-- deixava de ser reconhecido e o dia aparecia como pendência/falta indevida.
-- Frontend correspondente: helper único `buildHolidaySet` (src/lib/holidays.ts)
-- aplicado em Folha, Relatórios de Atrasos/Faltas, absenteísmo e Espelho.
--
-- Mudança: as DUAS checagens de feriado da view passam a casar também o MM-DD
-- de feriados recorrentes (mantendo o filtro de obrigatório: optional=false).
-- Corpo base = 20260914120000 (exclusão do regime 'producao' preservada).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_time_pendings AS
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
      WHERE COALESCE(h.optional, false) = false
        AND (h.holiday_date = tr.record_date
             OR (COALESCE(h.recurring, false)
                 AND to_char(h.holiday_date, 'MM-DD') = to_char(tr.record_date, 'MM-DD')))
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
  -- Funcionário por par (piece-rate): relógio é só presença, não gera pendência.
  AND COALESCE(e.payment_type, 'mensalista') <> 'producao'
  AND NOT EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE COALESCE(h.optional, false) = false
      AND (h.holiday_date = tr.record_date
           OR (COALESCE(h.recurring, false)
               AND to_char(h.holiday_date, 'MM-DD') = to_char(tr.record_date, 'MM-DD')))
  );

GRANT SELECT ON public.v_time_pendings TO authenticated;
