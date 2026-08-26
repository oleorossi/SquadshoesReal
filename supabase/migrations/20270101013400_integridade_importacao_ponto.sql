-- =============================================================================
-- Ponto — reparar drift do protocolo, identidade histórica e fronteiras de escrita
-- =============================================================================
-- Esta migration parte do schema VIVO: a tabela time_import_logs foi criada antes
-- da versão canônica e conservou tipos legados. Também recupera a migration antiga
-- de identidade por crachá que nunca entrou no histórico remoto, preservando antes
-- a trilha de correções manuais das 68 duplicidades existentes.

-- A view depende dos tipos que serão normalizados abaixo.
DROP VIEW IF EXISTS public.v_time_import_archive;

-- Falhar fechado antes de qualquer cast: não arredondar contagem nem aceitar data/
-- UUID inválidos em silêncio se uma importação acontecer durante o deploy.
DO $validate_legacy_log$
DECLARE
  v_bad_column text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.time_import_logs
    WHERE imported_by IS NOT NULL
      AND btrim(imported_by::text) <> ''
      AND imported_by::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'time_import_logs.imported_by contém UUID inválido';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.time_import_logs
    WHERE start_date IS NOT NULL
      AND btrim(start_date::text) <> ''
      AND start_date::text !~ '^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$'
  ) OR EXISTS (
    SELECT 1 FROM public.time_import_logs
    WHERE end_date IS NOT NULL
      AND btrim(end_date::text) <> ''
      AND end_date::text !~ '^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$'
  ) THEN
    RAISE EXCEPTION 'time_import_logs contém data fora do formato ISO';
  END IF;

  FOREACH v_bad_column IN ARRAY ARRAY[
    'inserted_count', 'updated_count', 'skipped_count',
    'error_count', 'total_rows'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM public.time_import_logs l
      WHERE CASE v_bad_column
        WHEN 'inserted_count' THEN l.inserted_count
        WHEN 'updated_count' THEN l.updated_count
        WHEN 'skipped_count' THEN l.skipped_count
        WHEN 'error_count' THEN l.error_count
        ELSE l.total_rows
      END IS NULL
      OR CASE v_bad_column
        WHEN 'inserted_count' THEN l.inserted_count
        WHEN 'updated_count' THEN l.updated_count
        WHEN 'skipped_count' THEN l.skipped_count
        WHEN 'error_count' THEN l.error_count
        ELSE l.total_rows
      END < 0
      OR trunc(CASE v_bad_column
        WHEN 'inserted_count' THEN l.inserted_count
        WHEN 'updated_count' THEN l.updated_count
        WHEN 'skipped_count' THEN l.skipped_count
        WHEN 'error_count' THEN l.error_count
        ELSE l.total_rows
      END) IS DISTINCT FROM CASE v_bad_column
        WHEN 'inserted_count' THEN l.inserted_count
        WHEN 'updated_count' THEN l.updated_count
        WHEN 'skipped_count' THEN l.skipped_count
        WHEN 'error_count' THEN l.error_count
        ELSE l.total_rows
      END
      OR CASE v_bad_column
        WHEN 'inserted_count' THEN l.inserted_count
        WHEN 'updated_count' THEN l.updated_count
        WHEN 'skipped_count' THEN l.skipped_count
        WHEN 'error_count' THEN l.error_count
        ELSE l.total_rows
      END > 2147483647
    ) THEN
      RAISE EXCEPTION 'time_import_logs.% contém contagem inválida', v_bad_column;
    END IF;
  END LOOP;
END
$validate_legacy_log$;

ALTER TABLE public.time_import_logs
  ALTER COLUMN imported_by TYPE uuid
    USING NULLIF(btrim(imported_by::text), '')::uuid,
  ALTER COLUMN start_date TYPE date
    USING NULLIF(btrim(start_date::text), '')::date,
  ALTER COLUMN end_date TYPE date
    USING NULLIF(btrim(end_date::text), '')::date,
  ALTER COLUMN inserted_count TYPE integer USING inserted_count::integer,
  ALTER COLUMN updated_count TYPE integer USING updated_count::integer,
  ALTER COLUMN skipped_count TYPE integer USING skipped_count::integer,
  ALTER COLUMN error_count TYPE integer USING error_count::integer,
  ALTER COLUMN total_rows TYPE integer USING total_rows::integer;

ALTER TABLE public.time_import_logs
  ADD COLUMN IF NOT EXISTS payload_sha256 text,
  ADD COLUMN IF NOT EXISTS coverage_scope text,
  ADD COLUMN IF NOT EXISTS covered_employee_external_ids text[],
  ALTER COLUMN inserted_count SET DEFAULT 0,
  ALTER COLUMN updated_count SET DEFAULT 0,
  ALTER COLUMN skipped_count SET DEFAULT 0,
  ALTER COLUMN error_count SET DEFAULT 0,
  ALTER COLUMN total_rows SET DEFAULT 0,
  ALTER COLUMN status SET DEFAULT 'processing';

-- Protocolos antigos não provam se o arquivo continha todo o quadro ou apenas
-- uma seleção do relógio. Eles permanecem consultáveis, mas nunca podem fechar
-- a cobertura global da folha sem uma nova importação explicitamente atestada.
UPDATE public.time_import_logs
SET coverage_scope = 'legacy_unverified'
WHERE coverage_scope IS NULL;

UPDATE public.time_import_logs
SET covered_employee_external_ids = ARRAY[]::text[]
WHERE covered_employee_external_ids IS NULL;

ALTER TABLE public.time_import_logs
  ALTER COLUMN coverage_scope SET DEFAULT 'listed_employees',
  ALTER COLUMN coverage_scope SET NOT NULL,
  ALTER COLUMN covered_employee_external_ids SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN covered_employee_external_ids SET NOT NULL;

ALTER TABLE public.time_import_logs
  ALTER COLUMN inserted_count SET NOT NULL,
  ALTER COLUMN updated_count SET NOT NULL,
  ALTER COLUMN skipped_count SET NOT NULL,
  ALTER COLUMN error_count SET NOT NULL,
  ALTER COLUMN total_rows SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.time_import_logs
  DROP CONSTRAINT IF EXISTS time_import_logs_imported_by_fkey,
  DROP CONSTRAINT IF EXISTS time_import_logs_status_check,
  DROP CONSTRAINT IF EXISTS time_import_logs_counts_check,
  DROP CONSTRAINT IF EXISTS time_import_logs_period_check,
  DROP CONSTRAINT IF EXISTS time_import_logs_payload_sha256_check,
  DROP CONSTRAINT IF EXISTS time_import_logs_coverage_scope_check;

