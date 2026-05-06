CREATE OR REPLACE FUNCTION public.get_distinct_batches()
RETURNS TABLE(import_batch text) 
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT t.import_batch 
  FROM time_records t 
  WHERE t.import_batch IS NOT NULL 
  ORDER BY t.import_batch DESC;
$$;

CREATE INDEX IF NOT EXISTS idx_time_records_import_batch ON public.time_records (import_batch);
CREATE INDEX IF NOT EXISTS idx_time_records_employee_date ON public.time_records (employee_name, record_date);
CREATE INDEX IF NOT EXISTS idx_time_records_batch_date ON public.time_records (import_batch, record_date);
CREATE INDEX IF NOT EXISTS idx_time_records_date_range ON public.time_records (record_date);
CREATE INDEX IF NOT EXISTS idx_employees_name ON public.employees (name);
CREATE INDEX IF NOT EXISTS idx_employee_advances_employee ON public.employee_advances (employee_id, advance_date DESC);