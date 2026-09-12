-- Jornada curta (2 batidas em dia útil, ex.: Marcela 12/06 08:12 · 13:24)
-- entra na fila, mas apply_manual_punch_completion recusava porque o par
-- já é "completo" (contagem par). O RH clica Salvar com a saída 18:00 e
-- o banco responde que não há pendência. Se a linha está em
-- v_pending_time_records, complementar é exatamente o que a fila pede.

BEGIN;

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
  IF jsonb_array_length(v_old_punches) % 2 = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.v_pending_time_records v
       WHERE v.time_record_id = p_time_record_id
     ) THEN
    RAISE EXCEPTION 'Este dia já possui pares completos de batidas; não há pendência para complementar.'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_old_punches) p(value)
    WHERE left(replace(replace(p.value, '*', ''), chr(34), ''), 5) = v_punch_clean
  ) THEN
    RAISE EXCEPTION 'A batida % já existe neste dia.', v_punch_clean;
  END IF;

  SELECT jsonb_agg(value ORDER BY left(replace(replace(value, '*', ''), chr(34), ''), 5))
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

COMMENT ON FUNCTION public.apply_manual_punch_completion(uuid, time, text) IS
  'Acrescenta uma batida marcada (*). Ímpar sempre. Par só se o dia ainda está na fila de pendências (jornada curta).';

COMMIT;
