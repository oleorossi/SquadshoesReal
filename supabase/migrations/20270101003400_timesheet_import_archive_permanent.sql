-- =============================================================================
-- Ponto — arquivo bruto obrigatório, histórico permanente e fechamento atômico
-- =============================================================================

ALTER TABLE public.time_import_logs
  ADD COLUMN IF NOT EXISTS archive_status text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

UPDATE public.time_import_logs
SET archive_status = CASE WHEN file_path IS NOT NULL THEN 'available' ELSE 'legacy' END
WHERE archive_status IS NULL;

ALTER TABLE public.time_import_logs
  ALTER COLUMN archive_status SET DEFAULT 'pending',
  ALTER COLUMN archive_status SET NOT NULL;

ALTER TABLE public.time_import_logs
  DROP CONSTRAINT IF EXISTS time_import_logs_archive_status_check;

ALTER TABLE public.time_import_logs
  ADD CONSTRAINT time_import_logs_archive_status_check
  CHECK (archive_status IN ('pending', 'available', 'failed', 'legacy'));

UPDATE public.time_import_logs
SET archived_at = COALESCE(archived_at, created_at)
WHERE archive_status = 'available' AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_import_logs_archive_status_created_at
  ON public.time_import_logs (archive_status, created_at DESC);

COMMENT ON COLUMN public.time_import_logs.archive_status IS
  'Estado do original: pending durante o upload, available quando preservado, '
  'failed quando o armazenamento falhou e legacy para registros anteriores ao arquivo bruto.';

COMMENT ON COLUMN public.time_import_logs.archived_at IS
  'Momento em que o Storage confirmou a preservação do arquivo original.';

CREATE OR REPLACE VIEW public.v_time_import_archive AS
SELECT
  tif.id,
  tif.file_name,
  tif.file_path,
  tif.file_size_bytes,
  tif.mime_type,
  tif.batch_id,
  tif.start_date AS period_start,
  tif.end_date AS period_end,
  CASE
    WHEN tif.start_date IS NOT NULL AND tif.end_date IS NOT NULL
    THEN (tif.end_date::date - tif.start_date::date + 1)
    ELSE NULL
  END AS period_days,
  tif.inserted_count,
  tif.updated_count,
  tif.skipped_count,
  tif.error_count,
  tif.total_rows,
  tif.status,
  tif.imported_by,
  tif.created_at,
  (SELECT COUNT(*)
   FROM public.time_records tr
   WHERE tr.import_batch::text = tif.batch_id::text) AS active_record_count,
  (tif.archive_status = 'available') AS has_archived_file,
  tif.archive_status,
  tif.archived_at
FROM public.time_import_logs tif;

GRANT SELECT ON public.v_time_import_archive TO authenticated;

COMMENT ON VIEW public.v_time_import_archive IS
  'Histórico permanente de importações do ponto. has_archived_file só é true '
  'depois que o Storage confirma a preservação do original.';

-- A aplicação pode finalizar contagens/status, mas não pode trocar a identidade
-- nem o binário de um protocolo depois que o arquivo ficou disponível.
CREATE OR REPLACE FUNCTION public.guard_time_import_archive_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'O histórico de arquivos de ponto é permanente e não pode ser excluído.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A identidade de uma importação de ponto é imutável.';
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_time_import_archive_immutability ON public.time_import_logs;
CREATE TRIGGER trg_guard_time_import_archive_immutability
BEFORE UPDATE OR DELETE ON public.time_import_logs
FOR EACH ROW EXECUTE FUNCTION public.guard_time_import_archive_immutability();

-- Retira da aplicação qualquer caminho de exclusão do protocolo ou do binário.
DROP POLICY IF EXISTS "Approved users can delete import logs" ON public.time_import_logs;
DROP POLICY IF EXISTS "approved_delete" ON public.time_import_logs;
DROP POLICY IF EXISTS "timesheet_imports_authenticated_delete" ON storage.objects;

-- Insere as batidas e fecha o protocolo na mesma transação do banco. Se uma
-- das duas etapas falhar, nenhuma batida parcial é confirmada.
CREATE OR REPLACE FUNCTION public.import_time_records_with_archive(
  records jsonb,
  p_log_id uuid,
  p_pre_skipped integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_rpc_skipped integer := 0;
  v_skipped integer := GREATEST(COALESCE(p_pre_skipped, 0), 0);
  v_total integer := COALESCE(jsonb_array_length(records), 0) + v_skipped;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para importar o ponto.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.time_import_logs
    WHERE id = p_log_id
      AND imported_by = auth.uid()
      AND archive_status = 'available'
  ) THEN
    RAISE EXCEPTION 'O arquivo original precisa estar arquivado antes das batidas.';
  END IF;

  v_result := public.import_time_records_safe(COALESCE(records, '[]'::jsonb));
  v_inserted := COALESCE((v_result->>'inserted')::integer, 0);
  v_updated := COALESCE((v_result->>'updated')::integer, 0);
  v_rpc_skipped := COALESCE((v_result->>'skipped')::integer, 0);
  v_skipped := v_skipped + v_rpc_skipped;

  UPDATE public.time_import_logs
  SET inserted_count = v_inserted,
      updated_count = v_updated,
      skipped_count = v_skipped,
      error_count = 0,
      total_rows = v_total,
      status = 'success',
      error_messages = '[]'::jsonb,
      notes = 'Arquivo original preservado e processamento concluído.'
  WHERE id = p_log_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O protocolo da importação não foi encontrado.';
  END IF;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_time_records_with_archive(jsonb, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_time_records_with_archive(jsonb, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.import_time_records_with_archive(jsonb, uuid, integer) IS
  'Aplica batidas somente quando o original está arquivado e fecha o histórico '
  'na mesma transação dos registros de ponto.';
