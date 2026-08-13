-- Ponto PJ: a chave de importação é o ID do relógio + data, nunca o nome curto
-- do equipamento. O ID pode ser reciclado entre pessoas, mas a vigência é
-- resolvida na aplicação/relatórios antes de qualquer cálculo financeiro.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY COALESCE(NULLIF(btrim(employee_external_id), ''), 'nome:' || btrim(employee_name)), record_date
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.time_records
)
DELETE FROM public.time_records tr
USING ranked r
WHERE tr.id = r.id AND r.rn > 1;

ALTER TABLE public.time_records
  DROP CONSTRAINT IF EXISTS time_records_employee_date_unique;

DROP INDEX IF EXISTS public.time_records_identity_date_unique;
CREATE UNIQUE INDEX time_records_identity_date_unique
  ON public.time_records (
    (COALESCE(NULLIF(btrim(employee_external_id), ''), 'nome:' || btrim(employee_name))),
    record_date
  );

CREATE OR REPLACE FUNCTION public.import_time_records_safe(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  rec jsonb;
  ins_count integer := 0;
  skp_count integer := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOR rec IN SELECT value FROM jsonb_array_elements(records)
  LOOP
    INSERT INTO public.time_records (employee_name, employee_external_id, department, record_date, punches, import_batch)
    VALUES (
      trim(rec->>'employee_name'), trim(rec->>'employee_external_id'), trim(rec->>'department'),
      (rec->>'record_date')::date, rec->'punches', rec->>'import_batch'
    )
    ON CONFLICT ((COALESCE(NULLIF(btrim(employee_external_id), ''), 'nome:' || btrim(employee_name))), record_date)
    DO UPDATE SET
      punches = EXCLUDED.punches,
      import_batch = EXCLUDED.import_batch,
      employee_name = COALESCE(NULLIF(btrim(EXCLUDED.employee_name), ''), time_records.employee_name),
      employee_external_id = COALESCE(NULLIF(btrim(EXCLUDED.employee_external_id), ''), time_records.employee_external_id),
      department = COALESCE(NULLIF(btrim(EXCLUDED.department), ''), time_records.department);
    ins_count := ins_count + 1;
  END LOOP;

  RETURN jsonb_build_object('inserted', ins_count, 'skipped', skp_count);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.import_time_records_safe(jsonb) TO authenticated;

COMMENT ON INDEX public.time_records_identity_date_unique IS
  'Uma marcação diária por ID do relógio; fallback pelo nome apenas para legado sem ID.';
