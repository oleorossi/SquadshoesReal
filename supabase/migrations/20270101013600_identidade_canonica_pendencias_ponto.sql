-- =============================================================================
-- Ponto — identidade canônica e fronteira auditável nas pendências
-- =============================================================================
-- `time_records.employee_id` é resolvido e congelado pelo servidor na migration
-- 134. Nenhum consumidor financeiro/operacional pode voltar a escolher uma
-- pessoa por crachá ou nome, sobretudo quando o crachá foi reciclado.

-- Papel não reativa uma conta bloqueada. Este helper é compartilhado pelas
-- policies/RPCs do sistema inteiro; exigir `profiles.approved` aqui fecha também
-- tokens antigos de usuários cujo papel RH/admin foi preservado para auditoria.
CREATE OR REPLACE FUNCTION public.user_has_any_role(roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      OR (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.approved = true
        )
        AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid() AND ur.role::text = ANY(roles)
        )
      );
$$;

-- Autoria é evidência histórica, não relação de vida útil. Manter FK para
-- auth.users permitiria que um log de correção bloqueasse a exclusão futura da
-- conta do autor, justamente quando a trilha precisa sobreviver à conta.
ALTER TABLE public.weekly_balance_audit_log
  DROP CONSTRAINT IF EXISTS weekly_balance_audit_log_changed_by_fkey;
COMMENT ON COLUMN public.weekly_balance_audit_log.changed_by IS
  'UUID histórico do autor no momento da ação; sem FK de propósito para preservar auditoria após exclusão da conta Auth.';

-- ── Invariante físico: uma pessoa canônica por dia ──────────────────────────
DO $canonical_day_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.time_records tr
    WHERE tr.employee_id IS NOT NULL
    GROUP BY tr.employee_id, tr.record_date
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Há mais de uma linha de ponto para o mesmo employee_id/data; consolide antes de promover a identidade canônica.';
  END IF;
END;
$canonical_day_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS time_records_employee_id_date_unique
  ON public.time_records (employee_id, record_date)
  WHERE employee_id IS NOT NULL;

COMMENT ON INDEX public.time_records_employee_id_date_unique IS
  'Uma pessoa canônica possui no máximo uma linha de ponto por data, mesmo após troca/reciclagem de crachá.';

-- O importador interno da 134 serializava por texto do crachá. A partir daqui
-- a trava e a procura do registro existente usam a FK já validada pela wrapper.
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
  v_employee_id uuid;
  v_persisted_employee_id uuid;
  ins_count integer := 0;
  upd_count integer := 0;
  skp_count integer := 0;
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

    SELECT tr.id, tr.punches
      INTO v_existing_id, v_existing_punches
    FROM public.time_records tr
    WHERE tr.employee_id = v_employee_id
      AND tr.record_date = v_record_date
    FOR UPDATE;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.time_records (
        employee_name, employee_external_id, department, record_date,
        punches, import_batch, employee_id
      ) VALUES (
        btrim(COALESCE(rec->>'employee_name', '')),
        btrim(COALESCE(rec->>'employee_external_id', '')),
        btrim(COALESCE(rec->>'department', '')),
        v_record_date,
        public.merge_time_record_punches('[]'::jsonb, rec->'punches'),
        rec->>'import_batch',
        v_employee_id
      )
      RETURNING employee_id INTO v_persisted_employee_id;
      ins_count := ins_count + 1;
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
    v_persisted_employee_id := NULL;
  END LOOP;

  RETURN jsonb_build_object('inserted', ins_count, 'updated', upd_count, 'skipped', skp_count);
END;
$fn$;

