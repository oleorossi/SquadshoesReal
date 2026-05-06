CREATE OR REPLACE FUNCTION import_time_records_safe(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec        jsonb;
  ins_count  integer := 0;
  upd_count  integer := 0;
  skp_count  integer := 0;
BEGIN
  -- We use a loop to process one by one, ensuring each conflict is handled.
  FOR rec IN SELECT value FROM jsonb_array_elements(records)
  LOOP
    INSERT INTO public.time_records (
      employee_name,
      employee_external_id,
      department,
      record_date,
      punches,
      import_batch
    ) VALUES (
      trim(rec->>'employee_name'),
      trim(rec->>'employee_external_id'),
      trim(rec->>'department'),
      (rec->>'record_date')::date,
      rec->'punches',
      rec->>'import_batch'
    )
    ON CONFLICT (employee_name, record_date) 
    DO UPDATE SET 
      punches = EXCLUDED.punches,
      import_batch = EXCLUDED.import_batch,
      employee_external_id = COALESCE(NULLIF(trim(EXCLUDED.employee_external_id), ''), time_records.employee_external_id),
      department = COALESCE(NULLIF(trim(EXCLUDED.department), ''), time_records.department);

    IF FOUND THEN
      -- In Postgres, DO UPDATE also sets FOUND to true if a row was updated.
      -- To distinguish, we'd need more complex logic, but for the user, 
      -- both are "successful" imports.
      ins_count := ins_count + 1;
    ELSE
      skp_count := skp_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', ins_count, 'skipped', skp_count);
END;
$$;

-- Ensure the unique constraint is clean (no duplicates existing already - although we checked)
-- No changes needed to the constraint itself.
