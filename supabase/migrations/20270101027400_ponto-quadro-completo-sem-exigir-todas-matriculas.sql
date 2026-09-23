-- ============================================================================
-- Importação "Todo o quadro": matrículas ausentes no arquivo NÃO bloqueiam o
-- protocolo. Decisão do dono (grill 23/09/2026): quem é vigente no período e
-- não veio no arquivo conta como falta/ausência via cobertura do intervalo
-- confirmado (start_date..end_date), nunca como erro de import.
--
-- Antes: guard_time_import_archive_immutability recusava all_employees se
-- qualquer employees.external_id vigente faltasse em covered_employee_external_ids.
-- Sintoma: export RegistroPresença.xls / AGL da 1ª quinzena (01–15) não salvava
-- quando alguém estava de férias/atestado/sem batida.
-- ============================================================================

COMMENT ON COLUMN public.time_import_logs.coverage_scope IS
  'Escopo atestado: all_employees fecha a cobertura financeira do período declarado (faltas para quem não bateu); listed_employees importa batidas sem fabricar faltas nem fechar cobertura; legacy_unverified nunca comprova cobertura.';

CREATE OR REPLACE FUNCTION public.guard_time_import_archive_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Sem checagem de "todas as matrículas vigentes": ausência no arquivo,
    -- com coverage_scope=all_employees, vira falta na folha pela cobertura do período.
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
$function$;
