-- Motivo específico na quarentena de ponto (espelha explainEmployeeMatchFailure no TS).
-- Antes tudo caía em "Matrícula sem uma única ficha vigente na data.", escondendo
-- se faltava ficha, se a admissão era posterior à batida, ou se havia ambiguidade.
--
-- Estratégia: função de diagnóstico + BEFORE INSERT na quarentena. Assim qualquer
-- caminho que ainda grave o texto legado (import_time_records_with_archive e
-- reescritas futuras) recebe o motivo específico sem depender o corpo enorme
-- do importador a cada mudança.

CREATE OR REPLACE FUNCTION public.explain_time_import_match_failure(
  p_external_id text,
  p_employee_name text,
  p_record_date date
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_external text := NULLIF(btrim(COALESCE(p_external_id, '')), '');
  v_count integer;
  v_vigente integer;
  v_name text;
  v_admission date;
  v_termination date;
BEGIN
  IF v_external IS NOT NULL THEN
    SELECT count(*)::integer
      INTO v_count
    FROM public.employees e
    WHERE v_external = ANY (
            regexp_split_to_array(COALESCE(e.external_id, ''), '\s*,\s*')
          );

    IF v_count = 0 THEN
      RETURN format(
        'Nenhuma ficha com ID do relógio %s. Cadastre em Pessoas com essa matrícula.',
        v_external
      );
    END IF;

    SELECT count(*)::integer
      INTO v_vigente
    FROM public.employees e
    WHERE v_external = ANY (
            regexp_split_to_array(COALESCE(e.external_id, ''), '\s*,\s*')
          )
      AND (e.admission_date IS NULL OR p_record_date >= e.admission_date)
      AND (e.termination_date IS NULL OR p_record_date <= e.termination_date);

    IF v_vigente > 1 THEN
      RETURN format(
        'Há %s fichas vigentes com ID %s na data. Ajuste admissão/demissão ou a matrícula para deixar uma só.',
        v_vigente, v_external
      );
    END IF;

    IF v_vigente = 0 THEN
      SELECT e.name, e.admission_date, e.termination_date
        INTO v_name, v_admission, v_termination
      FROM public.employees e
      WHERE v_external = ANY (
              regexp_split_to_array(COALESCE(e.external_id, ''), '\s*,\s*')
            )
      ORDER BY e.admission_date DESC NULLS LAST, e.id
      LIMIT 1;

      RETURN format(
        'ID %s = %s, mas a ficha não está vigente em %s (admissão %s%s).',
        v_external,
        COALESCE(v_name, '?'),
        to_char(p_record_date, 'DD/MM/YYYY'),
        COALESCE(to_char(v_admission, 'DD/MM/YYYY'), '—'),
        CASE
          WHEN v_termination IS NULL THEN ''
          ELSE format(', demissão %s', to_char(v_termination, 'DD/MM/YYYY'))
        END
      );
    END IF;

    -- v_vigente = 1: o resolver principal deveria ter casado. Mantém o texto legado
    -- só como rede de segurança se houver drift entre as duas funções.
    RETURN 'Matrícula sem uma única ficha vigente na data.';
  END IF;

  IF NULLIF(btrim(COALESCE(p_employee_name, '')), '') IS NULL THEN
    RETURN 'Arquivo sem matrícula do relógio. Sem ID não há vínculo seguro para a folha.';
  END IF;

  RETURN format(
    'Nenhuma ficha vigente casa com o nome "%s".',
    btrim(p_employee_name)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.explain_time_import_match_failure(text, text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.explain_time_import_match_failure(text, text, date)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_enrich_time_import_quarantine_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.reason IS NULL
     OR NEW.reason = 'Matrícula sem uma única ficha vigente na data.' THEN
    NEW.reason := public.explain_time_import_match_failure(
      NEW.employee_external_id,
      NEW.employee_name,
      NEW.record_date
    );
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enrich_time_import_quarantine_reason
  ON public.time_import_quarantine;
CREATE TRIGGER trg_enrich_time_import_quarantine_reason
BEFORE INSERT ON public.time_import_quarantine
FOR EACH ROW
EXECUTE FUNCTION public.tg_enrich_time_import_quarantine_reason();

-- Também grava o motivo específico direto no importador, para o error_messages
-- do protocolo e para não depender só do trigger.
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
  v_reason text;
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
      v_reason := public.explain_time_import_match_failure(
        rec->>'employee_external_id', rec->>'employee_name', v_date
      );
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
        v_reason
      )
      ON CONFLICT (import_log_id, employee_external_id, record_date)
      DO NOTHING;
      v_unmatched := v_unmatched + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', btrim(rec->>'employee_external_id') || ' · ' || v_date::text,
        'error', v_reason || '; linha mantida em quarentena.'
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
