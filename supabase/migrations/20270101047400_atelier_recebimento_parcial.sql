-- Recebimento parcial do Ateliê.
--
-- Cada entrada de pares fica num lançamento. received_at_factory / done só
-- fecham em 100%. Em Produção libera quando todo setor de rua do item já tem
-- saldo conferido (> 0). A OP nasce com costura/aviamento em
-- quantity_processed = pares conferidos, e um recebimento posterior incrementa
-- a etapa. Colagem, Montagem e o que vem depois não apontam acima desse saldo.
--
-- Jobs que já estavam recebidos/concluídos ganham um lançamento do total
-- (backfill). Nada é debitado de novo.

ALTER TABLE public.cabedal_prep_jobs
  ADD COLUMN IF NOT EXISTS received_pairs numeric NOT NULL DEFAULT 0;

ALTER TABLE public.cabedal_prep_jobs
  DROP CONSTRAINT IF EXISTS cabedal_prep_jobs_pipeline_status_check;

ALTER TABLE public.cabedal_prep_jobs
  ADD CONSTRAINT cabedal_prep_jobs_pipeline_status_check
  CHECK (pipeline_status = ANY (ARRAY[
    'awaiting_cut'::text,
    'cut'::text,
    'sent_to_contractor'::text,
    'realized'::text,
    'partially_received'::text,
    'received_at_factory'::text,
    'in_progress'::text,
    'partially_done'::text,
    'done'::text,
    'cancelled'::text
  ]));

