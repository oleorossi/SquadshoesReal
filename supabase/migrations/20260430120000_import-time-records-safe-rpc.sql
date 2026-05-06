-- RPC that inserts time records using ON CONFLICT DO NOTHING at the DB level.
-- This is the only 100% reliable way to skip already-imported days without
-- triggering the unique constraint, regardless of how many rows exist in the DB.
CREATE OR REPLACE FUNCTION import_time_records_safe(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec        jsonb;
  ins_count  integer := 0;
  skp_count  integer := 0;
BEGIN
  FOR rec IN SELECT value FROM jsonb_array_elements(records)
  LOOP
    INSERT INTO time_records (
      employee_name,
      employee_external_id,
      department,
      record_date,
      punches,
      import_batch
    ) VALUES (
      rec->>'employee_name',
      rec->>'employee_external_id',
      rec->>'department',
      (rec->>'record_date')::date,
      ARRAY(SELECT jsonb_array_elements_text(rec->'punches')),
      rec->>'import_batch'
    )
    ON CONFLICT (employee_name, record_date) DO NOTHING;

    IF FOUND THEN
      ins_count := ins_count + 1;
    ELSE
      skp_count := skp_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', ins_count, 'skipped', skp_count);
END;
$$;

-- Grant to authenticated role so the Supabase client can call it
GRANT EXECUTE ON FUNCTION import_time_records_safe(jsonb) TO authenticated;
