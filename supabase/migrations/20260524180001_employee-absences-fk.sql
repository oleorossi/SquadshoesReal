-- =============================================================================
-- FK employee_absences.employee_id -> employees.id
-- =============================================================================
-- A tabela legacy employee_absences nasceu sem FK declarada — PostgREST não
-- conseguia resolver `select('*, employees(...)')`, falhando com:
--   "Could not find a relationship between 'employee_absences' and 'employees'"
--
-- Tabela está VAZIA em prod no momento desta migration (verificado em 2026-05-24),
-- então a constraint pode ser criada direto sem cleanup.
-- ON DELETE CASCADE: ausências de funcionário deletado vão junto (não fazem
-- sentido orfãs, e funcionário só é deletado em fluxo administrativo raro).
-- =============================================================================

ALTER TABLE public.employee_absences
  ADD CONSTRAINT employee_absences_employee_id_fkey
  FOREIGN KEY (employee_id)
  REFERENCES public.employees(id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_employee_absences_employee_id
  ON public.employee_absences(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_absences_dates
  ON public.employee_absences(employee_id, start_date, end_date);

NOTIFY pgrst, 'reload schema';
