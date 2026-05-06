ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS overtime_hourly_rate NUMERIC DEFAULT NULL;