REVOKE ALL ON FUNCTION public.import_time_records_safe(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_time_records_safe(jsonb) TO service_role;

-- A tabela histórica registra agora também substituição/limpeza, não apenas a
-- adição de uma batida. Linhas antigas permanecem `add` por default/backfill.
ALTER TABLE public.time_record_manual_overrides
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'add',
  ALTER COLUMN added_punch DROP NOT NULL,
  ALTER COLUMN position DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS time_record_manual_overrides_action_check,
  ADD CONSTRAINT time_record_manual_overrides_action_check
    CHECK (action IN ('add', 'replace', 'clear', 'create'));

-- Escrita integral de um dia manual: a pessoa vem por UUID, precisa estar vigente
-- e a matrícula/nome ainda deve resolver exatamente para essa mesma ficha.
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
    SET punches = v_new_punches
    WHERE id = v_record.id
    RETURNING * INTO v_record;
    v_action := CASE WHEN jsonb_array_length(v_new_punches) = 0 THEN 'clear' ELSE 'replace' END;
  ELSE
    SELECT COALESCE(jsonb_agg(p || '*' ORDER BY p), '[]'::jsonb)
      INTO v_new_punches
    FROM unnest(v_clean_punches) p;

    INSERT INTO public.time_records (
      employee_id, employee_name, employee_external_id, department,
      record_date, punches, import_batch
    ) VALUES (
      p_employee_id, v_emp.name, COALESCE(v_external_id, ''), COALESCE(v_emp.department, ''),
      p_record_date, v_new_punches, 'manual_' || p_record_date::text
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
      'identity_source', 'explicit_employee_id'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'time_record_id', v_record.id,
    'employee_id', v_record.employee_id,
    'punches_before', v_old_punches,
    'punches_after', v_new_punches,
    'action', v_action
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.upsert_manual_time_record(uuid, date, text[], text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_manual_time_record(uuid, date, text[], text, uuid)
  TO authenticated, service_role;

-- Reprocessa uma linha legada órfã depois de o RH corrigir matrícula/vigência em
-- Pessoas. A resolução continua exata e server-side; nome aproximado não entra.
CREATE OR REPLACE FUNCTION public.resolve_unlinked_time_record(
  p_time_record_id uuid,
  p_expected_employee_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'Reprocessamento após correção cadastral'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_record public.time_records%ROWTYPE;
  v_resolved_employee_id uuid;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_is_service boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF NOT v_is_service
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para resolver o vínculo do ponto.' USING ERRCODE = '42501';
  END IF;
  IF p_time_record_id IS NULL OR length(v_reason) < 4 THEN
    RAISE EXCEPTION 'Registro e justificativa são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_record FROM public.time_records WHERE id = p_time_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de ponto não encontrado.' USING ERRCODE = '23503';
  END IF;
  IF v_record.employee_id IS NOT NULL THEN
    IF p_expected_employee_id IS NOT NULL
       AND v_record.employee_id IS DISTINCT FROM p_expected_employee_id THEN
      RAISE EXCEPTION 'O registro já pertence a outra ficha.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'resolved', true,
      'idempotent', true,
      'time_record_id', v_record.id,
      'employee_id', v_record.employee_id
    );
  END IF;

  v_resolved_employee_id := public.resolve_time_record_employee_id(
    v_record.employee_external_id, v_record.employee_name, v_record.record_date
  );
  IF v_resolved_employee_id IS NULL THEN
    RAISE EXCEPTION 'A matrícula ainda não resolve para uma única ficha vigente. Corrija o cadastro em Pessoas e tente novamente.'
      USING ERRCODE = '55000';
  END IF;
  IF p_expected_employee_id IS NOT NULL
     AND v_resolved_employee_id IS DISTINCT FROM p_expected_employee_id THEN
    RAISE EXCEPTION 'A matrícula resolve para outra ficha que não a esperada.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'time-record|' || v_resolved_employee_id::text || '|' || v_record.record_date::text,
    0
  ));
  SELECT * INTO v_record
  FROM public.time_records
  WHERE id = p_time_record_id
  FOR UPDATE;

  IF v_record.employee_id IS NOT NULL THEN
    IF v_record.employee_id IS DISTINCT FROM v_resolved_employee_id THEN
      RAISE EXCEPTION 'O vínculo mudou durante a resolução; recarregue a fila.' USING ERRCODE = '40001';
    END IF;
    RETURN jsonb_build_object(
      'resolved', true,
      'idempotent', true,
      'time_record_id', v_record.id,
      'employee_id', v_record.employee_id
    );
  END IF;

  IF public.resolve_time_record_employee_id(
       v_record.employee_external_id, v_record.employee_name, v_record.record_date
     ) IS DISTINCT FROM v_resolved_employee_id THEN
    RAISE EXCEPTION 'A matrícula/vigência mudou durante a resolução; tente novamente.' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.time_records other
    WHERE other.id <> v_record.id
      AND other.employee_id = v_resolved_employee_id
      AND other.record_date = v_record.record_date
  ) THEN
    RAISE EXCEPTION 'Já existe outra linha canônica desta pessoa na data; consolide a duplicidade antes de vincular.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.timesheet_periods tp
    WHERE tp.status = 'fechado'
      AND v_record.record_date BETWEEN tp.start_date AND tp.end_date
  ) OR EXISTS (
    SELECT 1 FROM public.payroll_runs pr
    WHERE pr.employee_id = v_resolved_employee_id
      AND pr.status IN ('aprovado', 'pago')
      AND v_record.record_date <@ public.payroll_period_range(pr.period)
  ) THEN
    RAISE EXCEPTION 'O período/folha desta data está fechado e o vínculo não pode ser alterado.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.time_records
  SET employee_id = v_resolved_employee_id
  WHERE id = v_record.id
  RETURNING * INTO v_record;
  IF v_record.employee_id IS DISTINCT FROM v_resolved_employee_id THEN
    RAISE EXCEPTION 'A identidade persistida divergiu da resolução canônica.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.weekly_balance_audit_log (
    snapshot_id, employee_id, week_start, action, reason, changed_by, metadata
  ) VALUES (
    NULL, v_resolved_employee_id, date_trunc('week', v_record.record_date)::date,
    'recompute', v_reason, auth.uid(),
    jsonb_build_object(
      'time_record_id', v_record.id,
      'record_date', v_record.record_date,
      'identity_before', NULL,
      'identity_after', v_resolved_employee_id,
      'identity_source', 'resolve_time_record_employee_id'
    )
  );

  RETURN jsonb_build_object(
    'resolved', true,
    'idempotent', false,
    'time_record_id', v_record.id,
    'employee_id', v_record.employee_id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_unlinked_time_record(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_unlinked_time_record(uuid, uuid, text)
  TO authenticated, service_role;

-- Não existe mais caminho de escrita direta. Importação e correções passam por
-- RPCs SECURITY DEFINER que aplicam autorização, lock, vigência e auditoria.
DROP POLICY IF EXISTS time_records_write ON public.time_records;
DROP POLICY IF EXISTS "Approved users can insert time_records" ON public.time_records;
DROP POLICY IF EXISTS "Approved users can update time_records" ON public.time_records;
DROP POLICY IF EXISTS "Approved users can delete time_records" ON public.time_records;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.time_records
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_guard_time_record_closed_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_old_date date := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.record_date END;
  v_new_date date := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.record_date END;
BEGIN
  IF (v_old_date IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.timesheet_periods tp
        WHERE tp.status = 'fechado' AND v_old_date BETWEEN tp.start_date AND tp.end_date
      ))
     OR (v_new_date IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.timesheet_periods tp
        WHERE tp.status = 'fechado' AND v_new_date BETWEEN tp.start_date AND tp.end_date
      )) THEN
    RAISE EXCEPTION 'O período de ponto desta data está fechado.' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_zy_guard_time_record_closed_period ON public.time_records;
CREATE TRIGGER trg_zy_guard_time_record_closed_period
BEFORE INSERT OR UPDATE OR DELETE ON public.time_records
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_time_record_closed_period();

-- Quarentena precisa de duas saídas auditáveis: vincular a uma ficha canônica
-- ou classificar como ruído legítimo do arquivo (crachá de teste, terceiro,
-- ex-funcionário fora da vigência). Sem a segunda, uma única linha impossível
-- de vincular bloqueia todas as folhas da competência para sempre.
ALTER TABLE public.time_import_quarantine
  ADD COLUMN IF NOT EXISTS resolution_status text,
  ADD COLUMN IF NOT EXISTS resolution_reason text;

UPDATE public.time_import_quarantine
SET resolution_status = CASE
  WHEN resolved_at IS NOT NULL AND time_record_id IS NOT NULL THEN 'linked'
  ELSE 'pending'
END
WHERE resolution_status IS NULL;

ALTER TABLE public.time_import_quarantine
  ALTER COLUMN resolution_status SET DEFAULT 'pending',
  ALTER COLUMN resolution_status SET NOT NULL,
  DROP CONSTRAINT IF EXISTS time_import_quarantine_resolution_check,
  DROP CONSTRAINT IF EXISTS time_import_quarantine_resolution_state_check;

