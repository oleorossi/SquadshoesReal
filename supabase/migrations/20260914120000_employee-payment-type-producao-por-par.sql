-- employees: regime "por par" (piece-rate) — pagamento por par produzido
-- ============================================================================
-- Alguns funcionários (montadores/soladores) ganham por PAR produzido, não por
-- salário/hora. A folha desses funcionários soma os pares apontados na Ficha de
-- Montadores (ficha_montadores, origem='chamada') valorados por dificuldade
-- (médio/difícil), IGNORANDO salário e ponto. O relógio de ponto deles é só
-- presença. Ver specs/funcionarios-pagamento-por-par.md.
--
-- (1) payment_type ganha 'producao' na CHECK (hoje: mensalista/diarista/remoto).
-- (2) valor_par_medio / valor_par_dificil = R$/par por dificuldade no CADASTRO
--     (fonte única). Cada apontamento da Ficha guarda o valor da época (snapshot
--     em ficha_montadores.valor_par_medio/_dificil, colunas que já existem).
-- (3) Pendências de ponto (view v_time_pendings → badge e lista) NÃO contam quem
--     é 'producao': o relógio dele não gera falta/atraso.
-- Idempotente.
-- ============================================================================

-- (1) regime 'producao'
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_payment_type_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_payment_type_check
  CHECK (payment_type IS NULL OR payment_type = ANY (ARRAY['mensalista'::text, 'diarista'::text, 'remoto'::text, 'producao'::text]));

-- (2) R$/par por dificuldade no cadastro (fonte única; congelado no apontamento)
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS valor_par_medio numeric;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS valor_par_dificil numeric;
COMMENT ON COLUMN public.employees.valor_par_medio IS 'R$/par (dificuldade média) quando payment_type=producao. Snapshot em ficha_montadores.valor_par_medio no apontamento.';
COMMENT ON COLUMN public.employees.valor_par_dificil IS 'R$/par (dificuldade difícil) quando payment_type=producao. Snapshot em ficha_montadores.valor_par_dificil no apontamento.';

-- (3) v_time_pendings idêntica à definição vigente (20260524170000) + filtro que
--     exclui funcionário por par. Badge (get_pending_count_by_employee) e lista
--     (useTimePendings) leem desta view, então os dois passam a ignorar 'producao'.
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
  -- Funcionário por par (piece-rate): relógio é só presença, não gera pendência.
  AND COALESCE(e.payment_type, 'mensalista') <> 'producao'
  AND NOT EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE h.holiday_date = tr.record_date AND COALESCE(h.optional, false) = false
  );

GRANT SELECT ON public.v_time_pendings TO authenticated;
