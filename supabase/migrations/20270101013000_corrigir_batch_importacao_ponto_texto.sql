-- =============================================================================
-- Ponto — alinhar o lote operacional textual entre batidas, arquivo e histórico
-- =============================================================================
-- A tabela legada já existia quando a migration 20260430210127 executou o
-- CREATE TABLE IF NOT EXISTS. Por isso produção manteve batch_id como UUID,
-- embora time_records.import_batch e o contrato da aplicação usem o formato
-- textual YYYY-MM-DD_YYYY-MM-DD_timestamp.

-- A view depende do tipo da coluna e precisa ser recriada ao alterá-lo.
DROP VIEW IF EXISTS public.v_time_import_archive;

ALTER TABLE public.time_import_logs
  ALTER COLUMN batch_id TYPE text
  USING batch_id::text;

COMMENT ON COLUMN public.time_import_logs.batch_id IS
  'Lote operacional no formato YYYY-MM-DD_YYYY-MM-DD_timestamp; espelha '
  'time_records.import_batch e identifica a pasta do arquivo no Storage.';

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
   WHERE tr.import_batch = tif.batch_id) AS active_record_count,
  (tif.archive_status = 'available') AS has_archived_file,
  tif.archive_status,
  tif.archived_at
FROM public.time_import_logs tif;

REVOKE ALL ON TABLE public.v_time_import_archive
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.v_time_import_archive
  TO authenticated, service_role;

COMMENT ON VIEW public.v_time_import_archive IS
  'Histórico permanente de importações do ponto. A view respeita o RLS das '
  'tabelas de origem e correlaciona o lote textual com as batidas ativas.';

DO $migration_check$
DECLARE
  v_batch_type text;
BEGIN
  SELECT c.data_type
  INTO v_batch_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'time_import_logs'
    AND c.column_name = 'batch_id';

  IF v_batch_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'time_import_logs.batch_id deveria ser text; tipo encontrado: %',
      COALESCE(v_batch_type, '<ausente>');
  END IF;
END
$migration_check$;
