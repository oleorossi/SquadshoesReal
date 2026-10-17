-- Ateliê: Costura/Aviamento passam a ter 3 OKs na rua
--   cut → sent_to_contractor (Enviado ao prestador)
--       → realized (Realizado)
--       → received_at_factory (Recebido e conferido)
-- Corte continua só na fábrica (confirmar corte do lote) — sem esses OKs.

ALTER TABLE public.cabedal_prep_jobs
  ADD COLUMN IF NOT EXISTS realized_at timestamptz;

ALTER TABLE public.cabedal_prep_jobs
  DROP CONSTRAINT IF EXISTS cabedal_prep_jobs_pipeline_status_check;

ALTER TABLE public.cabedal_prep_jobs
  ADD CONSTRAINT cabedal_prep_jobs_pipeline_status_check
  CHECK (pipeline_status = ANY (ARRAY[
    'awaiting_cut'::text,
    'cut'::text,
    'sent_to_contractor'::text,
    'realized'::text,
    'received_at_factory'::text,
    'cancelled'::text
  ]));

COMMENT ON COLUMN public.cabedal_prep_jobs.realized_at IS
  'Quando o prestador concluiu Costura/Aviamento (OK Realizado), antes do recebimento/conferência na fábrica.';

-- Prestador concluiu o serviço (OK Realizado).
CREATE OR REPLACE FUNCTION public.atelier_mark_job_realized(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.cabedal_prep_jobs
     SET pipeline_status = 'realized',
         realized_at = COALESCE(realized_at, now()),
         updated_at = now()
   WHERE id = p_job_id
     AND pipeline_status = 'sent_to_contractor'
     AND sector IN ('costura_cabedal', 'aviamento');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job precisa estar enviado ao prestador (Costura ou Aviamento)'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_mark_job_realized(uuid)
  TO authenticated, service_role;

-- Recebido e conferido: só depois de Realizado.
CREATE OR REPLACE FUNCTION public.atelier_mark_job_received(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.cabedal_prep_jobs
     SET pipeline_status = 'received_at_factory',
         received_at = now(),
         updated_at = now()
   WHERE id = p_job_id
     AND pipeline_status = 'realized'
     AND sector IN ('costura_cabedal', 'aviamento');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job precisa estar realizado pelo prestador antes de conferir'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_mark_job_received(uuid)
  TO authenticated, service_role;

-- Gate: mensagem fala em conferência (último OK).
CREATE OR REPLACE FUNCTION public.atelier_item_block_reason(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref uuid;
  v_sectors text[];
  v_sec text;
  v_status text;
BEGIN
  SELECT soi.reference_id INTO v_ref FROM public.sale_order_items soi WHERE soi.id = p_item_id;
  IF v_ref IS NULL THEN
    RETURN NULL;
  END IF;
  v_sectors := public.atelier_reference_street_sectors(v_ref);
  IF cardinality(v_sectors) = 0 THEN
    RETURN NULL;
  END IF;
  FOREACH v_sec IN ARRAY v_sectors LOOP
    SELECT j.pipeline_status INTO v_status
      FROM public.cabedal_prep_jobs j
     WHERE j.sale_order_item_id = p_item_id
       AND j.sector = v_sec
       AND j.pipeline_status <> 'cancelled'
     ORDER BY j.updated_at DESC
     LIMIT 1;
    IF v_status IS DISTINCT FROM 'received_at_factory' THEN
      RETURN format(
        'Ateliê — %s só libera após recebido e conferido (status: %s)',
        CASE v_sec WHEN 'costura_cabedal' THEN 'costura' ELSE 'aviamento' END,
        COALESCE(v_status, 'sem job — rode Reaplicar no Ateliê')
      );
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_item_block_reason(uuid)
  TO authenticated, service_role;
