-- ============================================================================
-- AUDITORIA 2026-07-28 (M29): a importação de ponto nunca mesclava batidas em
-- dia já existente. O cliente pulava a chave (employee_name, record_date) já
-- gravada, então: (1) dia importado no meio do expediente (só a entrada, batida
-- ímpar) congelava pra sempre — reimportar o arquivo completo era "skipped";
-- (2) funcionário no quadro sem batidas gravava punches=[] em todos os dias e
-- um export corrigido nunca preenchia.
--
-- Fix (2 lados):
--  • Cliente (useTimesheet.useImportTimeRecords): reenvia o dia existente com a
--    UNIÃO (banco ∪ arquivo, ordenada) quando o arquivo traz batida nova.
--  • Aqui: ON CONFLICT passa de sobrescrever (punches = EXCLUDED.punches, corpo
--    vivo) pra MESCLAR server-side (união distinct ordenada) — nunca perde
--    batida já gravada/lançada à mão, mesmo se algum caller mandar punches
--    parciais. Dia cujo arquivo não acrescenta nada é contado como 'skipped'
--    (WHERE de containment evita UPDATE no-op). Retorna
--    {inserted, updated, skipped}.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.import_time_records_safe(records jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec        jsonb;
  ins_count  integer := 0;
  upd_count  integer := 0;
  skp_count  integer := 0;
  v_inserted boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOR rec IN SELECT value FROM jsonb_array_elements(records)
  LOOP
    INSERT INTO public.time_records (
      employee_name,
      employee_external_id,
      department,
      record_date,
      punches,
      import_batch
    ) VALUES (
      trim(rec->>'employee_name'),
      trim(rec->>'employee_external_id'),
      trim(rec->>'department'),
      (rec->>'record_date')::date,
      COALESCE(rec->'punches', '[]'::jsonb),
      rec->>'import_batch'
    )
    ON CONFLICT (employee_name, record_date)
    DO UPDATE SET
      -- MERGE: união (distinct, ordenada) das batidas já gravadas com as do
      -- arquivo — nunca descarta batida existente (M29).
      punches = COALESCE((
        SELECT jsonb_agg(u.p ORDER BY u.p)
        FROM (
          SELECT DISTINCT t.p
          FROM jsonb_array_elements_text(
            COALESCE(time_records.punches, '[]'::jsonb) || COALESCE(EXCLUDED.punches, '[]'::jsonb)
          ) AS t(p)
        ) u
      ), '[]'::jsonb),
      import_batch = EXCLUDED.import_batch,
      employee_external_id = COALESCE(NULLIF(trim(EXCLUDED.employee_external_id), ''), time_records.employee_external_id),
      department = COALESCE(NULLIF(trim(EXCLUDED.department), ''), time_records.department)
    -- Só atualiza se o arquivo TRAZ batida que falta no banco (containment de
    -- elementos, independe de ordem) — senão conta como skipped.
    WHERE NOT (COALESCE(time_records.punches, '[]'::jsonb) @> COALESCE(EXCLUDED.punches, '[]'::jsonb))
    RETURNING (xmax = 0) INTO v_inserted;

    IF NOT FOUND THEN
      skp_count := skp_count + 1;
    ELSIF v_inserted THEN
      ins_count := ins_count + 1;
    ELSE
      upd_count := upd_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', ins_count, 'updated', upd_count, 'skipped', skp_count);
END;
$function$;