ALTER TABLE public.time_import_quarantine
  ADD CONSTRAINT time_import_quarantine_resolution_state_check CHECK (
    (resolution_status = 'pending'
      AND resolved_at IS NULL AND resolved_by IS NULL
      AND time_record_id IS NULL AND resolution_reason IS NULL)
    OR
    (resolution_status = 'linked'
      AND resolved_at IS NOT NULL AND time_record_id IS NOT NULL
      AND resolution_reason IS NULL)
    OR
    (resolution_status = 'dismissed'
      AND resolved_at IS NOT NULL AND time_record_id IS NULL
      AND length(btrim(COALESCE(resolution_reason, ''))) >= 4)
  );

UPDATE public.time_import_quarantine
SET resolution_status = 'linked'
WHERE resolved_at IS NOT NULL AND time_record_id IS NOT NULL
  AND resolution_status <> 'linked';

DROP INDEX IF EXISTS public.idx_time_import_quarantine_open;
CREATE INDEX idx_time_import_quarantine_open
  ON public.time_import_quarantine (record_date DESC, employee_external_id)
  WHERE resolution_status = 'pending';

CREATE OR REPLACE FUNCTION public.dismiss_time_import_quarantine(
  p_quarantine_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_quarantine public.time_import_quarantine%ROWTYPE;
  v_period_id uuid;
  v_period_status text;
  v_match_id uuid;
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para classificar a quarentena do ponto.'
      USING ERRCODE = '42501';
  END IF;
  IF p_quarantine_id IS NULL OR length(v_reason) < 4 THEN
    RAISE EXCEPTION 'Informe a pendência e uma justificativa com pelo menos 4 caracteres.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_quarantine
  FROM public.time_import_quarantine
  WHERE id = p_quarantine_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pendência da quarentena não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_quarantine.resolution_status = 'dismissed' THEN
    IF v_quarantine.resolution_reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'A pendência já foi classificada com justificativa diferente; o histórico é imutável.'
        USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object(
      'dismissed', true,
      'idempotent', true,
      'quarantine_id', v_quarantine.id
    );
  END IF;
  IF v_quarantine.resolution_status <> 'pending' THEN
    RAISE EXCEPTION 'Esta pendência já foi vinculada ao ponto e não pode ser ignorada.'
      USING ERRCODE = '55000';
  END IF;

  -- Mesmo mutex usado pelos gatilhos de employees/quarentena/folha. Depois
  -- deste lock, nenhuma ficha pode surgir entre a revalidação abaixo e o
  -- descarte; se uma alteração já estiver em curso, esperamos e enxergamos o
  -- estado confirmado antes de decidir.
  PERFORM 1
  FROM public.payroll_input_epoch
  WHERE singleton
  FOR UPDATE;

  SELECT l.period_id INTO v_period_id
  FROM public.time_import_logs l
  WHERE l.id = v_quarantine.import_log_id
  FOR SHARE;
  IF v_period_id IS NOT NULL THEN
    SELECT tp.status INTO v_period_status
    FROM public.timesheet_periods tp
    WHERE tp.id = v_period_id
    FOR SHARE;
  END IF;
  IF v_period_status = 'fechado' THEN
    RAISE EXCEPTION 'O período de ponto está fechado e não aceita classificação de quarentena.'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.payroll_runs pr
    WHERE pr.status IN ('aprovado', 'pago')
      AND v_quarantine.record_date <@ public.payroll_period_range(pr.period)
  ) THEN
    RAISE EXCEPTION 'Já existe folha aprovada cobrindo esta data; a quarentena não pode ser alterada.'
      USING ERRCODE = '55000';
  END IF;

  v_match_id := public.resolve_time_record_employee_id(
    v_quarantine.employee_external_id,
    v_quarantine.employee_name,
    v_quarantine.record_date
  );
  IF v_match_id IS NOT NULL THEN
    RAISE EXCEPTION 'A matrícula agora possui uma ficha vigente. Use Tentar resolver para aplicar as batidas ao ponto.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.time_import_quarantine
  SET resolution_status = 'dismissed',
      resolution_reason = v_reason,
      resolved_at = now(),
      resolved_by = auth.uid(),
      time_record_id = NULL
  WHERE id = v_quarantine.id;

  RETURN jsonb_build_object(
    'dismissed', true,
    'idempotent', false,
    'quarantine_id', v_quarantine.id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.dismiss_time_import_quarantine(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_time_import_quarantine(uuid, text)
  TO authenticated, service_role;

-- A ausência só cobre financeiramente o dia quando é remunerada. O helper
-- legado olhava apenas `justified`, fazendo suspensão (justificada, porém
-- `paid=false`) aparecer como abonada nas pendências enquanto a folha —
-- corretamente — descontava o dia.
CREATE OR REPLACE FUNCTION public.is_employee_absent_on(
  p_employee_id uuid,
  p_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_absences a
    WHERE a.employee_id = p_employee_id
      AND COALESCE(a.paid, a.justified, true) = true
      AND lower(COALESCE(a.absence_type, '')) NOT IN ('suspensao', 'falta_injustificada')
      AND a.hours_per_day IS NULL
      AND NULLIF(a.start_date, '') IS NOT NULL
      AND NULLIF(a.end_date, '') IS NOT NULL
      AND p_date BETWEEN NULLIF(a.start_date, '')::date AND NULLIF(a.end_date, '')::date
  );
$fn$;

-- Cobertura não pode avançar além do instante em que o arquivo foi arquivado.
-- Um cabeçalho mensal 01–31 importado no dia 26 cobre no máximo até o dia 26;
-- os dias futuros continuam faltando e impedem o fechamento prematuro da folha.
CREATE OR REPLACE FUNCTION public.tg_payroll_block_incomplete_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_range daterange;
  v_missing_date date;
  v_payment_type text;
  v_schedule_id uuid;
  v_external_id text;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status <> 'rascunho' OR NEW.status NOT IN ('aprovado', 'pago') THEN
    RETURN NEW;
  END IF;
  SELECT lower(COALESCE(payment_type, 'mensalista')), work_schedule_id, NULLIF(btrim(external_id), '')
    INTO v_payment_type, v_schedule_id, v_external_id
  FROM public.employees WHERE id = NEW.employee_id;

  IF v_payment_type IN ('mensalista', 'diarista') THEN
    IF jsonb_typeof(NEW.calculation_snapshot->'result') IS DISTINCT FROM 'object'
       OR NOT (NEW.calculation_snapshot->'result' ? 'pending_days')
       OR jsonb_typeof(NEW.calculation_snapshot->'result'->'pending_days') <> 'number'
       OR NOT (NEW.calculation_snapshot->'result' ? 'he_rate_missing')
       OR jsonb_typeof(NEW.calculation_snapshot->'result'->'he_rate_missing') <> 'boolean' THEN
      RAISE EXCEPTION 'Snapshot da folha incompleto; recalcule antes de aprovar.';
    END IF;
    IF (NEW.calculation_snapshot->'result'->>'pending_days')::integer > 0 THEN
      RAISE EXCEPTION 'Folha possui batidas pendentes. Resolva o ponto antes de aprovar.';
    END IF;
    IF (NEW.calculation_snapshot->'result'->>'he_rate_missing')::boolean THEN
      RAISE EXCEPTION 'Folha possui hora extra sem taxa financeira cadastrada.';
    END IF;
    IF v_schedule_id IS NULL THEN
      RAISE EXCEPTION 'Funcionário sem jornada própria. Cadastre a jornada antes de aprovar a folha.';
    END IF;
    IF v_external_id IS NULL THEN
      RAISE EXCEPTION 'Funcionário sem matrícula do relógio. Cadastre a matrícula antes de aprovar a folha.';
    END IF;
    v_range := public.payroll_period_range(NEW.period);

    IF EXISTS (
      SELECT 1
      FROM public.time_import_quarantine q
      WHERE q.resolution_status = 'pending'
        AND q.record_date <@ v_range
    ) THEN
      RAISE EXCEPTION 'Existem batidas sem dono definido em quarentena no período. Resolva todos os vínculos antes de aprovar qualquer folha.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.time_records tr
      WHERE tr.employee_id IS NULL
        AND tr.record_date <@ v_range
    ) THEN
      RAISE EXCEPTION 'Existem batidas sem vínculo canônico no período. Corrija todas as fichas em Pessoas antes de aprovar qualquer folha.';
    END IF;

    SELECT d::date INTO v_missing_date
    FROM generate_series(lower(v_range), upper(v_range) - 1, interval '1 day') d
    WHERE NOT EXISTS (
      -- listed_employees nunca fabrica falta: somente um arquivo integral cujo
      -- roster foi validado e contém a matrícula alvo fecha a cobertura.
      SELECT 1 FROM public.time_import_logs l
      WHERE l.archive_status = 'available'
        AND l.status IN ('success', 'partial')
        AND l.coverage_scope = 'all_employees'
        AND l.covered_employee_external_ids
          && regexp_split_to_array(v_external_id, '\s*,\s*')
        AND d::date BETWEEN l.start_date AND LEAST(
          l.end_date,
          COALESCE(l.archived_at, l.created_at) AT TIME ZONE 'America/Sao_Paulo',
          now() AT TIME ZONE 'America/Sao_Paulo'
        )::date
    )
    ORDER BY d
    LIMIT 1;
    IF v_missing_date IS NOT NULL THEN
      RAISE EXCEPTION 'Ponto sem arquivo de cobertura em %. Importe o período completo antes de aprovar.', v_missing_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- ── Folha cancelada libera a competência sem apagar o documento original ───
ALTER TABLE public.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_employee_id_period_key;
DROP INDEX IF EXISTS public.payroll_runs_employee_id_period_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_active_employee_period
  ON public.payroll_runs (employee_id, period)
  WHERE status <> 'cancelado';

COMMENT ON INDEX public.uq_payroll_runs_active_employee_period IS
  'Uma única folha ativa por pessoa/competência; canceladas permanecem como histórico e liberam novo cálculo.';

CREATE TABLE IF NOT EXISTS public.payroll_run_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL UNIQUE
    REFERENCES public.payroll_runs(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 4),
  cancelled_by uuid,
  cancelled_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_run_cancellations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_run_cancellations_rh_select ON public.payroll_run_cancellations;
CREATE POLICY payroll_run_cancellations_rh_select
  ON public.payroll_run_cancellations FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.payroll_run_cancellations
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payroll_run_cancellations TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_require_payroll_cancel_command()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF OLD.status IN ('aprovado', 'pago')
     AND NEW.status = 'cancelado'
     AND current_setting('app.payroll_cancel_command', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Use o comando de cancelamento auditado da folha.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS tg_aa_require_payroll_cancel_command ON public.payroll_runs;
CREATE TRIGGER tg_aa_require_payroll_cancel_command
BEFORE UPDATE OF status ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.tg_require_payroll_cancel_command();

CREATE OR REPLACE FUNCTION public.cancel_payroll_run(p_payroll_run_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_run public.payroll_runs%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_previous_command text := COALESCE(current_setting('app.payroll_cancel_command', true), '');
  v_is_service boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF NOT v_is_service
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para cancelar a folha.' USING ERRCODE = '42501';
  END IF;
  IF p_payroll_run_id IS NULL OR length(v_reason) < 4 THEN
    RAISE EXCEPTION 'Folha e justificativa com pelo menos 4 caracteres são obrigatórias.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada.' USING ERRCODE = '23503';
  END IF;
  IF v_run.status = 'cancelado' THEN
    RETURN v_run.id;
  END IF;
  IF v_run.status NOT IN ('aprovado', 'pago') THEN
    RAISE EXCEPTION 'Somente folha aprovada/paga pode ser cancelada; rascunho deve ser recalculado.' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payroll_payments p
    WHERE p.payroll_run_id = v_run.id AND p.reversed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Estorne todos os pagamentos antes de cancelar a folha.' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.payroll_run_cancellations (
    payroll_run_id, reason, cancelled_by
  ) VALUES (
    v_run.id, v_reason, auth.uid()
  )
  ON CONFLICT (payroll_run_id) DO NOTHING;

  PERFORM set_config('app.payroll_cancel_command', 'on', true);
  UPDATE public.payroll_runs
  SET status = 'cancelado', updated_at = now()
  WHERE id = v_run.id;
  PERFORM set_config('app.payroll_cancel_command', v_previous_command, true);

  RETURN v_run.id;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.payroll_cancel_command', v_previous_command, true);
  RAISE;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cancel_payroll_run(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_payroll_run(uuid, text)
  TO authenticated, service_role;

-- ── Padrão observado: somente registros já vinculados pelo servidor ─────────
CREATE OR REPLACE VIEW public.v_employee_punch_pattern
WITH (security_invoker = true) AS
WITH valid_days AS (
  SELECT
    e.id AS employee_id,
    e.name AS employee_name,
    e.external_id,
    tr.record_date,
    (tr.punches->>0)::time AS p1,
    (tr.punches->>1)::time AS p2,
    (tr.punches->>2)::time AS p3,
    (tr.punches->>3)::time AS p4
  FROM public.time_records tr
  JOIN public.employees e ON e.id = tr.employee_id
  WHERE tr.record_date >= CURRENT_DATE - INTERVAL '60 days'
    AND tr.record_date >= public.get_bank_hours_cutoff()
    AND jsonb_array_length(tr.punches) = 4
    AND EXTRACT(isodow FROM tr.record_date) BETWEEN 1 AND 5
    AND (tr.punches->>0) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND (tr.punches->>1) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND (tr.punches->>2) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND (tr.punches->>3) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND (tr.punches->>0)::time < (tr.punches->>1)::time
    AND (tr.punches->>1)::time < (tr.punches->>2)::time
    AND (tr.punches->>2)::time < (tr.punches->>3)::time
),
medians AS (
  SELECT
    employee_id,
    employee_name,
    external_id,
    COUNT(*) AS observed_days,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY p1) AS entry_observed,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY p2) AS lunch_start_observed,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY p3) AS lunch_end_observed,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY p4) AS exit_observed
  FROM valid_days
  GROUP BY employee_id, employee_name, external_id
)
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  e.external_id,
  e.department,
  COALESCE(m.observed_days, 0) AS observed_days,
  m.entry_observed,
  m.lunch_start_observed,
  m.lunch_end_observed,
  m.exit_observed,
  ws.entry_time AS entry_schedule,
  ws.lunch_start AS lunch_start_schedule,
  ws.lunch_end AS lunch_end_schedule,
  ws.exit_time AS exit_schedule,
  COALESCE(ws.tolerance_minutes, 10) AS tolerance_minutes
