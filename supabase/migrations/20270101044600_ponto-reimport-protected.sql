-- =============================================================================
-- Ponto: proteção de dia ajustado contra reimport + unlock explícito
-- =============================================================================
-- Dia com ajuste manual (upsert_manual_time_record) fica reimport_protected.
-- import_time_records_safe NÃO sobrescreve punches nesses dias.
-- set_time_record_reimport_protection libera o dia com justificativa.

ALTER TABLE public.time_records
  ADD COLUMN IF NOT EXISTS reimport_protected boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.time_records.reimport_protected IS
  'Quando true, reimport do TXT/XLS não altera punches deste dia. '
  'Ligado por ajuste manual; desligado só via set_time_record_reimport_protection.';

-- ---------------------------------------------------------------------------
-- import_time_records_safe: pula UPDATE de punches se protegido
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_time_records_safe(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  rec jsonb;
  v_record_date date;
  v_existing_id uuid;
  v_existing_punches jsonb;
  v_existing_protected boolean;
  v_employee_id uuid;
  v_persisted_employee_id uuid;
  ins_count integer := 0;
  upd_count integer := 0;
  skp_count integer := 0;
  skp_protected_count integer := 0;
  v_lock record;
BEGIN
  IF current_setting('app.timesheet_import_authorized', true) IS DISTINCT FROM 'on'
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Use o protocolo de importação de ponto.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(records, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Payload de ponto inválido: records deve ser um array.';
  END IF;

  FOR v_lock IN
    SELECT DISTINCT
      NULLIF(value->>'employee_id', '')::uuid AS employee_id,
      (value->>'record_date')::date AS record_date
    FROM jsonb_array_elements(COALESCE(records, '[]'::jsonb))
    ORDER BY employee_id, record_date
  LOOP
    IF v_lock.employee_id IS NULL THEN
      RAISE EXCEPTION 'O importador interno recebeu uma linha sem employee_id canônico.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'time-record|' || v_lock.employee_id::text || '|' || v_lock.record_date::text,
      0
    ));
  END LOOP;

  FOR rec IN SELECT value FROM jsonb_array_elements(COALESCE(records, '[]'::jsonb))
  LOOP
    v_record_date := (rec->>'record_date')::date;
    v_employee_id := NULLIF(rec->>'employee_id', '')::uuid;
    IF v_employee_id IS NULL THEN
      RAISE EXCEPTION 'O importador interno recebeu uma linha sem employee_id canônico.';
    END IF;

    SELECT tr.id, tr.punches, tr.reimport_protected
      INTO v_existing_id, v_existing_punches, v_existing_protected
    FROM public.time_records tr
    WHERE tr.employee_id = v_employee_id
      AND tr.record_date = v_record_date
    FOR UPDATE;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.time_records (
        employee_name, employee_external_id, department, record_date,
        punches, import_batch, employee_id, reimport_protected
      ) VALUES (
        btrim(COALESCE(rec->>'employee_name', '')),
        btrim(COALESCE(rec->>'employee_external_id', '')),
        btrim(COALESCE(rec->>'department', '')),
        v_record_date,
        public.merge_time_record_punches('[]'::jsonb, rec->'punches'),
        rec->>'import_batch',
        v_employee_id,
        false
      )
      RETURNING employee_id INTO v_persisted_employee_id;
      ins_count := ins_count + 1;
    ELSIF COALESCE(v_existing_protected, false) THEN
      -- Metadados do arquivo podem atualizar; punches do ajuste RH ficam intactos.
      UPDATE public.time_records
      SET employee_name = COALESCE(NULLIF(btrim(rec->>'employee_name'), ''), employee_name),
          employee_external_id = COALESCE(NULLIF(btrim(rec->>'employee_external_id'), ''), employee_external_id),
          department = COALESCE(NULLIF(btrim(rec->>'department'), ''), department),
          import_batch = rec->>'import_batch',
          employee_id = v_employee_id
      WHERE id = v_existing_id
      RETURNING employee_id INTO v_persisted_employee_id;
      skp_protected_count := skp_protected_count + 1;
      skp_count := skp_count + 1;
    ELSE
      UPDATE public.time_records
      SET employee_name = COALESCE(NULLIF(btrim(rec->>'employee_name'), ''), employee_name),
          employee_external_id = COALESCE(NULLIF(btrim(rec->>'employee_external_id'), ''), employee_external_id),
          department = COALESCE(NULLIF(btrim(rec->>'department'), ''), department),
          punches = public.merge_time_record_punches(v_existing_punches, rec->'punches'),
          import_batch = rec->>'import_batch',
          employee_id = v_employee_id
      WHERE id = v_existing_id
      RETURNING employee_id INTO v_persisted_employee_id;
      upd_count := upd_count + 1;
    END IF;

    IF v_persisted_employee_id IS DISTINCT FROM v_employee_id THEN
      RAISE EXCEPTION 'A vigência/matrícula mudou durante a importação; nenhuma batida foi aplicada.'
        USING ERRCODE = '40001';
    END IF;
    v_existing_id := NULL;
    v_existing_punches := NULL;
    v_existing_protected := NULL;
    v_persisted_employee_id := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', ins_count,
    'updated', upd_count,
    'skipped', skp_count,
    'skipped_protected', skp_protected_count
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.import_time_records_safe(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_time_records_safe(jsonb) TO service_role;

COMMENT ON FUNCTION public.import_time_records_safe(jsonb) IS
  'Upsert incremental do ponto por employee_id + data. Dias com '
  'reimport_protected=true não têm punches sobrescritos (contam em skipped_protected).';

-- ---------------------------------------------------------------------------
-- upsert_manual_time_record: liga reimport_protected em todo save de batidas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_manual_time_record(
  p_employee_id uuid,
  p_record_date date,
  p_punches text[],
  p_reason text,
  p_time_record_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_emp public.employees%ROWTYPE;
  v_record public.time_records%ROWTYPE;
  v_external_id text;
  v_resolved_employee_id uuid;
  v_old_punches jsonb := '[]'::jsonb;
  v_new_punches jsonb := '[]'::jsonb;
  v_clean_punches text[] := ARRAY[]::text[];
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_action text;
  v_is_service boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF NOT v_is_service
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para lançar o ponto.' USING ERRCODE = '42501';
  END IF;
  IF p_employee_id IS NULL OR p_record_date IS NULL THEN
    RAISE EXCEPTION 'Funcionário e data são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) < 4 THEN
    RAISE EXCEPTION 'Informe uma justificativa com pelo menos 4 caracteres.';
  END IF;
  IF p_record_date > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Não é permitido lançar batidas em data futura.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_emp
  FROM public.employees e
  WHERE e.id = p_employee_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = '23503';
  END IF;
  IF (v_emp.admission_date IS NOT NULL AND p_record_date < v_emp.admission_date)
     OR (v_emp.termination_date IS NOT NULL AND p_record_date > v_emp.termination_date) THEN
    RAISE EXCEPTION 'A data está fora da vigência do vínculo deste funcionário.' USING ERRCODE = '22023';
  END IF;

  v_external_id := NULLIF(btrim(split_part(COALESCE(v_emp.external_id, ''), ',', 1)), '');
  v_resolved_employee_id := public.resolve_time_record_employee_id(
    v_external_id, v_emp.name, p_record_date
  );
  IF v_resolved_employee_id IS DISTINCT FROM p_employee_id THEN
    RAISE EXCEPTION 'A matrícula/nome não resolve de forma única para esta ficha na data. Corrija o cadastro em Pessoas antes do lançamento.'
      USING ERRCODE = '55000';
  END IF;

  IF COALESCE(array_length(p_punches, 1), 0) > 12 THEN
    RAISE EXCEPTION 'Informe no máximo 12 batidas no dia.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_punches, ARRAY[]::text[])) p
    WHERE btrim(p) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]\*?$'
  ) THEN
    RAISE EXCEPTION 'Cada batida deve usar HH:MM entre 00:00 e 23:59.';
  END IF;

  SELECT COALESCE(
    array_agg(regexp_replace(btrim(p), '\*$', '') ORDER BY regexp_replace(btrim(p), '\*$', '')),
    ARRAY[]::text[]
  ) INTO v_clean_punches
  FROM unnest(COALESCE(p_punches, ARRAY[]::text[])) p;
  IF cardinality(v_clean_punches)
     <> (SELECT count(DISTINCT p) FROM unnest(v_clean_punches) p) THEN
    RAISE EXCEPTION 'A mesma batida não pode aparecer duas vezes.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'time-record|' || p_employee_id::text || '|' || p_record_date::text,
    0
  ));

  IF EXISTS (
    SELECT 1 FROM public.timesheet_periods tp
    WHERE tp.status = 'fechado'
      AND p_record_date BETWEEN tp.start_date AND tp.end_date
  ) THEN
    RAISE EXCEPTION 'O período de ponto desta data está fechado.' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payroll_runs pr
    WHERE pr.employee_id = p_employee_id
      AND pr.status IN ('aprovado', 'pago')
      AND p_record_date <@ public.payroll_period_range(pr.period)
  ) THEN
    RAISE EXCEPTION 'A folha desta data já foi fechada; a batida não pode ser alterada.' USING ERRCODE = '55000';
  END IF;

  IF p_time_record_id IS NOT NULL THEN
    SELECT * INTO v_record
    FROM public.time_records tr
    WHERE tr.id = p_time_record_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Registro de ponto não encontrado.' USING ERRCODE = '23503';
    END IF;
    IF v_record.employee_id IS DISTINCT FROM p_employee_id
       OR v_record.record_date IS DISTINCT FROM p_record_date THEN
      RAISE EXCEPTION 'O registro não pertence ao funcionário/data informados.' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO v_record
    FROM public.time_records tr
    WHERE tr.employee_id = p_employee_id
      AND tr.record_date = p_record_date
    FOR UPDATE;
  END IF;

  IF v_record.id IS NULL AND cardinality(v_clean_punches) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma batida para criar o registro manual.'
      USING ERRCODE = '22023';
  END IF;

  IF v_record.id IS NOT NULL THEN
    v_old_punches := COALESCE(v_record.punches, '[]'::jsonb);
    WITH requested AS (
      SELECT p AS clean FROM unnest(v_clean_punches) p
    ), resolved AS (
      SELECT
        requested.clean,
        COALESCE((
          SELECT old.value
          FROM jsonb_array_elements_text(v_old_punches) old(value)
          WHERE left(regexp_replace(old.value, '[*\"]', '', 'g'), 5) = requested.clean
          ORDER BY old.value DESC
          LIMIT 1
        ), requested.clean || '*') AS stored
      FROM requested
    )
    SELECT COALESCE(jsonb_agg(stored ORDER BY clean), '[]'::jsonb)
      INTO v_new_punches
    FROM resolved;

    UPDATE public.time_records
    SET punches = v_new_punches,
        reimport_protected = true
    WHERE id = v_record.id
    RETURNING * INTO v_record;
    v_action := CASE WHEN jsonb_array_length(v_new_punches) = 0 THEN 'clear' ELSE 'replace' END;
  ELSE
    SELECT COALESCE(jsonb_agg(p || '*' ORDER BY p), '[]'::jsonb)
      INTO v_new_punches
    FROM unnest(v_clean_punches) p;

    INSERT INTO public.time_records (
      employee_id, employee_name, employee_external_id, department,
      record_date, punches, import_batch, reimport_protected
    ) VALUES (
      p_employee_id, v_emp.name, COALESCE(v_external_id, ''), COALESCE(v_emp.department, ''),
      p_record_date, v_new_punches, 'manual_' || p_record_date::text, true
    )
    RETURNING * INTO v_record;
    IF v_record.employee_id IS DISTINCT FROM p_employee_id THEN
      RAISE EXCEPTION 'A identidade mudou durante o lançamento; nenhuma batida foi gravada.'
        USING ERRCODE = '40001';
    END IF;
    v_action := 'create';
  END IF;

  INSERT INTO public.time_record_manual_overrides (
    time_record_id, added_punch, position, action, reason, created_by,
    punches_before, punches_after
  ) VALUES (
    v_record.id, NULL, NULL, v_action, v_reason, auth.uid(),
    v_old_punches, v_new_punches
  );

  INSERT INTO public.weekly_balance_audit_log (
    snapshot_id, employee_id, week_start, action, reason, changed_by, metadata
  ) VALUES (
    NULL, p_employee_id, date_trunc('week', p_record_date)::date,
    CASE WHEN jsonb_array_length(v_old_punches) = 0 THEN 'retroactive_insert' ELSE 'retroactive_edit' END,
    v_reason, auth.uid(),
    jsonb_build_object(
      'time_record_id', v_record.id,
      'record_date', p_record_date,
      'punches_before', v_old_punches,
      'punches_after', v_new_punches,
      'identity_source', 'explicit_employee_id',
      'reimport_protected', true
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'time_record_id', v_record.id,
    'employee_id', v_record.employee_id,
    'punches_before', v_old_punches,
    'punches_after', v_new_punches,
    'action', v_action,
    'reimport_protected', true
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.upsert_manual_time_record(uuid, date, text[], text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_manual_time_record(uuid, date, text[], text, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Unlock / re-lock explícito (mesmo papel do upsert)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_time_record_reimport_protection(
  p_time_record_id uuid,
  p_protected boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_record public.time_records%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_is_service boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF NOT v_is_service
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para alterar proteção de reimport.' USING ERRCODE = '42501';
  END IF;
  IF p_time_record_id IS NULL OR p_protected IS NULL THEN
    RAISE EXCEPTION 'Registro e flag de proteção são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) < 4 THEN
    RAISE EXCEPTION 'Informe uma justificativa com pelo menos 4 caracteres.';
  END IF;

  SELECT * INTO v_record
  FROM public.time_records tr
  WHERE tr.id = p_time_record_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de ponto não encontrado.' USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.timesheet_periods tp
    WHERE tp.status = 'fechado'
      AND v_record.record_date BETWEEN tp.start_date AND tp.end_date
  ) THEN
    RAISE EXCEPTION 'O período de ponto desta data está fechado.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.time_records
  SET reimport_protected = p_protected
  WHERE id = v_record.id
  RETURNING * INTO v_record;

  INSERT INTO public.weekly_balance_audit_log (
    snapshot_id, employee_id, week_start, action, reason, changed_by, metadata
  ) VALUES (
    NULL, v_record.employee_id, date_trunc('week', v_record.record_date)::date,
    CASE WHEN p_protected THEN 'reimport_protect' ELSE 'reimport_unlock' END,
    v_reason, auth.uid(),
    jsonb_build_object(
      'time_record_id', v_record.id,
      'record_date', v_record.record_date,
      'reimport_protected', p_protected
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'time_record_id', v_record.id,
    'reimport_protected', v_record.reimport_protected
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_time_record_reimport_protection(uuid, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_time_record_reimport_protection(uuid, boolean, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.set_time_record_reimport_protection(uuid, boolean, text) IS
  'Liga/desliga reimport_protected com justificativa. Não contorna período fechado.';
