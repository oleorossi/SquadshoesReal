-- Hardening de duas brechas encontradas na auditoria de segurança:
--
-- 1) automation_workflows e automation_executions estão com policy
--    `FOR ALL USING (true) WITH CHECK (true)` — qualquer usuário (anon
--    inclusive, se cliente expuser ANON_KEY) lê/escreve TUDO. Tabelas
--    contêm definições de workflows + execuções com payloads. Restringe
--    a usuários autenticados E aprovados.
--
-- 2) import_time_records_safe é SECURITY DEFINER mas não chama
--    is_approved_user(). Qualquer usuário autenticado pode mass-import
--    time_records, afetando diretamente cálculos de folha (overtime,
--    saldo de banco de horas). Adiciona o guard.

-- ============================================================
-- 1. RLS em automation_workflows / automation_executions
-- ============================================================

DROP POLICY IF EXISTS "auto_workflows_all"  ON public.automation_workflows;
DROP POLICY IF EXISTS "auto_executions_all" ON public.automation_executions;

-- SELECT aberto para usuários autenticados (visibilidade geral do que está
-- automatizado é benéfica para auditoria). Mutações exigem usuário aprovado.
CREATE POLICY "auto_workflows_select" ON public.automation_workflows
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auto_workflows_mutate" ON public.automation_workflows
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

CREATE POLICY "auto_executions_select" ON public.automation_executions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auto_executions_mutate" ON public.automation_executions
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

-- ============================================================
-- 2. is_approved_user em import_time_records_safe
-- ============================================================

DROP FUNCTION IF EXISTS public.import_time_records_safe(records jsonb) CASCADE;
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
  skp_count  integer := 0;
BEGIN
  -- HR/folha-sensitive: bloqueia usuários não aprovados.
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

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
      ins_count := ins_count + 1;
    ELSE
      skp_count := skp_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', ins_count, 'skipped', skp_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_time_records_safe(jsonb) TO authenticated;