FROM public.employees e
LEFT JOIN medians m ON m.employee_id = e.id
LEFT JOIN LATERAL (
  SELECT
    schedule.entry_time,
    schedule.lunch_start,
    schedule.lunch_end,
    schedule.exit_time,
    schedule.tolerance_minutes
  FROM public.work_schedules schedule
  WHERE schedule.id = e.work_schedule_id
     OR (e.work_schedule_id IS NULL AND schedule.is_default = true)
  ORDER BY ((schedule.id = e.work_schedule_id) IS TRUE) DESC,
           schedule.created_at,
           schedule.id
  LIMIT 1
) ws ON true
WHERE e.active = true;

REVOKE ALL ON TABLE public.v_employee_punch_pattern FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.v_employee_punch_pattern TO authenticated, service_role;

COMMENT ON VIEW public.v_employee_punch_pattern IS
  'Padrão de batidas por funcionário calculado exclusivamente por time_records.employee_id; '
  'crachá e nome nunca são usados como identidade.';

-- ── Sugestão: a própria linha precisa ter FK canônica ───────────────────────
CREATE OR REPLACE FUNCTION public.suggest_punches_for_record(p_time_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_rec record;
  v_pattern record;
  v_existing text[];
  v_n integer;
  v_p1 text;
  v_p2 text;
  v_p3 text;
  v_p4 text;
  v_suggested text[];
  v_source text;
  v_confidence text;
  v_reason text;
  v_is_absent boolean := false;
  v_obs_array jsonb;
  v_sch_array jsonb;
BEGIN
  SELECT tr.id, tr.employee_id, tr.record_date, tr.punches
  INTO v_rec
  FROM public.time_records tr
  WHERE tr.id = p_time_record_id;

  IF v_rec.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_existing := ARRAY(
    SELECT left(regexp_replace(value, '[*\"]', '', 'g'), 5)
    FROM jsonb_array_elements_text(COALESCE(v_rec.punches, '[]'::jsonb)) p(value)
  );
  v_n := COALESCE(array_length(v_existing, 1), 0);

  IF v_rec.employee_id IS NULL THEN
    RETURN jsonb_build_object(
      'suggested', '[]'::jsonb,
      'source', 'none',
      'confidence', 'none',
      'reason', 'Registro sem vínculo canônico. Corrija a matrícula/vigência em Pessoas antes de completar batidas.',
      'missing_count', GREATEST(0, 4 - v_n),
      'observed_days', 0,
      'is_absent_covered', false,
      'pattern', jsonb_build_object('observed', NULL, 'schedule', NULL)
    );
  END IF;

  SELECT * INTO v_pattern
  FROM public.v_employee_punch_pattern
  WHERE employee_id = v_rec.employee_id;

  v_is_absent := public.is_employee_absent_on(v_rec.employee_id, v_rec.record_date);

  IF v_pattern.observed_days >= 5 THEN
    v_source := 'observed';
    v_confidence := CASE WHEN v_pattern.observed_days >= 15 THEN 'high' ELSE 'medium' END;
    v_p1 := to_char(v_pattern.entry_observed, 'HH24:MI');
    v_p2 := to_char(v_pattern.lunch_start_observed, 'HH24:MI');
    v_p3 := to_char(v_pattern.lunch_end_observed, 'HH24:MI');
    v_p4 := to_char(v_pattern.exit_observed, 'HH24:MI');
  ELSIF v_pattern.entry_schedule IS NOT NULL THEN
    v_source := 'schedule';
    v_confidence := 'low';
    v_p1 := to_char(v_pattern.entry_schedule, 'HH24:MI');
    v_p2 := to_char(v_pattern.lunch_start_schedule, 'HH24:MI');
    v_p3 := to_char(v_pattern.lunch_end_schedule, 'HH24:MI');
    v_p4 := to_char(v_pattern.exit_schedule, 'HH24:MI');
  ELSE
    RETURN jsonb_build_object(
      'suggested', '[]'::jsonb,
      'source', 'none',
      'confidence', 'none',
      'reason', 'Funcionário sem escala cadastrada e sem histórico suficiente para sugerir batidas.',
      'missing_count', GREATEST(0, 4 - v_n),
      'observed_days', COALESCE(v_pattern.observed_days, 0),
      'is_absent_covered', v_is_absent,
      'pattern', jsonb_build_object('observed', NULL, 'schedule', NULL)
    );
  END IF;

  IF v_n = 0 THEN
    v_suggested := ARRAY[v_p1, v_p2, v_p3, v_p4];
    v_reason := CASE WHEN v_is_absent
      THEN 'Dia vazio já coberto por ausência remunerada; não complete batidas sem confirmar trabalho real.'
      ELSE 'Dia vazio; confirme trabalho real ou cadastre a ausência antes de aplicar o padrão.'
    END;
  ELSIF v_n = 1 THEN
    v_suggested := ARRAY[v_existing[1], v_p2, v_p3, v_p4];
    v_reason := 'Só uma batida registrada; a sugestão preserva a batida real e completa o restante.';
  ELSIF v_n = 2 THEN
    v_suggested := ARRAY[v_existing[1], v_p2, v_p3, v_existing[2]];
    v_reason := 'A sugestão preserva entrada/saída reais e completa o intervalo.';
  ELSIF v_n = 3 THEN
    v_suggested := ARRAY[v_existing[1], v_existing[2], v_existing[3], v_p4];
    v_reason := 'A sugestão preserva as três batidas reais e completa a saída final.';
  ELSE
    v_suggested := v_existing;
    v_reason := 'Já existem quatro ou mais batidas; revise a sequência manualmente.';
  END IF;

  v_obs_array := CASE WHEN v_pattern.observed_days >= 5 THEN jsonb_build_array(
    to_char(v_pattern.entry_observed, 'HH24:MI'),
    to_char(v_pattern.lunch_start_observed, 'HH24:MI'),
    to_char(v_pattern.lunch_end_observed, 'HH24:MI'),
    to_char(v_pattern.exit_observed, 'HH24:MI')
  ) ELSE NULL END;
  v_sch_array := CASE WHEN v_pattern.entry_schedule IS NOT NULL THEN jsonb_build_array(
    to_char(v_pattern.entry_schedule, 'HH24:MI'),
    to_char(v_pattern.lunch_start_schedule, 'HH24:MI'),
    to_char(v_pattern.lunch_end_schedule, 'HH24:MI'),
    to_char(v_pattern.exit_schedule, 'HH24:MI')
  ) ELSE NULL END;

  RETURN jsonb_build_object(
    'suggested', to_jsonb(v_suggested),
    'source', v_source,
    'confidence', v_confidence,
    'reason', v_reason,
    'missing_count', GREATEST(0, 4 - v_n),
    'observed_days', COALESCE(v_pattern.observed_days, 0),
    'is_absent_covered', v_is_absent,
    'pattern', jsonb_build_object('observed', v_obs_array, 'schedule', v_sch_array)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.suggest_punches_for_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_punches_for_record(uuid) TO authenticated, service_role;

-- ── Fila nova: uma linha/um employee_id, sem resolver identidade outra vez ──
CREATE OR REPLACE VIEW public.v_time_pendings
WITH (security_invoker = true) AS
SELECT
  tr.id,
  tr.employee_external_id,
  tr.employee_name,
  tr.employee_id,
  e.department,
  tr.record_date,
  tr.punches,
  jsonb_array_length(tr.punches) AS punches_count,
  EXTRACT(isodow FROM tr.record_date)::integer AS dow,
  (CURRENT_DATE - tr.record_date) AS days_since,
  public.calculate_day_summary(
    tr.punches,
    COALESCE(public.get_employee_expected_minutes(tr.employee_id, tr.record_date), 0),
    COALESCE(ws.tolerance_minutes, 10),
    COALESCE(ws.minimum_overtime_minutes, 10),
    EXISTS (
      SELECT 1 FROM public.holidays h
      WHERE COALESCE(h.optional, false) = false
        AND (h.holiday_date = tr.record_date
          OR (COALESCE(h.recurring, false)
            AND to_char(h.holiday_date::timestamptz, 'MM-DD') = to_char(tr.record_date::timestamptz, 'MM-DD')))
    ),
    EXTRACT(isodow FROM tr.record_date)::integer BETWEEN 1 AND 5
  ) AS day_summary,
  CASE
    WHEN (CURRENT_DATE - tr.record_date) > 7 THEN 'overdue'
    WHEN (CURRENT_DATE - tr.record_date) > 3 THEN 'aging'
    ELSE 'fresh'
  END AS urgency,
  public.suggest_punches_for_record(tr.id) AS suggestion,
  (tr.employee_id IS NULL) AS employee_match_ambiguous
FROM public.time_records tr
LEFT JOIN public.employees e ON e.id = tr.employee_id
LEFT JOIN LATERAL (
  SELECT schedule.tolerance_minutes, schedule.minimum_overtime_minutes
  FROM public.work_schedules schedule
  WHERE schedule.id = e.work_schedule_id
     OR (e.work_schedule_id IS NULL AND schedule.is_default = true)
  ORDER BY ((schedule.id = e.work_schedule_id) IS TRUE) DESC,
           schedule.created_at,
           schedule.id
  LIMIT 1
) ws ON true
WHERE tr.record_date >= public.get_bank_hours_cutoff()
  AND tr.record_date >= CURRENT_DATE - INTERVAL '90 days'
  AND EXTRACT(isodow FROM tr.record_date) BETWEEN 1 AND 5
  AND COALESCE(e.payment_type, 'mensalista') <> 'producao'
  AND NOT EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE COALESCE(h.optional, false) = false
      AND (h.holiday_date = tr.record_date
        OR (COALESCE(h.recurring, false)
          AND to_char(h.holiday_date::timestamptz, 'MM-DD') = to_char(tr.record_date::timestamptz, 'MM-DD')))
  );

REVOKE ALL ON TABLE public.v_time_pendings FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.v_time_pendings TO authenticated, service_role;

COMMENT ON VIEW public.v_time_pendings IS
  'Pendências por time_records.employee_id. FK nula permanece visível, sem sugestão/autocorreção, até o cadastro ser resolvido.';

-- Preserva o detector de jornada curta da view viva; muda apenas identidade.
CREATE OR REPLACE VIEW public.v_pending_time_records
WITH (security_invoker = true) AS
WITH default_sched AS (
  SELECT * FROM public.work_schedules
  WHERE is_default = true
  ORDER BY created_at, id
  LIMIT 1
),
records_with_gap AS (
  SELECT
    tr.*,
    jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) AS pc,
    CASE WHEN jsonb_array_length(COALESCE(tr.punches, '[]'::jsonb)) = 2 THEN (
      (EXTRACT(HOUR FROM (tr.punches->>1)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>1)::time))
      - (EXTRACT(HOUR FROM (tr.punches->>0)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>0)::time))
      - CASE WHEN
          (EXTRACT(HOUR FROM (tr.punches->>0)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>0)::time)) <=
          (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60
            + EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time))
          AND
          (EXTRACT(HOUR FROM (tr.punches->>1)::time) * 60 + EXTRACT(MINUTE FROM (tr.punches->>1)::time)) >=
          (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60
            + EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
        THEN
          (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60
            + EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
          - (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60
            + EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time))
        ELSE 0 END
    )::integer ELSE NULL END AS net_minutes_if_2,
    (
      (EXTRACT(HOUR FROM (SELECT lunch_start FROM default_sched)::time) * 60
        + EXTRACT(MINUTE FROM (SELECT lunch_start FROM default_sched)::time))
      - (EXTRACT(HOUR FROM (SELECT entry_time FROM default_sched)::time) * 60
        + EXTRACT(MINUTE FROM (SELECT entry_time FROM default_sched)::time))
      + (EXTRACT(HOUR FROM (SELECT exit_time FROM default_sched)::time) * 60
        + EXTRACT(MINUTE FROM (SELECT exit_time FROM default_sched)::time))
      - (EXTRACT(HOUR FROM (SELECT lunch_end FROM default_sched)::time) * 60
        + EXTRACT(MINUTE FROM (SELECT lunch_end FROM default_sched)::time))
    )::integer AS expected_min
  FROM public.time_records tr
)
SELECT
  rwg.id AS time_record_id,
  rwg.employee_name,
  rwg.employee_external_id,
  rwg.employee_id,
  rwg.department,
  rwg.record_date,
  EXTRACT(ISODOW FROM rwg.record_date)::integer AS dow,
  rwg.punches,
  rwg.pc AS punch_count,
  CASE
    WHEN rwg.pc = 1 THEN 'somente_uma_batida'
    WHEN rwg.pc = 3 THEN 'falta_saida_apos_almoco'
    WHEN rwg.pc = 5 THEN 'batida_extra'
    WHEN rwg.pc % 2 <> 0 THEN 'punches_impar'
    WHEN rwg.pc = 2
      AND EXTRACT(ISODOW FROM rwg.record_date)::integer BETWEEN 1 AND 5
      AND rwg.net_minutes_if_2 IS NOT NULL
      AND rwg.expected_min > 0
      AND rwg.net_minutes_if_2 < (rwg.expected_min * 0.75)::integer
      THEN 'dia_incompleto_suspeito'
    ELSE NULL
  END AS issue_type,
  EXISTS (
    SELECT 1 FROM public.time_record_manual_overrides o WHERE o.time_record_id = rwg.id
  ) AS has_manual_override,
  (rwg.employee_id IS NULL) AS employee_match_ambiguous