ALTER TABLE public.time_import_logs
  ADD CONSTRAINT time_import_logs_status_check
    CHECK (status IN ('processing', 'success', 'partial', 'error')),
  ADD CONSTRAINT time_import_logs_counts_check
    CHECK (inserted_count >= 0 AND updated_count >= 0 AND skipped_count >= 0
           AND error_count >= 0 AND total_rows >= 0),
  ADD CONSTRAINT time_import_logs_period_check
    CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date),
  ADD CONSTRAINT time_import_logs_payload_sha256_check
    CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT time_import_logs_coverage_scope_check
    CHECK (coverage_scope IN ('all_employees', 'listed_employees', 'legacy_unverified'));

COMMENT ON COLUMN public.time_import_logs.payload_sha256 IS
  'SHA-256 do JSONB processado. Permite retry idempotente e impede reutilizar o arquivo com outro payload.';
COMMENT ON COLUMN public.time_import_logs.imported_by IS
  'UUID imutável do autor no momento da importação. Sem FK de propósito: excluir a conta Auth não apaga nem bloqueia a trilha histórica.';
COMMENT ON COLUMN public.time_import_logs.coverage_scope IS
  'Escopo atestado: all_employees pode comprovar cobertura financeira após validar o quadro e a matrícula alvo; listed_employees importa batidas sem fabricar faltas nem fechar cobertura; legacy_unverified nunca comprova cobertura.';
COMMENT ON COLUMN public.time_import_logs.covered_employee_external_ids IS
  'Matrículas declaradas no arquivo no instante do protocolo. Imutável e independente de alterações futuras no cadastro.';

