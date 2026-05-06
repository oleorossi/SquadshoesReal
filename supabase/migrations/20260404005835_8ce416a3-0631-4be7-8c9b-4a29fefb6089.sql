
CREATE TABLE public.time_exceptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_name TEXT NOT NULL,
  employee_external_id TEXT,
  record_date DATE NOT NULL,
  type TEXT NOT NULL DEFAULT 'missing_entry',
  description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_to TEXT,
  resolution_notes TEXT,
  import_batch TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.time_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users full access to time_exceptions" ON public.time_exceptions;
CREATE POLICY "Allow authenticated users full access to time_exceptions"
  ON public.time_exceptions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