FROM records_with_gap rwg
WHERE rwg.pc > 0
  AND (
    rwg.pc % 2 <> 0
    OR (
      rwg.pc = 2
      AND EXTRACT(ISODOW FROM rwg.record_date)::integer BETWEEN 1 AND 5
      AND rwg.net_minutes_if_2 IS NOT NULL
      AND rwg.expected_min > 0
      AND rwg.net_minutes_if_2 < (rwg.expected_min * 0.75)::integer
    )
  );

REVOKE ALL ON TABLE public.v_pending_time_records FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.v_pending_time_records TO authenticated, service_role;

COMMENT ON VIEW public.v_pending_time_records IS
  'Pendências de batida e jornada curta identificadas somente por time_records.employee_id; FK nula é não resolvida e nunca escolhida por nome/crachá.';

-- O diagnóstico antigo repetia um matcher textual e podia declarar uma linha
-- "resolvida" mesmo quando a FK canônica permanecia nula. O painel passa a
-- medir o vínculo realmente persistido e também detecta FK fora da vigência.
CREATE OR REPLACE FUNCTION public.timeclock_identity_report()
RETURNS TABLE(check_name text, severity text, item_count integer, sample text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  WITH uso_por_nome AS (
    SELECT
      employee_external_id AS cracha,
      lower(btrim(employee_name)) AS nome,
      min(record_date) AS de,
      max(record_date) AS ate
    FROM public.time_records
    WHERE COALESCE(employee_external_id, '') <> ''
      AND COALESCE(btrim(employee_name), '') <> ''
    GROUP BY 1, 2
  )
  SELECT
    'Ficha com cracha e SEM data de admissao (constraint furada)'::text,
    'alto'::text,
    count(*)::integer,
    COALESCE(string_agg(name, ', ' ORDER BY name), '—')::text
  FROM public.employees
  WHERE COALESCE(external_id, '') <> '' AND admission_date IS NULL

  UNION ALL
  SELECT
    'Cracha com ponto recente SEM vinculo canonico'::text,
    'alto'::text,
    count(*)::integer,
    COALESCE(string_agg(t.amostra, ', ' ORDER BY t.amostra), '—')::text
  FROM (
    SELECT DISTINCT tr.employee_external_id || ' (' || tr.employee_name || ')' AS amostra
    FROM public.time_records tr
    WHERE tr.employee_id IS NULL
      AND COALESCE(tr.employee_external_id, '') <> ''
      AND tr.record_date >= CURRENT_DATE - INTERVAL '90 days'
  ) t

  UNION ALL
  SELECT
    'Registro de ponto (90d) sem employee_id persistido'::text,
    'alto'::text,
    count(*)::integer,
    COALESCE(string_agg(DISTINCT employee_name, ', '), '—')::text
  FROM public.time_records
  WHERE employee_id IS NULL
    AND record_date >= CURRENT_DATE - INTERVAL '90 days'

  UNION ALL
  SELECT
    'Ficha ativa sem cracha do relogio'::text,
    'medio'::text,
    count(*)::integer,
    COALESCE(string_agg(name, ', ' ORDER BY name), '—')::text
  FROM public.employees
  WHERE active = true AND COALESCE(external_id, '') = ''

  UNION ALL
  SELECT
    'Cracha que trocou de dono (janelas disjuntas + nome distinto)'::text,
    'baixo'::text,
    count(*)::integer,
    COALESCE(string_agg(t.amostra, ', ' ORDER BY t.cracha), '—')::text
  FROM (
    SELECT
      a.cracha,
      a.cracha || ': ' || string_agg(DISTINCT
        CASE WHEN a.ate < b.de THEN a.nome || '→' || b.nome
             ELSE b.nome || '→' || a.nome END, ' / ') AS amostra
    FROM uso_por_nome a
    JOIN uso_por_nome b
      ON a.cracha = b.cracha
     AND a.nome < b.nome
     AND (a.ate < b.de OR b.ate < a.de)
     AND split_part(a.nome, ' ', 1) <> split_part(b.nome, ' ', 1)
    GROUP BY a.cracha
  ) t

  UNION ALL
  SELECT
    'Registro vinculado fora da vigencia da ficha'::text,
    'alto'::text,
    count(*)::integer,
    COALESCE(string_agg(DISTINCT e.name, ', '), '—')::text
  FROM public.time_records tr
  JOIN public.employees e ON e.id = tr.employee_id
  WHERE (e.admission_date IS NOT NULL AND tr.record_date < e.admission_date)
     OR (e.termination_date IS NOT NULL AND tr.record_date > e.termination_date)
$fn$;

REVOKE ALL ON FUNCTION public.timeclock_identity_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_identity_report() TO authenticated, service_role;

COMMENT ON FUNCTION public.timeclock_identity_report() IS
  'Saúde da identidade canônica do ponto. Mede time_records.employee_id persistido; matrícula/nome ficam apenas como evidência e nunca recalculam o dono.';

-- ── Escrita legada: mesma autorização e invariantes da correção canônica ─────
CREATE OR REPLACE FUNCTION public.complete_punches(
  p_time_record_id uuid,
  p_punches text[],
  p_reason text DEFAULT NULL
)
RETURNS public.time_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rec public.time_records%ROWTYPE;
  v_old_punches jsonb;
  v_new_punches jsonb;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_clean_punches text[];
  v_is_service boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF NOT v_is_service
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para corrigir o ponto.' USING ERRCODE = '42501';
  END IF;
  IF length(v_reason) < 4 THEN
    RAISE EXCEPTION 'Informe uma justificativa com pelo menos 4 caracteres.';
  END IF;

  SELECT * INTO v_rec
  FROM public.time_records
  WHERE id = p_time_record_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de ponto % não encontrado.', p_time_record_id;
  END IF;
  IF v_rec.employee_id IS NULL THEN
    RAISE EXCEPTION 'Vincule a matrícula a uma única ficha vigente antes de corrigir a batida.' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.timesheet_periods tp
    WHERE tp.status = 'fechado'
      AND v_rec.record_date BETWEEN tp.start_date AND tp.end_date
  ) THEN
    RAISE EXCEPTION 'O período de ponto desta data está fechado.' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payroll_runs pr
    WHERE pr.employee_id = v_rec.employee_id
      AND pr.status IN ('aprovado', 'pago')
      AND v_rec.record_date <@ public.payroll_period_range(pr.period)
  ) THEN
    RAISE EXCEPTION 'A folha desta data já foi fechada; a batida não pode ser alterada.' USING ERRCODE = '55000';
  END IF;

  IF p_punches IS NULL
     OR COALESCE(array_ndims(p_punches), 0) <> 1
     OR cardinality(p_punches) < 2
     OR cardinality(p_punches) % 2 <> 0
     OR cardinality(p_punches) > 12 THEN
    RAISE EXCEPTION 'Informe entre 2 e 12 batidas, sempre em pares.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_punches) p
    WHERE p IS NULL OR btrim(p) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]\*?$'
  ) THEN
    RAISE EXCEPTION 'Cada batida deve usar HH:MM entre 00:00 e 23:59.';
  END IF;

  SELECT array_agg(regexp_replace(btrim(p), '\*$', '') ORDER BY regexp_replace(btrim(p), '\*$', ''))
  INTO v_clean_punches
  FROM unnest(p_punches) p;
  IF (SELECT count(*) FROM unnest(v_clean_punches))
     <> (SELECT count(DISTINCT p) FROM unnest(v_clean_punches) p) THEN
    RAISE EXCEPTION 'A mesma batida não pode aparecer duas vezes.';
  END IF;

  v_old_punches := COALESCE(v_rec.punches, '[]'::jsonb);
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
  SELECT jsonb_agg(stored ORDER BY clean)
  INTO v_new_punches
  FROM resolved;

  IF v_new_punches = v_old_punches THEN
    RAISE EXCEPTION 'As batidas informadas são iguais às já registradas.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.time_records
  SET punches = v_new_punches
  WHERE id = p_time_record_id
  RETURNING * INTO v_rec;

  INSERT INTO public.time_record_manual_overrides (
    time_record_id, added_punch, position, action, reason, created_by,
    punches_before, punches_after
  ) VALUES (
    v_rec.id, NULL, NULL, 'replace', v_reason, auth.uid(),
    v_old_punches, v_new_punches
  );

  INSERT INTO public.weekly_balance_audit_log (
    snapshot_id, employee_id, week_start, action, reason, changed_by, metadata
  ) VALUES (
    NULL,
    v_rec.employee_id,
    date_trunc('week', v_rec.record_date)::date,
    'recompute',
    v_reason,
    auth.uid(),
    jsonb_build_object(
      'time_record_id', v_rec.id,
      'record_date', v_rec.record_date,
      'punches_before', v_old_punches,
      'punches_after', v_new_punches,
      'identity_source', 'time_records.employee_id'
    )
  );

  RETURN v_rec;
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_punches(uuid, text[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_punches(uuid, text[], text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.complete_punches(uuid, text[], text) IS
  'Substitui batidas sob autorização RH, lock, vínculo canônico, período/folha abertos e auditoria before/after; nunca altera import_batch.';

DO $migration_check$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_viewdef('public.v_time_pendings'::regclass, true) INTO v_definition;
  IF v_definition NOT LIKE '%e.id = tr.employee_id%'
     OR v_definition LIKE '%e.external_id = tr.employee_external_id%' THEN
    RAISE EXCEPTION 'v_time_pendings não usa exclusivamente employee_id';
  END IF;

  SELECT pg_get_viewdef('public.v_pending_time_records'::regclass, true) INTO v_definition;
  IF v_definition LIKE '%external_id =%employee_external_id%'
     OR v_definition LIKE '%lower(btrim(%employee_name%' THEN
    RAISE EXCEPTION 'v_pending_time_records ainda recalcula identidade textual';
  END IF;

  SELECT pg_get_functiondef('public.complete_punches(uuid,text[],text)'::regprocedure)
  INTO v_definition;
  IF v_definition NOT LIKE '%v_rec.employee_id%'
     OR v_definition NOT LIKE '%user_has_any_role%'
     OR v_definition LIKE '%import_batch =%' THEN
    RAISE EXCEPTION 'complete_punches não preserva a fronteira canônica';
  END IF;

  IF has_function_privilege('anon', 'public.complete_punches(uuid,text[],text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda executa complete_punches';
  END IF;

  SELECT pg_get_functiondef('public.timeclock_identity_report()'::regprocedure)
  INTO v_definition;
  IF v_definition NOT LIKE '%tr.employee_id IS NULL%'
     OR v_definition LIKE '%LEFT JOIN LATERAL%' THEN
    RAISE EXCEPTION 'timeclock_identity_report ainda recalcula identidade textual';
  END IF;
END;
$migration_check$;