CREATE OR REPLACE FUNCTION public.guard_time_import_archive_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
      RAISE EXCEPTION 'Usuário sem permissão para criar protocolo de ponto.' USING ERRCODE = '42501';
    END IF;
    IF NEW.coverage_scope NOT IN ('all_employees', 'listed_employees') THEN
      RAISE EXCEPTION 'Informe se o arquivo cobre todo o quadro ou somente funcionários selecionados.'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.coverage_scope = 'all_employees'
       AND cardinality(NEW.covered_employee_external_ids) = 0 THEN
      RAISE EXCEPTION 'Um arquivo declarado como quadro completo precisa identificar ao menos uma matrícula.'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM unnest(NEW.covered_employee_external_ids) external_id
      WHERE NULLIF(btrim(external_id), '') IS NULL
         OR external_id IS DISTINCT FROM btrim(external_id)
    ) OR cardinality(NEW.covered_employee_external_ids) IS DISTINCT FROM (
      SELECT count(DISTINCT btrim(external_id))::integer
      FROM unnest(NEW.covered_employee_external_ids) external_id
    ) THEN
      RAISE EXCEPTION 'A lista de matrículas cobertas contém valor vazio ou duplicado.'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.start_date > NEW.end_date THEN
      RAISE EXCEPTION 'Novo protocolo precisa informar um período válido e imutável.'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.coverage_scope = 'all_employees' AND EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE NULLIF(btrim(COALESCE(e.external_id, '')), '') IS NOT NULL
        AND (COALESCE(e.active, false) OR e.termination_date IS NOT NULL)
        AND COALESCE(e.admission_date, '-infinity'::date) <= LEAST(
          NEW.end_date,
          (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date
        )
        AND COALESCE(e.termination_date, 'infinity'::date) >= NEW.start_date
        AND NOT (
          NEW.covered_employee_external_ids
          && regexp_split_to_array(btrim(e.external_id), '\s*,\s*')
        )
    ) THEN
      RAISE EXCEPTION 'O arquivo declarado como quadro completo não contém todas as matrículas vigentes no período. Use funcionários selecionados ou exporte novamente sem filtro.'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.status IS DISTINCT FROM 'processing'
       OR NEW.archive_status IS DISTINCT FROM 'pending'
       OR NEW.archived_at IS NOT NULL
       OR NEW.payload_sha256 IS NOT NULL
       OR NEW.period_id IS NOT NULL
       OR COALESCE(NEW.inserted_count, 0) <> 0
       OR COALESCE(NEW.updated_count, 0) <> 0
       OR COALESCE(NEW.skipped_count, 0) <> 0
       OR COALESCE(NEW.error_count, 0) <> 0
       OR NULLIF(btrim(COALESCE(NEW.file_path, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Novo protocolo deve nascer pendente, sem resultado e com path do arquivo.'
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
      NEW.imported_by := auth.uid();
      NEW.created_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'O histórico de arquivos de ponto é permanente e não pode ser excluído.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.coverage_scope IS DISTINCT FROM OLD.coverage_scope
     OR NEW.covered_employee_external_ids IS DISTINCT FROM OLD.covered_employee_external_ids
     OR NEW.imported_by IS DISTINCT FROM OLD.imported_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A identidade de uma importação de ponto é imutável.';
  END IF;

  -- A cobertura financeira usa este instante como teto. Ele precisa vir do
  -- relógio do banco, nunca do computador do usuário (que pode estar atrasado
  -- ou adiantado). Como o trigger é BEFORE UPDATE, o valor informado pelo
  -- cliente é deliberadamente substituído na transição de confirmação.
  IF OLD.archive_status = 'pending' AND NEW.archive_status = 'available' THEN
    NEW.archived_at := clock_timestamp();
  END IF;

  IF OLD.archive_status <> 'pending'
     AND (
       NEW.file_path IS DISTINCT FROM OLD.file_path
       OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
       OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
       OR NEW.archive_status IS DISTINCT FROM OLD.archive_status
      OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     ) THEN
    RAISE EXCEPTION 'O arquivo original de uma importação de ponto é imutável.';
  END IF;

  IF OLD.status IN ('success', 'partial', 'error') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Uma importação finalizada é imutável.';
  END IF;

  IF OLD.status = 'processing'
     AND NEW.status IN ('success', 'partial')
     AND current_setting('app.timesheet_log_finalize', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Somente o importador transacional pode finalizar um protocolo.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

-- Recupera no histórico os arquivos que já estavam preservados no Storage. As
-- contagens de processamento antigas não podem ser reconstruídas com segurança;
-- por isso o estado é partial e a observação é explícita.
INSERT INTO public.time_import_logs (
  file_name, file_path, file_size_bytes, mime_type, batch_id,
  start_date, end_date, inserted_count, updated_count, skipped_count,
  error_count, total_rows, status, imported_by, created_at,
  archive_status, archived_at, notes, period_id,
  coverage_scope, covered_employee_external_ids
)
SELECT
  regexp_replace(o.name, '^.*/', ''),
  o.name,
  CASE WHEN (o.metadata->>'size') ~ '^\d+$' THEN (o.metadata->>'size')::bigint ELSE NULL END,
  NULLIF(o.metadata->>'mimetype', ''),
  split_part(o.name, '/', 1),
  substring(split_part(o.name, '/', 1) FROM 1 FOR 10)::date,
  substring(split_part(o.name, '/', 1) FROM 12 FOR 10)::date,
  0, 0, 0, 0,
  (SELECT count(*)::integer FROM public.time_records tr
    WHERE tr.import_batch = split_part(o.name, '/', 1)),
  'partial',
  (SELECT u.id FROM auth.users u WHERE u.id::text = o.owner_id LIMIT 1),
  o.created_at,
  'available',
  o.created_at,
  'Histórico reconstruído do arquivo bruto legado; contagens originais indisponíveis.',
  (SELECT tp.id FROM public.timesheet_periods tp
    WHERE tp.start_date = substring(split_part(o.name, '/', 1) FROM 1 FOR 10)::date
      AND tp.end_date = substring(split_part(o.name, '/', 1) FROM 12 FOR 10)::date
    LIMIT 1),
  'legacy_unverified',
  ARRAY[]::text[]
FROM storage.objects o
WHERE o.bucket_id = 'timesheet-imports'
  AND split_part(o.name, '/', 1)
      ~ '^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])_\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])_[0-9]+'
  AND NOT EXISTS (
    SELECT 1 FROM public.time_import_logs l
    WHERE l.file_path = o.name OR l.batch_id = split_part(o.name, '/', 1)
  );

-- O backfill acima precisa rodar antes de o INSERT passar pelo guard de autoria
-- do browser. A partir daqui, todo protocolo novo nasce pelo fluxo autenticado.
DROP TRIGGER IF EXISTS trg_guard_time_import_archive_immutability ON public.time_import_logs;
CREATE TRIGGER trg_guard_time_import_archive_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.time_import_logs
FOR EACH ROW EXECUTE FUNCTION public.guard_time_import_archive_immutability();

CREATE UNIQUE INDEX IF NOT EXISTS uq_time_import_logs_batch_id
  ON public.time_import_logs (batch_id) WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_import_logs_file_path
  ON public.time_import_logs (file_path) WHERE file_path IS NOT NULL;

-- Quarentena é a fronteira entre "arquivo preservado" e "batida apta à folha".
-- Uma matrícula não resolvida nunca entra em time_records, mas permanece acionável.
CREATE TABLE IF NOT EXISTS public.time_import_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_log_id uuid NOT NULL REFERENCES public.time_import_logs(id) ON DELETE RESTRICT,
  batch_id text NOT NULL,
  employee_external_id text NOT NULL,
  employee_name text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  record_date date NOT NULL,
  punches jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolution_status text NOT NULL DEFAULT 'pending',
  resolution_reason text,
  resolved_at timestamptz,
  resolved_by uuid,
  time_record_id uuid REFERENCES public.time_records(id) ON DELETE SET NULL,
  CONSTRAINT time_import_quarantine_punches_check
    CHECK (jsonb_typeof(punches) = 'array'),
  CONSTRAINT time_import_quarantine_resolution_state_check CHECK (
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
  )
);

ALTER TABLE public.time_import_quarantine
  DROP CONSTRAINT IF EXISTS time_import_quarantine_resolved_by_fkey;
COMMENT ON COLUMN public.time_import_quarantine.resolved_by IS
  'UUID histórico de quem resolveu a quarentena; sem FK para preservar a autoria após exclusão da conta Auth.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_time_import_quarantine_log_identity_date
  ON public.time_import_quarantine (import_log_id, employee_external_id, record_date);
CREATE INDEX IF NOT EXISTS idx_time_import_quarantine_open
  ON public.time_import_quarantine (record_date DESC, employee_external_id)
  WHERE resolution_status = 'pending';

ALTER TABLE public.time_import_quarantine ENABLE ROW LEVEL SECURITY;

-- ── Identidade canônica e consolidação segura ───────────────────────────────
LOCK TABLE public.time_records IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.time_record_manual_overrides IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.time_record_manual_overrides
  DROP CONSTRAINT IF EXISTS time_record_manual_overrides_created_by_fkey;
COMMENT ON COLUMN public.time_record_manual_overrides.created_by IS
  'UUID histórico do autor da correção; sem FK para que a exclusão da conta Auth não apague a trilha.';

DO $assert_duplicate_punches$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.time_records tr
    GROUP BY COALESCE(NULLIF(btrim(tr.employee_external_id), ''), 'nome:' || btrim(tr.employee_name)),
             tr.record_date
    HAVING count(*) > 1 AND count(DISTINCT tr.punches::text) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicidades de ponto têm batidas divergentes; consolidação manual obrigatória';
  END IF;
END
$assert_duplicate_punches$;

CREATE TEMP TABLE _time_record_dedup ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    tr.id,
    first_value(tr.id) OVER (
      PARTITION BY COALESCE(NULLIF(btrim(tr.employee_external_id), ''), 'nome:' || btrim(tr.employee_name)),
                   tr.record_date
      ORDER BY EXISTS (
        SELECT 1 FROM public.time_record_manual_overrides mo WHERE mo.time_record_id = tr.id
      ) DESC,
      tr.created_at DESC,
      tr.id DESC
    ) AS winner_id,
    row_number() OVER (
      PARTITION BY COALESCE(NULLIF(btrim(tr.employee_external_id), ''), 'nome:' || btrim(tr.employee_name)),
                   tr.record_date
      ORDER BY EXISTS (
        SELECT 1 FROM public.time_record_manual_overrides mo WHERE mo.time_record_id = tr.id
      ) DESC,
      tr.created_at DESC,
      tr.id DESC
    ) AS rn
  FROM public.time_records tr
)
SELECT id AS loser_id, winner_id FROM ranked WHERE rn > 1;

UPDATE public.time_record_manual_overrides mo
SET time_record_id = d.winner_id
FROM _time_record_dedup d
WHERE mo.time_record_id = d.loser_id;

DELETE FROM public.time_records tr
USING _time_record_dedup d
WHERE tr.id = d.loser_id;

ALTER TABLE public.time_records
  DROP CONSTRAINT IF EXISTS time_records_employee_date_unique;
DROP INDEX IF EXISTS public.time_records_employee_date_unique;
DROP INDEX IF EXISTS public.time_records_identity_date_unique;
CREATE UNIQUE INDEX time_records_identity_date_unique
  ON public.time_records (
    (COALESCE(NULLIF(btrim(employee_external_id), ''), 'nome:' || btrim(employee_name))),
    record_date
  );

COMMENT ON INDEX public.time_records_identity_date_unique IS
  'Uma linha por matrícula do relógio + data; nome é fallback exclusivo de lançamento sem matrícula.';

CREATE OR REPLACE FUNCTION public.resolve_time_record_employee_id(
  p_external_id text,
  p_employee_name text,
  p_record_date date
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_employee_id uuid;
  v_count integer;
BEGIN
  IF NULLIF(btrim(COALESCE(p_external_id, '')), '') IS NOT NULL THEN
    SELECT (array_agg(e.id ORDER BY e.id))[1], count(*)::integer
      INTO v_employee_id, v_count
    FROM public.employees e
    WHERE btrim(p_external_id) = ANY (
            regexp_split_to_array(COALESCE(e.external_id, ''), '\s*,\s*')
          )
      AND (e.admission_date IS NULL OR p_record_date >= e.admission_date)
      AND (e.termination_date IS NULL OR p_record_date <= e.termination_date);

    -- O mapa manual só complementa a matrícula quando aponta para uma ficha
    -- vigente. Nunca atravessa a reciclagem histórica do crachá.
    IF v_count = 0 THEN
      SELECT (array_agg(e.id ORDER BY e.id))[1], count(*)::integer
        INTO v_employee_id, v_count
      FROM public.punch_device_map m
      JOIN public.employees e ON e.id = m.employee_id
      WHERE m.device_id = btrim(p_external_id)
        AND m.status = 'vinculado'
        AND (e.admission_date IS NULL OR p_record_date >= e.admission_date)
        AND (e.termination_date IS NULL OR p_record_date <= e.termination_date);
    END IF;
  ELSE
    SELECT (array_agg(e.id ORDER BY e.id))[1], count(*)::integer
      INTO v_employee_id, v_count
    FROM public.employees e
    WHERE lower(btrim(e.name)) = lower(btrim(COALESCE(p_employee_name, '')))
      AND btrim(COALESCE(p_employee_name, '')) <> ''
      AND (e.admission_date IS NULL OR p_record_date >= e.admission_date)
      AND (e.termination_date IS NULL OR p_record_date <= e.termination_date);
  END IF;

  RETURN CASE WHEN v_count = 1 THEN v_employee_id ELSE NULL END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_time_record_employee_id(text, text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_time_record_employee_id(text, text, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_time_record_employee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  NEW.employee_id := public.resolve_time_record_employee_id(
    NEW.employee_external_id,
    NEW.employee_name,
    NEW.record_date
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_resolve_tr_employee ON public.time_records;
CREATE TRIGGER trg_resolve_tr_employee
BEFORE INSERT OR UPDATE OF employee_external_id, employee_name, record_date, employee_id
ON public.time_records
FOR EACH ROW EXECUTE FUNCTION public.resolve_time_record_employee();

UPDATE public.time_records tr
SET employee_id = public.resolve_time_record_employee_id(
  tr.employee_external_id,
  tr.employee_name,
  tr.record_date
)
WHERE tr.employee_id IS DISTINCT FROM public.resolve_time_record_employee_id(
  tr.employee_external_id,
  tr.employee_name,
  tr.record_date
);

-- Uma fonte financeira já congelada não pode ser reescrita por reimportação,
-- edição direta, bulk correction ou exclusão de lote.
CREATE OR REPLACE FUNCTION public.tg_guard_time_record_closed_payroll()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- UPDATE precisa proteger tanto a origem quanto o destino. Checar somente NEW
  -- permitiria mover uma batida já congelada para fora do período e apagar a
  -- fonte histórica da folha.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.employee_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.payroll_runs pr
    WHERE pr.employee_id = OLD.employee_id
      AND pr.status IN ('aprovado', 'pago')
      AND OLD.record_date <@ public.payroll_period_range(pr.period)
  ) THEN
    RAISE EXCEPTION 'O ponto de % pertence a uma folha fechada e não pode ser alterado.', OLD.record_date
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.employee_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.payroll_runs pr
    WHERE pr.employee_id = NEW.employee_id
      AND pr.status IN ('aprovado', 'pago')
      AND NEW.record_date <@ public.payroll_period_range(pr.period)
  ) THEN
    RAISE EXCEPTION 'O ponto de % pertence a uma folha fechada e não pode ser alterado.', NEW.record_date
      USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_zz_guard_time_record_closed_payroll ON public.time_records;
CREATE TRIGGER trg_zz_guard_time_record_closed_payroll
BEFORE INSERT OR UPDATE OR DELETE ON public.time_records
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_time_record_closed_payroll();

-- O audit genérico já suporta INSERT; o trigger antigo não o chamava.
DROP TRIGGER IF EXISTS tg_audit_time_records ON public.time_records;
CREATE TRIGGER tg_audit_time_records
AFTER INSERT OR UPDATE OR DELETE ON public.time_records
FOR EACH ROW EXECUTE FUNCTION public.tg_audit_time_records();

-- ── Importador interno e protocolo one-shot ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_time_records_safe(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  rec jsonb;
  v_identity text;
  v_record_date date;
  v_existing_id uuid;
  v_existing_punches jsonb;
  v_employee_id uuid;
  ins_count integer := 0;
  upd_count integer := 0;
  skp_count integer := 0;
  v_lock record;
BEGIN
  -- Endpoint interno: a wrapper autenticada valida papel, arquivo e payload.
  IF current_setting('app.timesheet_import_authorized', true) IS DISTINCT FROM 'on'
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Use o protocolo de importação de ponto.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(records, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Payload de ponto inválido: records deve ser um array.';
  END IF;

  -- Todos os mutexes vêm antes do primeiro DML e em ordem estável. Dois arquivos
  -- sobrepostos em ordens diferentes não podem formar o ciclo E1→E2 / E2→E1.
  FOR v_lock IN
    SELECT DISTINCT
      COALESCE(
        NULLIF(btrim(value->>'employee_external_id'), ''),
        'nome:' || btrim(COALESCE(value->>'employee_name', ''))
      ) AS identity_key,
      (value->>'record_date')::date AS record_date
    FROM jsonb_array_elements(COALESCE(records, '[]'::jsonb))
    ORDER BY identity_key, record_date
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_lock.identity_key || '|' || v_lock.record_date::text, 0)
    );
  END LOOP;

  FOR rec IN SELECT value FROM jsonb_array_elements(COALESCE(records, '[]'::jsonb))
  LOOP
    v_record_date := (rec->>'record_date')::date;
    v_employee_id := NULLIF(rec->>'employee_id', '')::uuid;
    v_identity := COALESCE(
      NULLIF(btrim(rec->>'employee_external_id'), ''),
      'nome:' || btrim(COALESCE(rec->>'employee_name', ''))
    );
    SELECT tr.id, tr.punches
      INTO v_existing_id, v_existing_punches
    FROM public.time_records tr
    WHERE COALESCE(NULLIF(btrim(tr.employee_external_id), ''), 'nome:' || btrim(tr.employee_name)) = v_identity
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
      );
      ins_count := ins_count + 1;
    ELSE
      UPDATE public.time_records
      SET employee_name = COALESCE(NULLIF(btrim(rec->>'employee_name'), ''), employee_name),
          employee_external_id = COALESCE(NULLIF(btrim(rec->>'employee_external_id'), ''), employee_external_id),
          department = COALESCE(NULLIF(btrim(rec->>'department'), ''), department),
          punches = public.merge_time_record_punches(v_existing_punches, rec->'punches'),
          import_batch = rec->>'import_batch',
          employee_id = v_employee_id
      WHERE id = v_existing_id;
      upd_count := upd_count + 1;
    END IF;
    v_existing_id := NULL;
    v_existing_punches := NULL;
  END LOOP;

  RETURN jsonb_build_object('inserted', ins_count, 'updated', upd_count, 'skipped', skp_count);
END;
$fn$;

REVOKE ALL ON FUNCTION public.import_time_records_safe(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_time_records_safe(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.import_time_records_with_archive(
  records jsonb,
  p_log_id uuid,
  p_pre_skipped integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_log public.time_import_logs%ROWTYPE;
  v_period_id uuid;
  v_period_status text;
  v_hash text;
  v_result jsonb;
  v_accepted jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  rec jsonb;
  punch text;
  v_date date;
  v_employee_id uuid;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := GREATEST(COALESCE(p_pre_skipped, 0), 0);
  v_unmatched integer := 0;
  v_total integer;
  v_is_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_previous_finalize text := COALESCE(current_setting('app.timesheet_log_finalize', true), '');
BEGIN
  IF NOT v_is_service
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar o ponto.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(records, 'null'::jsonb)) <> 'array'
     OR jsonb_array_length(records) = 0
     OR jsonb_array_length(records) > 50000 THEN
    RAISE EXCEPTION 'Payload de ponto deve conter entre 1 e 50.000 registros.';
  END IF;

  -- O total pré-descartado integra o comando: o mesmo array com outra contagem
  -- produz outro recibo e não pode ser aceito como replay idempotente.
  v_hash := encode(extensions.digest(
    jsonb_build_object(
      'records', records,
      'pre_skipped', GREATEST(COALESCE(p_pre_skipped, 0), 0)
    )::text,
    'sha256'
  ), 'hex');
  SELECT * INTO v_log
  FROM public.time_import_logs
  WHERE id = p_log_id
  FOR UPDATE;

  IF NOT FOUND OR v_log.archive_status <> 'available'
     OR (NOT v_is_service AND v_log.imported_by IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'O arquivo original precisa estar arquivado pelo mesmo usuário antes das batidas.';
  END IF;
  IF v_log.file_path IS NULL OR NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'timesheet-imports'
      AND o.name = v_log.file_path
      AND (v_is_service OR o.owner_id::text = v_log.imported_by::text)
  ) THEN
    RAISE EXCEPTION 'O protocolo não possui um arquivo original confirmado no armazenamento.';
  END IF;

  IF v_log.status IN ('success', 'partial') THEN
    IF v_log.payload_sha256 = v_hash THEN
      RETURN jsonb_build_object(
        'inserted', v_log.inserted_count,
        'updated', v_log.updated_count,
        'skipped', v_log.skipped_count,
        'unmatched', v_log.error_count,
        'total', v_log.total_rows,
        'idempotent', true
      );
    END IF;
    RAISE EXCEPTION 'Este protocolo já foi finalizado com outro payload.' USING ERRCODE = '55000';
  END IF;
  IF v_log.status <> 'processing' THEN
    RAISE EXCEPTION 'Protocolo não está disponível para processamento (status: %).', v_log.status;
  END IF;
  IF v_log.start_date IS NULL OR v_log.end_date IS NULL OR v_log.batch_id IS NULL THEN
    RAISE EXCEPTION 'Protocolo sem período ou lote operacional.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT btrim(value->>'employee_external_id') AS external_id
      FROM jsonb_array_elements(records)
      WHERE NULLIF(btrim(COALESCE(value->>'employee_external_id', '')), '') IS NOT NULL
    ) payload_employee
    WHERE NOT payload_employee.external_id = ANY(v_log.covered_employee_external_ids)
  ) THEN
    RAISE EXCEPTION 'O payload contém matrícula fora do escopo imutável do protocolo.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.timesheet_periods (label, start_date, end_date, created_by)
  VALUES (
    to_char(v_log.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_log.end_date, 'DD/MM/YYYY'),
    v_log.start_date,
    v_log.end_date,
    auth.uid()
  )
  ON CONFLICT (start_date, end_date) DO NOTHING
  RETURNING id, status INTO v_period_id, v_period_status;

  IF v_period_id IS NULL THEN
    SELECT id, status INTO v_period_id, v_period_status
    FROM public.timesheet_periods
    WHERE start_date = v_log.start_date AND end_date = v_log.end_date
    FOR SHARE;
  END IF;
  IF v_period_status = 'fechado' THEN
    RAISE EXCEPTION 'O período de ponto está fechado e não aceita reimportação.' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        COALESCE(NULLIF(btrim(value->>'employee_external_id'), ''),
                 'nome:' || btrim(COALESCE(value->>'employee_name', ''))) AS identity,
        value->>'record_date' AS record_date,
        count(*)
      FROM jsonb_array_elements(records)
      WHERE CASE
        WHEN jsonb_typeof(value->'punches') = 'array'
          THEN jsonb_array_length(value->'punches') > 0
        ELSE false
      END
      GROUP BY 1, 2
      HAVING count(*) > 1
    ) duplicate
  ) THEN
    RAISE EXCEPTION 'O payload contém a mesma matrícula/data mais de uma vez.';
  END IF;

  FOR rec IN SELECT value FROM jsonb_array_elements(records)
  LOOP
    IF jsonb_typeof(rec) <> 'object' THEN
      RAISE EXCEPTION 'Registro de ponto inválido: cada item deve ser um objeto.';
    END IF;
    IF jsonb_typeof(rec->'punches') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Batidas inválidas para %: punches deve ser array.', COALESCE(rec->>'employee_name', '?');
    END IF;
    IF jsonb_array_length(rec->'punches') = 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      v_date := (rec->>'record_date')::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Data inválida no arquivo: %', COALESCE(rec->>'record_date', '<vazia>');
    END;
    IF v_date < v_log.start_date OR v_date > v_log.end_date THEN
      RAISE EXCEPTION 'Data % está fora do período arquivado (% a %).', v_date, v_log.start_date, v_log.end_date;
    END IF;
    IF v_date > LEAST(
      v_log.end_date,
      (COALESCE(v_log.archived_at, v_log.created_at) AT TIME ZONE 'America/Sao_Paulo')::date,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ) THEN
      RAISE EXCEPTION 'Data % é futura em relação ao arquivamento do arquivo e não pode virar batida.', v_date
        USING ERRCODE = '22023';
    END IF;

    FOR punch IN SELECT value FROM jsonb_array_elements_text(rec->'punches')
    LOOP
      IF punch IS NULL OR punch !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'Horário inválido no arquivo: %', punch;
      END IF;
    END LOOP;

    IF NULLIF(btrim(COALESCE(rec->>'employee_external_id', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Registro importado com batidas sem matrícula do relógio (%).', COALESCE(rec->>'employee_name', '?');
    END IF;

    v_employee_id := public.resolve_time_record_employee_id(
      rec->>'employee_external_id', rec->>'employee_name', v_date
    );
    IF v_employee_id IS NULL THEN
      INSERT INTO public.time_import_quarantine (
        import_log_id, batch_id, employee_external_id, employee_name,
        department, record_date, punches, reason
      ) VALUES (
        v_log.id,
        v_log.batch_id,
        btrim(rec->>'employee_external_id'),
        btrim(COALESCE(rec->>'employee_name', '')),
        btrim(COALESCE(rec->>'department', '')),
        v_date,
        rec->'punches',
        'Matrícula sem uma única ficha vigente na data.'
      )
      ON CONFLICT (import_log_id, employee_external_id, record_date)
      DO NOTHING;
      v_unmatched := v_unmatched + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', btrim(rec->>'employee_external_id') || ' · ' || v_date::text,
        'error', 'Matrícula sem uma única ficha vigente na data; linha mantida em quarentena.'
      ));
      CONTINUE;
    END IF;

    v_accepted := v_accepted || jsonb_build_array(
      rec || jsonb_build_object(
        'employee_id', v_employee_id,
        'import_batch', v_log.batch_id,
        'record_date', v_date::text
      )
    );
  END LOOP;

  PERFORM set_config('app.timesheet_import_authorized', 'on', true);
  v_result := public.import_time_records_safe(v_accepted);
  v_inserted := COALESCE((v_result->>'inserted')::integer, 0);
  v_updated := COALESCE((v_result->>'updated')::integer, 0);
  v_skipped := v_skipped + COALESCE((v_result->>'skipped')::integer, 0);
  v_total := jsonb_array_length(records) + GREATEST(COALESCE(p_pre_skipped, 0), 0);

  PERFORM set_config('app.timesheet_log_finalize', 'on', true);
  UPDATE public.time_import_logs
  SET inserted_count = v_inserted,
      updated_count = v_updated,
      skipped_count = v_skipped,
      error_count = v_unmatched,
      total_rows = v_total,
      status = CASE WHEN v_unmatched > 0 THEN 'partial' ELSE 'success' END,
      error_messages = v_errors,
      notes = CASE WHEN v_unmatched > 0
        THEN format('%s linha(s) mantida(s) em quarentena; demais batidas processadas.', v_unmatched)
        ELSE 'Arquivo original preservado e processamento concluído.' END,
      payload_sha256 = v_hash,
      period_id = v_period_id
  WHERE id = v_log.id;
  PERFORM set_config('app.timesheet_log_finalize', v_previous_finalize, true);

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'unmatched', v_unmatched,
    'total', v_total,
    'idempotent', false
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.import_time_records_with_archive(jsonb, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_time_records_with_archive(jsonb, uuid, integer)
  TO authenticated, service_role;

-- Depois de corrigir a matrícula ou a vigência em Pessoas, o RH reaplica uma
-- linha da quarentena pelo mesmo motor canônico. A linha original permanece
-- como trilha e ganha o vínculo exato com o registro efetivamente gravado.
CREATE OR REPLACE FUNCTION public.resolve_time_import_quarantine(
  p_quarantine_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_quarantine public.time_import_quarantine%ROWTYPE;
  v_log public.time_import_logs%ROWTYPE;
  v_employee_id uuid;
  v_time_record_id uuid;
  v_period_status text;
  v_result jsonb;
  v_previous_authorized text := COALESCE(current_setting('app.timesheet_import_authorized', true), '');
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para resolver a quarentena do ponto.'
      USING ERRCODE = '42501';
  END IF;
  IF p_quarantine_id IS NULL THEN
    RAISE EXCEPTION 'Informe a pendência da quarentena.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_quarantine
  FROM public.time_import_quarantine
  WHERE id = p_quarantine_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pendência da quarentena não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_quarantine.resolution_status = 'linked' THEN
    RETURN jsonb_build_object(
      'resolved', true,
      'idempotent', true,
      'quarantine_id', v_quarantine.id,
      'time_record_id', v_quarantine.time_record_id
    );
  END IF;
  IF v_quarantine.resolution_status = 'dismissed' THEN
    RAISE EXCEPTION 'Esta linha foi classificada como externa ao quadro e não pode ser vinculada por uma tela desatualizada.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_log
  FROM public.time_import_logs
  WHERE id = v_quarantine.import_log_id;
  IF NOT FOUND OR v_log.archive_status <> 'available'
     OR v_log.status NOT IN ('success', 'partial') THEN
    RAISE EXCEPTION 'O protocolo da pendência não está finalizado com arquivo disponível.'
      USING ERRCODE = '55000';
  END IF;
  IF v_log.period_id IS NOT NULL THEN
    SELECT tp.status INTO v_period_status
    FROM public.timesheet_periods tp
    WHERE tp.id = v_log.period_id
    FOR SHARE;
  END IF;
  IF v_period_status = 'fechado' THEN
    RAISE EXCEPTION 'O período de ponto está fechado e não aceita resolução de quarentena.'
      USING ERRCODE = '55000';
  END IF;

  v_employee_id := public.resolve_time_record_employee_id(
    v_quarantine.employee_external_id,
    v_quarantine.employee_name,
    v_quarantine.record_date
  );
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'A matrícula % ainda não possui uma única ficha vigente em %. Corrija o cadastro de Pessoas e tente novamente.',
      v_quarantine.employee_external_id, v_quarantine.record_date
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.timesheet_import_authorized', 'on', true);
  v_result := public.import_time_records_safe(jsonb_build_array(jsonb_build_object(
    'employee_external_id', v_quarantine.employee_external_id,
    'employee_name', v_quarantine.employee_name,
    'department', v_quarantine.department,
    'record_date', v_quarantine.record_date::text,
    'punches', v_quarantine.punches,
    'employee_id', v_employee_id,
    'import_batch', v_quarantine.batch_id
  )));
  PERFORM set_config('app.timesheet_import_authorized', v_previous_authorized, true);

  SELECT tr.id INTO v_time_record_id
  FROM public.time_records tr
  WHERE btrim(tr.employee_external_id) = btrim(v_quarantine.employee_external_id)
    AND tr.record_date = v_quarantine.record_date
    AND tr.employee_id = v_employee_id
  FOR SHARE;
  IF v_time_record_id IS NULL THEN
    RAISE EXCEPTION 'A resolução não produziu o registro canônico esperado.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.time_import_quarantine
  SET resolution_status = 'linked',
      resolution_reason = NULL,
      resolved_at = now(),
      resolved_by = auth.uid(),
      time_record_id = v_time_record_id
  WHERE id = v_quarantine.id;

  RETURN jsonb_build_object(
    'resolved', true,
    'idempotent', false,
    'quarantine_id', v_quarantine.id,
    'time_record_id', v_time_record_id,
    'employee_id', v_employee_id,
    'inserted', COALESCE((v_result->>'inserted')::integer, 0),
    'updated', COALESCE((v_result->>'updated')::integer, 0)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_time_import_quarantine(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_time_import_quarantine(uuid)
  TO authenticated, service_role;

-- ── Correção manual serializada, autorizada e auditável ─────────────────────
CREATE OR REPLACE FUNCTION public.apply_manual_punch_completion(
  p_time_record_id uuid,
  p_punch_time time,
  p_reason text DEFAULT 'completed-by-rh'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_record public.time_records%ROWTYPE;
  v_old_punches jsonb;
  v_new_punches jsonb;
  v_position integer;
  v_punch_clean text := to_char(p_punch_time, 'HH24:MI');
  v_punch_marked text := to_char(p_punch_time, 'HH24:MI') || '*';
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para corrigir o ponto.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa da correção manual.';
  END IF;

  SELECT * INTO v_record
  FROM public.time_records
  WHERE id = p_time_record_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de ponto % não encontrado.', p_time_record_id;
  END IF;
  IF v_record.employee_id IS NULL THEN
    RAISE EXCEPTION 'Vincule a matrícula a uma ficha vigente antes de corrigir a batida.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payroll_runs pr
    WHERE pr.employee_id = v_record.employee_id
      AND pr.status IN ('aprovado', 'pago')
      AND v_record.record_date <@ public.payroll_period_range(pr.period)
  ) THEN
    RAISE EXCEPTION 'A folha desta data já foi fechada; a batida não pode ser alterada.' USING ERRCODE = '55000';
  END IF;

  v_old_punches := COALESCE(v_record.punches, '[]'::jsonb);
  IF jsonb_array_length(v_old_punches) % 2 = 0 THEN
    RAISE EXCEPTION 'Este dia já possui pares completos de batidas; não há pendência para complementar.'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_old_punches) p(value)
    WHERE left(regexp_replace(p.value, '[*\"]', '', 'g'), 5) = v_punch_clean
  ) THEN
    RAISE EXCEPTION 'A batida % já existe neste dia.', v_punch_clean;
  END IF;

  SELECT jsonb_agg(value ORDER BY left(regexp_replace(value, '[*\"]', '', 'g'), 5))
  INTO v_new_punches
  FROM jsonb_array_elements_text(v_old_punches || jsonb_build_array(v_punch_marked));

  SELECT (p.ordinality - 1)::integer
  INTO v_position
  FROM jsonb_array_elements_text(v_new_punches) WITH ORDINALITY AS p(value, ordinality)
  WHERE p.value = v_punch_marked
  ORDER BY p.ordinality
  LIMIT 1;

  UPDATE public.time_records SET punches = v_new_punches WHERE id = p_time_record_id;
  INSERT INTO public.time_record_manual_overrides (
    time_record_id, added_punch, position, reason, created_by,
    punches_before, punches_after
  ) VALUES (
    p_time_record_id, p_punch_time, v_position,
    btrim(p_reason), auth.uid(), v_old_punches, v_new_punches
  );

  RETURN jsonb_build_object(
    'success', true,
    'time_record_id', p_time_record_id,
    'punches_before', v_old_punches,
    'punches_after', v_new_punches,
    'new_punch_count', jsonb_array_length(v_new_punches)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_manual_punch_completion(uuid, time, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_manual_punch_completion(uuid, time, text)
  TO authenticated, service_role;

-- A view final usa security_invoker; seus SELECTs respeitam as policies abaixo.
CREATE VIEW public.v_time_import_archive
WITH (security_invoker = true)
AS
SELECT
  tif.id,
  tif.file_name,
  tif.file_path,
  tif.file_size_bytes,
  tif.mime_type,
  tif.batch_id,
  tif.start_date AS period_start,
  tif.end_date AS period_end,
  CASE WHEN tif.start_date IS NOT NULL AND tif.end_date IS NOT NULL
    THEN tif.end_date - tif.start_date + 1 ELSE NULL END AS period_days,
  tif.inserted_count,
  tif.updated_count,
  tif.skipped_count,
  tif.error_count,
  tif.total_rows,
  tif.status,
  tif.imported_by,
  tif.created_at,
  (SELECT count(*) FROM public.time_records tr WHERE tr.import_batch = tif.batch_id) AS active_record_count,
  (tif.archive_status = 'available') AS has_archived_file,
  tif.archive_status,
  tif.archived_at
FROM public.time_import_logs tif;

REVOKE ALL ON TABLE public.v_time_import_archive FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.v_time_import_archive TO authenticated, service_role;

-- ── RLS: dados de ponto e documentos de RH só para admin/gerente/rh ────────
DROP POLICY IF EXISTS approved_select ON public.time_import_logs;
DROP POLICY IF EXISTS approved_insert ON public.time_import_logs;
DROP POLICY IF EXISTS approved_update ON public.time_import_logs;
DROP POLICY IF EXISTS "Approved users can view import logs" ON public.time_import_logs;
DROP POLICY IF EXISTS "Approved users can insert import logs" ON public.time_import_logs;
DROP POLICY IF EXISTS "Approved users can delete import logs" ON public.time_import_logs;
DROP POLICY IF EXISTS time_import_logs_rh_select ON public.time_import_logs;
DROP POLICY IF EXISTS time_import_logs_rh_insert ON public.time_import_logs;
DROP POLICY IF EXISTS time_import_logs_rh_update ON public.time_import_logs;
CREATE POLICY time_import_logs_rh_select ON public.time_import_logs
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));
CREATE POLICY time_import_logs_rh_insert ON public.time_import_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_any_role(ARRAY['admin', 'gerente', 'rh'])
    AND imported_by = auth.uid()
  );
CREATE POLICY time_import_logs_rh_update ON public.time_import_logs
  FOR UPDATE TO authenticated
  USING (
    public.user_has_any_role(ARRAY['admin', 'gerente', 'rh'])
    AND imported_by = auth.uid()
  )
  WITH CHECK (
    public.user_has_any_role(ARRAY['admin', 'gerente', 'rh'])
    AND imported_by = auth.uid()
  );

DROP POLICY IF EXISTS time_import_quarantine_rh_select ON public.time_import_quarantine;
CREATE POLICY time_import_quarantine_rh_select ON public.time_import_quarantine
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.time_import_quarantine
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "All authenticated can view manual overrides" ON public.time_record_manual_overrides;
DROP POLICY IF EXISTS "RH roles can insert manual overrides" ON public.time_record_manual_overrides;
DROP POLICY IF EXISTS "RH roles can update manual overrides" ON public.time_record_manual_overrides;
DROP POLICY IF EXISTS "RH roles can delete manual overrides" ON public.time_record_manual_overrides;
CREATE POLICY time_record_manual_overrides_rh_select ON public.time_record_manual_overrides
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));
REVOKE INSERT, UPDATE, DELETE ON public.time_record_manual_overrides
  FROM PUBLIC, anon, authenticated;

-- TRUNCATE ignora RLS e triggers por linha. Nenhum cliente precisa dessa
-- capacidade sobre a fonte do ponto ou sua trilha permanente.
REVOKE TRUNCATE ON TABLE
  public.time_records,
  public.time_import_logs,
  public.time_import_quarantine,
  public.time_record_manual_overrides,
  public.timesheet_periods
FROM PUBLIC, anon, authenticated;

-- Um arquivo finalizado é evidência permanente e também define a cobertura da
-- folha. Apagar as linhas manteria o protocolo verde sem as batidas e levaria
-- junto os overrides por CASCADE. Correção ocorre por UPDATE auditado/RPC.
REVOKE DELETE ON TABLE public.time_records
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS timesheet_imports_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS timesheet_imports_authenticated_select ON storage.objects;
DROP POLICY IF EXISTS timesheet_imports_rh_insert ON storage.objects;
DROP POLICY IF EXISTS timesheet_imports_rh_select ON storage.objects;
CREATE POLICY timesheet_imports_rh_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'timesheet-imports'
    AND public.user_has_any_role(ARRAY['admin', 'gerente', 'rh'])
  );
