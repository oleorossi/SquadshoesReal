-- Link each employee to a specific work schedule.
-- When set, the employee's own schedule is used for OT/deficit calculations
-- instead of the global default schedule.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS work_schedule_id UUID REFERENCES public.work_schedules(id) ON DELETE SET NULL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_work_schedule_id ON public.employees(work_schedule_id);

COMMENT ON COLUMN public.employees.work_schedule_id IS
  'Optional link to a specific work schedule. Falls back to is_default schedule when NULL.';
