CREATE TABLE IF NOT EXISTS public.time_import_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name TEXT NOT NULL,
  batch_id TEXT,
  start_date DATE,
  end_date DATE,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  total_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error_messages JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  imported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_import_logs_created_at ON public.time_import_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_import_logs_batch_id ON public.time_import_logs(batch_id);

ALTER TABLE public.time_import_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can view import logs" ON public.time_import_logs;
CREATE POLICY "Approved users can view import logs"
ON public.time_import_logs FOR SELECT TO authenticated
USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can insert import logs" ON public.time_import_logs;
CREATE POLICY "Approved users can insert import logs"
ON public.time_import_logs FOR INSERT TO authenticated
WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can delete import logs" ON public.time_import_logs;
CREATE POLICY "Approved users can delete import logs"
ON public.time_import_logs FOR DELETE TO authenticated
USING (public.is_approved_user());

CREATE OR REPLACE FUNCTION public.import_time_records_safe(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec        jsonb;
  ins_count  integer := 0;
  upd_count  integer := 0;
  emp_name   text;
  rec_date   date;
  existing_id uuid;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(records)
  LOOP
    emp_name := trim(rec->>'employee_name');
    rec_date := (rec->>'record_date')::date;

    SELECT id INTO existing_id
    FROM time_records
    WHERE employee_name = emp_name AND record_date = rec_date
    LIMIT 1;

    IF existing_id IS NULL THEN
      INSERT INTO time_records (
        employee_name, employee_external_id, department,
        record_date, punches, import_batch
      ) VALUES (
        emp_name,
        rec->>'employee_external_id',
        rec->>'department',
        rec_date,
        ARRAY(SELECT jsonb_array_elements_text(rec->'punches')),
        rec->>'import_batch'
      );
      ins_count := ins_count + 1;
    ELSE
      UPDATE time_records SET
        employee_external_id = COALESCE(rec->>'employee_external_id', employee_external_id),
        department = COALESCE(rec->>'department', department),
        punches = ARRAY(SELECT jsonb_array_elements_text(rec->'punches')),
        import_batch = rec->>'import_batch'
      WHERE id = existing_id;
      upd_count := upd_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', ins_count, 'updated', upd_count, 'skipped', 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_time_records_safe(jsonb) TO authenticated;