CREATE TABLE IF NOT EXISTS public.atelier_job_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.cabedal_prep_jobs(id) ON DELETE CASCADE,
  pairs numeric NOT NULL CHECK (pairs > 0),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  CONSTRAINT atelier_job_receipts_reversal_chk CHECK (
    (reversed_at IS NULL AND reversal_reason IS NULL)
    OR (reversed_at IS NOT NULL AND NULLIF(btrim(COALESCE(reversal_reason, '')), '') IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_atelier_job_receipts_job
  ON public.atelier_job_receipts (job_id, created_at);

ALTER TABLE public.atelier_job_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.atelier_job_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.atelier_job_receipts TO authenticated;
GRANT ALL ON TABLE public.atelier_job_receipts TO service_role;

DROP POLICY IF EXISTS atelier_job_receipts_select ON public.atelier_job_receipts;
CREATE POLICY atelier_job_receipts_select ON public.atelier_job_receipts
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

COMMENT ON TABLE public.atelier_job_receipts IS
  'Histórico de pares conferidos de um job do Ateliê. Estorno marca a linha; não apaga.';

-- Jobs já fechados contam como 100%, uma vez.
INSERT INTO public.atelier_job_receipts (job_id, pairs, note, created_by, created_at)
SELECT j.id, j.pairs, 'Backfill: conferido integralmente antes do recebimento parcial',
       NULL, COALESCE(j.received_at, j.updated_at, now())
  FROM public.cabedal_prep_jobs j
 WHERE j.pipeline_status IN ('received_at_factory', 'done')
   AND j.pairs > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.atelier_job_receipts r WHERE r.job_id = j.id
   );

UPDATE public.cabedal_prep_jobs j
   SET received_pairs = COALESCE((
         SELECT SUM(r.pairs)
           FROM public.atelier_job_receipts r
          WHERE r.job_id = j.id
            AND r.reversed_at IS NULL
       ), 0)
 WHERE j.received_pairs IS DISTINCT FROM COALESCE((
         SELECT SUM(r.pairs)
           FROM public.atelier_job_receipts r
          WHERE r.job_id = j.id
            AND r.reversed_at IS NULL
       ), 0);

CREATE OR REPLACE FUNCTION public.atelier_job_open_received(p_job_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(r.pairs), 0)
    FROM public.atelier_job_receipts r
   WHERE r.job_id = p_job_id
     AND r.reversed_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.atelier_job_open_received(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_job_open_received(uuid) TO authenticated, service_role;

-- Menor saldo conferido dos setores de rua do item. NULL = item sem Ateliê.
CREATE OR REPLACE FUNCTION public.atelier_received_cap_for_order(p_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_soi uuid;
  v_cap numeric;
BEGIN
  SELECT o.sale_order_item_id INTO v_soi
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL;
  IF v_soi IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cabedal_prep_jobs j
     WHERE j.sale_order_item_id = v_soi
       AND j.pipeline_status IS DISTINCT FROM 'cancelled'
       AND j.sector IN ('costura_cabedal', 'aviamento')
  ) THEN
    RETURN NULL;
  END IF;
  SELECT MIN(COALESCE(j.received_pairs, 0)) INTO v_cap
    FROM public.cabedal_prep_jobs j
   WHERE j.sale_order_item_id = v_soi
     AND j.pipeline_status IS DISTINCT FROM 'cancelled'
     AND j.sector IN ('costura_cabedal', 'aviamento');
  RETURN COALESCE(v_cap, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_received_cap_for_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_received_cap_for_order(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_downstream_consumed(p_item_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(os.quantity_processed), 0)
    FROM public.orders o
    JOIN public.order_stages os ON os.order_id = o.id
   WHERE o.sale_order_item_id = p_item_id
     AND o.deleted_at IS NULL
     AND os.stage_name IN ('Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição');
$$;

REVOKE ALL ON FUNCTION public.atelier_downstream_consumed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_downstream_consumed(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_sync_stage_from_job(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_stage text;
  v_received numeric;
BEGIN
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id;
  IF NOT FOUND OR v_job.sale_order_item_id IS NULL THEN
    RETURN;
  END IF;
  v_stage := CASE v_job.sector
    WHEN 'costura_cabedal' THEN 'Costura Cabedal'
    WHEN 'aviamento' THEN 'Aviamento'
    ELSE NULL
  END;
  IF v_stage IS NULL THEN
    RETURN;
  END IF;
  v_received := COALESCE(v_job.received_pairs, 0);
  PERFORM pg_catalog.set_config('app.order_stage_command_internal', '1', true);
  UPDATE public.order_stages os
     SET quantity_processed = LEAST(COALESCE(os.quantity_total, v_received), v_received),
         status = CASE
           WHEN os.quantity_total IS NOT NULL AND os.quantity_total > 0
                AND v_received >= os.quantity_total THEN 'concluido'
           WHEN v_received > 0 THEN 'em_andamento'
           ELSE 'pendente'
         END,
         completed_at = CASE
           WHEN os.quantity_total IS NOT NULL AND v_received >= os.quantity_total
             THEN COALESCE(os.completed_at, now())
           ELSE NULL
         END,
         updated_at = now()
    FROM public.orders o
   WHERE o.id = os.order_id
     AND o.sale_order_item_id = v_job.sale_order_item_id
     AND o.deleted_at IS NULL
     AND os.stage_name = v_stage;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_sync_stage_from_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_sync_stage_from_job(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.atelier_apply_received_total(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_received numeric;
  v_internal boolean;
  v_status text;
BEGIN
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_received := public.atelier_job_open_received(p_job_id);
  v_internal := v_job.execution_mode = 'internal';
  IF v_received <= 0 THEN
    v_status := CASE
      WHEN v_internal THEN 'in_progress'
      WHEN v_job.realized_at IS NOT NULL THEN 'realized'
      ELSE 'sent_to_contractor'
    END;
  ELSIF v_received < v_job.pairs THEN
    v_status := CASE WHEN v_internal THEN 'partially_done' ELSE 'partially_received' END;
  ELSE
    v_status := CASE WHEN v_internal THEN 'done' ELSE 'received_at_factory' END;
  END IF;
  UPDATE public.cabedal_prep_jobs
     SET received_pairs = v_received,
         pipeline_status = v_status,
         received_at = CASE
           WHEN v_status IN ('received_at_factory', 'done') THEN COALESCE(received_at, now())
           ELSE received_at
         END,
         updated_at = now()
   WHERE id = p_job_id;
  PERFORM public.atelier_sync_stage_from_job(p_job_id);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_apply_received_total(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_apply_received_total(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.register_atelier_job_receipt(
  p_job_id uuid,
  p_pairs numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_open numeric;
  v_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_pairs IS NULL OR p_pairs <= 0 THEN
    RAISE EXCEPTION 'Informe a quantidade recebida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.sector NOT IN ('costura_cabedal', 'aviamento') THEN
    RAISE EXCEPTION 'Só Costura e Aviamento recebem conferência' USING ERRCODE = '22023';
  END IF;
  IF v_job.execution_mode = 'internal' THEN
    IF v_job.pipeline_status NOT IN ('in_progress', 'partially_done', 'done') THEN
      RAISE EXCEPTION 'Inicie a realização antes de lançar o concluído' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_job.pipeline_status NOT IN (
      'sent_to_contractor', 'realized', 'partially_received', 'received_at_factory'
    ) THEN
      RAISE EXCEPTION 'Envie o job ao prestador antes de conferir' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_open := public.atelier_job_open_received(p_job_id);
  IF v_open + p_pairs > v_job.pairs + 1e-9 THEN
    RAISE EXCEPTION 'Excede o job: já há % de % pares. Faltam %.',
      v_open, v_job.pairs, GREATEST(v_job.pairs - v_open, 0)
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.atelier_job_receipts (job_id, pairs, note, created_by)
  VALUES (p_job_id, p_pairs, NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.atelier_apply_received_total(p_job_id);

  RETURN jsonb_build_object(
    'ok', true,
    'receipt_id', v_id,
    'received_pairs', public.atelier_job_open_received(p_job_id),
    'pairs', v_job.pairs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_atelier_job_receipt(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_atelier_job_receipt(uuid, numeric, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverse_atelier_job_receipt(
  p_receipt_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.atelier_job_receipts%ROWTYPE;
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_open numeric;
  v_consumed numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do estorno' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_receipt FROM public.atelier_job_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_receipt.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este lançamento já foi estornado' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = v_receipt.job_id FOR UPDATE;
  v_open := public.atelier_job_open_received(v_job.id);
  v_consumed := public.atelier_downstream_consumed(v_job.sale_order_item_id);
  IF v_open - v_receipt.pairs < v_consumed - 1e-9 THEN
    RAISE EXCEPTION
      'A produção já apontou % pares. Estorne o apontamento antes de devolver este lançamento.',
      v_consumed
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.atelier_job_receipts
     SET reversed_at = now(),
         reversed_by = auth.uid(),
         reversal_reason = btrim(p_reason)
   WHERE id = p_receipt_id;

  PERFORM public.atelier_apply_received_total(v_job.id);

  RETURN jsonb_build_object(
    'ok', true,
    'received_pairs', public.atelier_job_open_received(v_job.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_atelier_job_receipt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_atelier_job_receipt(uuid, text)
  TO authenticated, service_role;

-- Conferir / concluir integral vira o saldo que ainda falta, no mesmo livro.
CREATE OR REPLACE FUNCTION public.atelier_mark_job_received(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_rest numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  v_rest := v_job.pairs - public.atelier_job_open_received(p_job_id);
  IF v_rest <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;
  RETURN public.register_atelier_job_receipt(p_job_id, v_rest, 'Conferência do saldo');
END;
$$;

CREATE OR REPLACE FUNCTION public.atelier_mark_job_internal_done(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_rest numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.execution_mode IS DISTINCT FROM 'internal' THEN
    RAISE EXCEPTION 'Job interno precisa estar em realização' USING ERRCODE = '22023';
  END IF;
  v_rest := v_job.pairs - public.atelier_job_open_received(p_job_id);
  IF v_rest <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;
  RETURN public.register_atelier_job_receipt(p_job_id, v_rest, 'Conclusão do saldo');
END;
$$;

-- Trava só enquanto o setor não tem nenhum par conferido.
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
  v_received numeric;
  v_pairs numeric;
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
    SELECT COALESCE(j.received_pairs, 0), j.pairs
      INTO v_received, v_pairs
      FROM public.cabedal_prep_jobs j
     WHERE j.sale_order_item_id = p_item_id
       AND j.sector = v_sec
       AND j.pipeline_status <> 'cancelled'
     ORDER BY j.updated_at DESC
     LIMIT 1;
    IF v_received IS NULL THEN
      RETURN format(
        'Ateliê — %s ainda sem job. Rode Reaplicar no Ateliê.',
        CASE v_sec WHEN 'costura_cabedal' THEN 'costura' ELSE 'aviamento' END
      );
    END IF;
    IF v_received <= 0 THEN
      RETURN format(
        'Ateliê — %s ainda sem recebimento (0/%s)',
        CASE v_sec WHEN 'costura_cabedal' THEN 'costura' ELSE 'aviamento' END,
        trim(to_char(v_pairs, 'FM999999990.##'))
      );
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- Lista do selo: incompletos, com a flag de trava.
DROP FUNCTION IF EXISTS public.sale_order_atelier_production_block_rows(uuid[]);
CREATE FUNCTION public.sale_order_atelier_production_block_rows(p_sale_order_ids uuid[])
RETURNS TABLE (
  sale_order_id uuid,
  item_id uuid,
  reference_code text,
  color text,
  pending_jobs text,
  reason text,
  blocks boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    soi.sale_order_id,
    soi.id AS item_id,
    COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), '?') AS reference_code,
    COALESCE(NULLIF(btrim(soi.color), ''), '—') AS color,
    (
      SELECT string_agg(
               format(
                 '%s · %s/%s recebidos',
                 CASE j.sector
                   WHEN 'costura_cabedal' THEN 'Costura'
                   WHEN 'aviamento' THEN 'Aviamento'
                   ELSE COALESCE(NULLIF(btrim(j.sector), ''), '?')
                 END,
                 trim(to_char(COALESCE(j.received_pairs, 0), 'FM999999990.##')),
                 trim(to_char(j.pairs, 'FM999999990.##'))
               ),
               '; ' ORDER BY j.sector, j.id
             )
        FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_item_id = soi.id
         AND j.pipeline_status IS DISTINCT FROM 'cancelled'
         AND j.sector IN ('costura_cabedal', 'aviamento')
         AND COALESCE(j.received_pairs, 0) < j.pairs
    ) AS pending_jobs,
    COALESCE(
      gate.reason,
      'Cabedal parcial. Em Produção segue com o saldo já conferido.'
    ) AS reason,
    (gate.reason IS NOT NULL) AS blocks
    FROM public.sale_order_items soi
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
    CROSS JOIN LATERAL (
      SELECT public.atelier_item_block_reason(soi.id) AS reason
    ) gate
   WHERE soi.sale_order_id = ANY (COALESCE(p_sale_order_ids, ARRAY[]::uuid[]))
     AND soi.reference_id IS NOT NULL
     AND soi.production_excluded_at IS NULL
     AND EXISTS (
       SELECT 1
         FROM public.cabedal_prep_jobs j
        WHERE j.sale_order_item_id = soi.id
          AND j.pipeline_status IS DISTINCT FROM 'cancelled'
          AND j.sector IN ('costura_cabedal', 'aviamento')
          AND COALESCE(j.received_pairs, 0) < j.pairs
     )
   ORDER BY 1, 3, 4, 2;
$$;

REVOKE ALL ON FUNCTION public.sale_order_atelier_production_block_rows(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_order_atelier_production_block_rows(uuid[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.sale_order_atelier_production_block_message(p_sale_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN count(*) FILTER (WHERE r.blocks) = 0 THEN NULL::text
    ELSE
      'Não é possível colocar o pedido em Em Produção: o cabedal complexo ainda não voltou para a fábrica.'
      || E'\n'
      || string_agg(
           format('%s / %s — %s Jobs pendentes: %s.', r.reference_code, r.color, r.reason, r.pending_jobs),
           E'\n'
           ORDER BY r.reference_code, r.color, r.item_id
         ) FILTER (WHERE r.blocks)
  END
    FROM public.sale_order_atelier_production_block_rows(ARRAY[p_sale_order_id]) r;
$$;

DROP FUNCTION IF EXISTS public.list_sale_order_atelier_production_blocks(uuid[]);
CREATE FUNCTION public.list_sale_order_atelier_production_blocks(p_sale_order_ids uuid[])
RETURNS TABLE (
  sale_order_id uuid,
  item_id uuid,
  reference_code text,
  color text,
  pending_jobs text,
  reason text,
  blocks boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_sale_order_ids IS NULL OR cardinality(p_sale_order_ids) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT *
    FROM public.sale_order_atelier_production_block_rows(p_sale_order_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.list_sale_order_atelier_production_blocks(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sale_order_atelier_production_blocks(uuid[])
  TO authenticated, service_role;

-- OP nasce com o saldo conferido, não com o total do pedido.
CREATE OR REPLACE FUNCTION public.tg_atelier_stage_born_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_soi uuid;
  v_received numeric;
  v_cut boolean := false;
BEGIN
  IF NEW.stage_name NOT IN ('Corte Cabedal', 'Costura Cabedal', 'Aviamento') THEN
    RETURN NEW;
  END IF;

  SELECT o.sale_order_item_id INTO v_soi FROM public.orders o WHERE o.id = NEW.order_id;
  IF v_soi IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.stage_name = 'Corte Cabedal' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_item_id = v_soi
         AND j.pipeline_status IN (
           'cut', 'sent_to_contractor', 'realized', 'partially_received',
           'received_at_factory', 'in_progress', 'partially_done', 'done'
         )
    ) INTO v_cut;
    IF v_cut THEN
      NEW.status := 'concluido';
      NEW.completed_at := COALESCE(NEW.completed_at, now());
      NEW.quantity_processed := COALESCE(NEW.quantity_total, NEW.quantity_processed);
      NEW.observations := concat_ws(' · ', NULLIF(NEW.observations, ''), 'Feito no Ateliê');
    END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(j.received_pairs, 0) INTO v_received
    FROM public.cabedal_prep_jobs j
   WHERE j.sale_order_item_id = v_soi
     AND j.sector = CASE NEW.stage_name
           WHEN 'Costura Cabedal' THEN 'costura_cabedal'
           ELSE 'aviamento'
         END
     AND j.pipeline_status <> 'cancelled'
   ORDER BY j.updated_at DESC
   LIMIT 1;

  IF COALESCE(v_received, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  NEW.quantity_processed := LEAST(COALESCE(NEW.quantity_total, v_received), v_received);
  IF NEW.quantity_total IS NOT NULL AND NEW.quantity_total > 0
     AND NEW.quantity_processed >= NEW.quantity_total THEN
    NEW.status := 'concluido';
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  ELSE
    NEW.status := 'em_andamento';
  END IF;
  NEW.observations := concat_ws(' · ', NULLIF(NEW.observations, ''), 'Feito no Ateliê');
  RETURN NEW;
END;
$$;

-- Colagem em diante não passa do saldo conferido.
CREATE OR REPLACE FUNCTION public.tg_atelier_cap_downstream_pointing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap numeric;
BEGIN
  IF NEW.stage_name NOT IN ('Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.quantity_processed IS NOT DISTINCT FROM OLD.quantity_processed THEN
    RETURN NEW;
  END IF;
  v_cap := public.atelier_received_cap_for_order(NEW.order_id);
  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.quantity_processed, 0) > v_cap + 1e-9 THEN
    RAISE EXCEPTION
      'Ateliê devolveu % pares. % não pode passar desse saldo.',
      trim(to_char(v_cap, 'FM999999990.##')),
      NEW.stage_name
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_z_atelier_cap_downstream ON public.order_stages;
CREATE TRIGGER trg_zz_z_atelier_cap_downstream
  BEFORE INSERT OR UPDATE OF quantity_processed ON public.order_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_cap_downstream_pointing();

-- Lista da fila passa a trazer received_pairs.
DO $patch_list$
DECLARE
  v_def text;
  v_old text := $o$'pairs', j.pairs,$o$;
  v_new text := $n$'pairs', j.pairs, 'received_pairs', COALESCE(j.received_pairs, 0),$n$;
BEGIN
  SELECT pg_get_functiondef('public.list_atelier_lots()'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'list_atelier_lots() não encontrada';
  END IF;
  IF strpos(v_def, 'received_pairs') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'list_atelier_lots: âncora de pairs não encontrada';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_list$;
