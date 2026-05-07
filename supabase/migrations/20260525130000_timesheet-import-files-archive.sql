-- =============================================================================
-- Timesheet — arquivamento do arquivo bruto na importação + bucket Storage
-- =============================================================================
-- ANTES: useImportTimeRecords descartava o arquivo XLSX/TXT após o parse —
-- nada permanecia, então não era possível auditar uma importação no futuro.
-- Já existe `time_import_logs` (migration 20260430210127) com file_name +
-- batch_id + counts; falta apenas o vínculo com o arquivo binário.
--
-- AGORA:
--   #1 Estende time_import_logs com file_path/file_size/mime_type apontando
--      pro Supabase Storage. Idempotente.
--   #2 Cria bucket privado `timesheet-imports` com RLS authenticated +
--      whitelist de MIME types.
--   #3 Storage policies pra approved users.
--
-- A consulta de uma data já FUNCIONA hoje sem batch — useTimeRecords aceita
-- só (startDate, endDate). A UI é que força batch desnecessariamente; isso
-- é fix puramente de frontend (sem migration).
-- =============================================================================

-- ─── #1 Estende time_import_logs (idempotente) ──────────────────────────
ALTER TABLE public.time_import_logs
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT;

COMMENT ON COLUMN public.time_import_logs.file_path IS
  'Path no bucket timesheet-imports (formato: {batch_id}/{file_name}). NULL pra '
  'imports históricos pré-arquivamento ou se o upload falhou.';

COMMENT ON COLUMN public.time_import_logs.file_size_bytes IS
  'Tamanho do arquivo em bytes — usado pra exibir na UI sem precisar consultar '
  'o storage. Pode estar NULL pra imports legados.';

COMMENT ON COLUMN public.time_import_logs.mime_type IS
  'MIME type do arquivo (xlsx, vnd.openxml, text/plain, text/csv).';

-- ─── #2 Bucket privado timesheet-imports ────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'timesheet-imports',
  'timesheet-imports',
  false,
  10485760, -- 10 MB
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/plain',
    'text/csv',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public = false;

-- ─── #3 Storage RLS policies ────────────────────────────────────────────
DROP POLICY IF EXISTS "timesheet_imports_authenticated_select" ON storage.objects;
CREATE POLICY "timesheet_imports_authenticated_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'timesheet-imports' AND public.is_approved_user());

DROP POLICY IF EXISTS "timesheet_imports_authenticated_insert" ON storage.objects;
CREATE POLICY "timesheet_imports_authenticated_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'timesheet-imports' AND public.is_approved_user());

DROP POLICY IF EXISTS "timesheet_imports_authenticated_delete" ON storage.objects;
CREATE POLICY "timesheet_imports_authenticated_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'timesheet-imports' AND public.is_approved_user());

-- ─── #4 View de auditoria (junta logs com vital info) ──────────────────
DROP VIEW IF EXISTS public.v_time_import_archive;
CREATE VIEW public.v_time_import_archive AS
SELECT
  tif.id,
  tif.file_name,
  tif.file_path,
  tif.file_size_bytes,
  tif.mime_type,
  tif.batch_id,
  tif.start_date AS period_start,
  tif.end_date   AS period_end,
  CASE
    WHEN tif.start_date IS NOT NULL
     AND tif.end_date IS NOT NULL
     AND NULLIF(tif.start_date::text, '') IS NOT NULL
     AND NULLIF(tif.end_date::text, '')   IS NOT NULL
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
  -- Quantos registros REAIS sobraram após eventuais delete_batch
  (SELECT COUNT(*) FROM public.time_records tr WHERE tr.import_batch = tif.batch_id) AS active_record_count,
  -- Sinaliza se o arquivo bruto está disponível no bucket
  (tif.file_path IS NOT NULL) AS has_archived_file
FROM public.time_import_logs tif
ORDER BY tif.created_at DESC;

GRANT SELECT ON public.v_time_import_archive TO authenticated;

COMMENT ON VIEW public.v_time_import_archive IS
  'Histórico de importações com vínculo ao arquivo bruto no Storage. '
  'has_archived_file=false indica imports legados (pré arquivamento) ou que '
  'o upload falhou — registros estão no banco mas o XLSX/TXT original sumiu.';
