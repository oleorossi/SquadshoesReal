-- =============================================================================
-- PDF async queue: bucket pdf-queue + tabela pdf_render_jobs
-- =============================================================================
-- HTML do job mora no Storage (TTL curto / limpeza pós-render). Não reusa
-- print_jobs (auditoria de etiqueta). Path: {user_id}/{job_id}.html|.pdf
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pdf-queue',
  'pdf-queue',
  false,
  20971520,
  ARRAY['text/html', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS pdf_queue_select_own ON storage.objects;
CREATE POLICY pdf_queue_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'pdf-queue'
    AND public.is_approved_user()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS pdf_queue_insert_own ON storage.objects;
CREATE POLICY pdf_queue_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pdf-queue'
    AND public.is_approved_user()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS pdf_queue_update_own ON storage.objects;
CREATE POLICY pdf_queue_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'pdf-queue'
    AND public.is_approved_user()
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'pdf-queue'
    AND public.is_approved_user()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS pdf_queue_delete_own ON storage.objects;
CREATE POLICY pdf_queue_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'pdf-queue'
    AND public.is_approved_user()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE TABLE IF NOT EXISTS public.pdf_render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'rendering', 'ready', 'failed')),
  storage_path text NOT NULL,
  pdf_storage_path text,
  filename text NOT NULL DEFAULT 'documento',
  landscape boolean NOT NULL DEFAULT false,
  print_job_id uuid REFERENCES public.print_jobs (id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pdf_render_jobs_user_created
  ON public.pdf_render_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdf_render_jobs_status_created
  ON public.pdf_render_jobs (status, created_at)
  WHERE status IN ('pending', 'rendering', 'ready');

COMMENT ON TABLE public.pdf_render_jobs IS
  'Fila de render PDF (etiquetas/fichas/fotos). HTML em storage pdf-queue; distinto de print_jobs.';

ALTER TABLE public.pdf_render_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pdf_render_jobs_select_own ON public.pdf_render_jobs;
CREATE POLICY pdf_render_jobs_select_own ON public.pdf_render_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_approved_user());

DROP POLICY IF EXISTS pdf_render_jobs_insert_own ON public.pdf_render_jobs;
CREATE POLICY pdf_render_jobs_insert_own ON public.pdf_render_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_approved_user());

DROP POLICY IF EXISTS pdf_render_jobs_update_own ON public.pdf_render_jobs;
CREATE POLICY pdf_render_jobs_update_own ON public.pdf_render_jobs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_approved_user())
  WITH CHECK (user_id = auth.uid() AND public.is_approved_user());

DROP POLICY IF EXISTS pdf_render_jobs_delete_own ON public.pdf_render_jobs;
CREATE POLICY pdf_render_jobs_delete_own ON public.pdf_render_jobs
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_approved_user());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdf_render_jobs TO authenticated;