CREATE POLICY timesheet_imports_rh_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'timesheet-imports'
    AND public.user_has_any_role(ARRAY['admin', 'gerente', 'rh'])
  );

-- A função antiga está sem consumidor e vazava adiantamentos por SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.get_payroll_inputs_for_period(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_inputs_for_period(uuid, text) TO service_role;

-- Ratificações executáveis: a migration aborta se qualquer P0 estrutural voltar.
DO $migration_check$
DECLARE
  v_duplicate_count integer;
  v_bad_link_count integer;
BEGIN
  SELECT count(*) INTO v_duplicate_count
  FROM (
    SELECT 1 FROM public.time_records
    GROUP BY COALESCE(NULLIF(btrim(employee_external_id), ''), 'nome:' || btrim(employee_name)), record_date
    HAVING count(*) > 1
  ) d;
  IF v_duplicate_count <> 0 THEN
    RAISE EXCEPTION 'Ainda existem % identidades/data duplicadas no ponto', v_duplicate_count;
  END IF;

  SELECT count(*) INTO v_bad_link_count
  FROM public.time_records tr
  JOIN public.employees e ON e.id = tr.employee_id
  WHERE (e.admission_date IS NOT NULL AND tr.record_date < e.admission_date)
     OR (e.termination_date IS NOT NULL AND tr.record_date > e.termination_date);
  IF v_bad_link_count <> 0 THEN
    RAISE EXCEPTION 'Ainda existem % vínculos de ponto fora da vigência', v_bad_link_count;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'time_import_logs' AND column_name = 'imported_by')
      IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'time_import_logs.imported_by deveria ser uuid';
  END IF;
END
$migration_check$;
