-- =============================================================================
-- Ponto — arquivo como entrada; cadastro/calendário como fonte operacional
-- =============================================================================
-- Reimportar o mesmo dia precisa atualizar a base interna. A aplicação antiga
-- removia as chaves já existentes antes da RPC, então uma batida nova do arquivo
-- nunca chegava aqui. A RPC continua idempotente por (identidade do relógio,data),
-- agora com contagem correta de INSERT/UPDATE e preservação das correções manuais.

CREATE OR REPLACE FUNCTION public.merge_time_record_punches(
  p_existing jsonb,
  p_incoming jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  WITH incoming_base AS (
    SELECT
      value AS raw,
      left(regexp_replace(value, '[*"]', '', 'g'), 5) AS punch_key,
      ordinality AS ord
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_incoming) = 'array' THEN p_incoming ELSE '[]'::jsonb END
    ) WITH ORDINALITY
  ),
  incoming AS (
    SELECT DISTINCT ON (punch_key) raw, punch_key, ord
    FROM incoming_base
    WHERE punch_key <> ''
    ORDER BY punch_key, ord DESC
  ),
  existing_manual_base AS (
    SELECT
      value AS raw,
      left(regexp_replace(value, '[*"]', '', 'g'), 5) AS punch_key,
      ordinality AS ord
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_existing) = 'array' THEN p_existing ELSE '[]'::jsonb END
    ) WITH ORDINALITY
    WHERE position('*' IN value) > 0
  ),
  existing_manual AS (
    SELECT DISTINCT ON (punch_key) raw, punch_key, ord
    FROM existing_manual_base manual
    WHERE punch_key <> ''
      AND NOT EXISTS (
        SELECT 1 FROM incoming WHERE incoming.punch_key = manual.punch_key
      )
    ORDER BY punch_key, ord DESC
  ),
  merged AS (
    SELECT raw, punch_key, 0 AS source_order, ord FROM incoming
    UNION ALL
    SELECT raw, punch_key, 1 AS source_order, ord FROM existing_manual
  )
  SELECT COALESCE(
    jsonb_agg(raw ORDER BY punch_key, source_order, ord),
    '[]'::jsonb
  )
  FROM merged;
$fn$;

REVOKE ALL ON FUNCTION public.merge_time_record_punches(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_time_record_punches(jsonb, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.merge_time_record_punches(jsonb, jsonb) IS
  'Novo arquivo substitui as batidas brutas do dia, preservando horários manuais (*) '
  'que ainda não vieram do relógio. Se o horário vier, a marca manual é removida.';

CREATE OR REPLACE FUNCTION public.import_time_records_safe(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  rec jsonb;
  v_name text;
  v_external_id text;
  v_identity text;
  v_record_date date;
  v_existing_id uuid;
  v_existing_punches jsonb;
  ins_count integer := 0;
  upd_count integer := 0;
  skp_count integer := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF jsonb_typeof(COALESCE(records, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Payload de ponto inválido: records deve ser um array.';
  END IF;

  FOR rec IN SELECT value FROM jsonb_array_elements(COALESCE(records, '[]'::jsonb))
  LOOP
    v_name := btrim(COALESCE(rec->>'employee_name', ''));
    v_external_id := NULLIF(btrim(COALESCE(rec->>'employee_external_id', '')), '');

    IF v_external_id IS NULL AND v_name = '' THEN
      skp_count := skp_count + 1;
      CONTINUE;
    END IF;
    IF jsonb_typeof(rec->'punches') <> 'array'
       OR jsonb_array_length(rec->'punches') = 0 THEN
      -- Lacuna pertence ao calendário/cadastro; não persiste placeholder do arquivo.
      skp_count := skp_count + 1;
      CONTINUE;
    END IF;

    v_record_date := (rec->>'record_date')::date;
    v_identity := COALESCE(v_external_id, 'nome:' || v_name);

    -- Serializa reimportações concorrentes da mesma pessoa/data antes do SELECT.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_identity || '|' || v_record_date::text, 0));

    SELECT tr.id, tr.punches
      INTO v_existing_id, v_existing_punches
    FROM public.time_records tr
    WHERE COALESCE(NULLIF(btrim(tr.employee_external_id), ''), 'nome:' || btrim(tr.employee_name)) = v_identity
      AND tr.record_date = v_record_date
    LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.time_records (
        employee_name,
        employee_external_id,
        department,
        record_date,
        punches,
        import_batch
      ) VALUES (
        v_name,
        v_external_id,
        NULLIF(btrim(COALESCE(rec->>'department', '')), ''),
        v_record_date,
        public.merge_time_record_punches('[]'::jsonb, rec->'punches'),
        rec->>'import_batch'
      );
      ins_count := ins_count + 1;
    ELSE
      UPDATE public.time_records
      SET employee_name = COALESCE(NULLIF(v_name, ''), employee_name),
          employee_external_id = COALESCE(v_external_id, employee_external_id),
          department = COALESCE(NULLIF(btrim(COALESCE(rec->>'department', '')), ''), department),
          punches = public.merge_time_record_punches(v_existing_punches, rec->'punches'),
          import_batch = rec->>'import_batch'
      WHERE id = v_existing_id;
      upd_count := upd_count + 1;
    END IF;

    v_existing_id := NULL;
    v_existing_punches := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', ins_count,
    'updated', upd_count,
    'skipped', skp_count
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.import_time_records_safe(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_time_records_safe(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.import_time_records_safe(jsonb) IS
  'Upsert incremental do ponto pela identidade do relógio + data. Não persiste '
  'lacunas do arquivo; preserva correções manuais e retorna inserts/updates/skips.';
