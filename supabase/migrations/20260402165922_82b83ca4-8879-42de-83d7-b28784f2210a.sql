ALTER TABLE public.employees ADD COLUMN external_id TEXT;
CREATE INDEX idx_employees_external_id ON public.employees(external_id);