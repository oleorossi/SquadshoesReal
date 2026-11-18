-- O Enviar do Ateliê criava a OS com dispatch_tracked e quantity, mas não
-- gravava service_order_dispatches. O retorno compara com o despacho e
-- recusava qualquer conferência ("0 enviados").
-- O despacho entra na mesma transação do envio. OS de Ateliê já enviada
-- sem despacho recebe o lançamento faltante, uma vez por job.
-- A volta da OS (quoted_deadline) passa a ser a mesma data do cartão.
-- Conferência só aceita pares inteiros: qty_good é integer e 2,5 virava 3.

ALTER TABLE public.atelier_job_receipts
  ADD COLUMN IF NOT EXISTS qty_defect numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_loss numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.atelier_whole_pairs(p_qty numeric, p_label text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_qty IS NULL OR p_qty < 0 OR p_qty <> trunc(p_qty) THEN
    RAISE EXCEPTION '% aceita só pares inteiros, sem fração e sem negativo', p_label
      USING ERRCODE = '22023';
  END IF;
  RETURN p_qty::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_whole_pairs(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_whole_pairs(numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_job_open_received(p_job_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
           r.pairs + COALESCE(r.qty_defect, 0) + COALESCE(r.qty_loss, 0)
         ), 0)
    FROM public.atelier_job_receipts r
   WHERE r.job_id = p_job_id
     AND r.reversed_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.atelier_job_open_received(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_job_open_received(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_record_shipment_dispatch(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_os public.service_orders%ROWTYPE;
  v_pairs integer;
  v_due date;
BEGIN
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.service_order_id IS NULL THEN
    RETURN;
  END IF;
  IF v_job.execution_mode = 'internal' THEN
    RETURN;
  END IF;
  IF v_job.pipeline_status NOT IN (
    'sent_to_contractor', 'realized', 'partially_received', 'received_at_factory'
  ) THEN
    RETURN;
  END IF;

  v_pairs := public.atelier_whole_pairs(v_job.pairs, 'O envio do Ateliê');
  IF v_pairs <= 0 THEN
    RAISE EXCEPTION 'O envio do Ateliê precisa de ao menos 1 par' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_os FROM public.service_orders WHERE id = v_job.service_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.service_order_dispatches d
     WHERE d.service_order_id = v_os.id
       AND d.notes = 'atelier:' || v_job.id::text
  ) THEN
    INSERT INTO public.service_order_dispatches (
      service_order_id, contractor_id, qty_dispatched, dispatched_at, notes, created_by
    ) VALUES (
      v_os.id,
      COALESCE(v_job.contractor_id, v_os.contractor_id),
      v_pairs,
      COALESCE(v_job.sent_at, now()),
      'atelier:' || v_job.id::text,
      auth.uid()
    );
  END IF;

  SELECT MIN(public.atelier_job_return_date(j.target_end, j.sector))
    INTO v_due
    FROM public.cabedal_prep_jobs j
    JOIN public.service_order_items i ON i.atelier_job_id = j.id
   WHERE i.service_order_id = v_os.id
     AND j.target_end IS NOT NULL;

  UPDATE public.service_orders
     SET quoted_deadline = COALESCE(v_due, quoted_deadline),
         updated_at = now()
   WHERE id = v_os.id
     AND v_due IS NOT NULL
     AND quoted_deadline IS DISTINCT FROM v_due;

  UPDATE public.cabedal_prep_jobs
     SET atelier_service_number = v_os.order_number,
         updated_at = now()
   WHERE id = v_job.id
     AND v_os.order_number IS NOT NULL
     AND atelier_service_number IS DISTINCT FROM v_os.order_number;

  UPDATE public.atelier_lots l
     SET dispatch_signal = NULL,
         updated_at = now()
   WHERE l.id = v_job.lot_id
     AND l.dispatch_signal IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.cabedal_prep_jobs j
        WHERE j.lot_id = l.id
          AND j.pipeline_status IN ('awaiting_cut', 'cut')
          AND COALESCE(j.execution_mode, 'contractor') <> 'internal'
     );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_record_shipment_dispatch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_record_shipment_dispatch(uuid) TO service_role;

-- O envio passa a despachar e a usar o número da OS no cartão.
DO $patch_sent$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.atelier_mark_job_sent(uuid, uuid, uuid)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'atelier_mark_job_sent(uuid, uuid, uuid) não encontrada';
  END IF;
  IF strpos(v_def, 'atelier_record_shipment_dispatch') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, 'v_num := COALESCE(v_job.atelier_service_number, public.next_atelier_service_number());') = 0 THEN
    RAISE EXCEPTION 'não achei a numeração ATELIE- para trocar pelo número da OS';
  END IF;
  v_def := replace(
    v_def,
    'v_num := COALESCE(v_job.atelier_service_number, public.next_atelier_service_number());',
    'v_num := NULL;'
  );
  IF strpos(v_def, 'v_price := public.atelier_attach_job_line') = 0 THEN
    RAISE EXCEPTION 'não achei o attach da linha para numerar com a OS';
  END IF;
  v_def := replace(
    v_def,
    'v_price := public.atelier_attach_job_line',
    E'v_num := COALESCE(v_os_number, v_job.atelier_service_number, public.next_atelier_service_number());\n  v_price := public.atelier_attach_job_line'
  );
  IF strpos(v_def, 'RETURN jsonb_build_object(') = 0 THEN
    RAISE EXCEPTION 'não achei o retorno do envio';
  END IF;
  v_def := replace(
    v_def,
    'RETURN jsonb_build_object(',
    E'PERFORM public.atelier_record_shipment_dispatch(p_job_id);\n  RETURN jsonb_build_object('
  );
  IF strpos(v_def, 'atelier_record_shipment_dispatch') = 0
     OR strpos(v_def, 'v_num := COALESCE(v_os_number') = 0 THEN
    RAISE EXCEPTION 'o envio não passou a despachar e a numerar pela OS';
  END IF;
  EXECUTE v_def;
END
$patch_sent$;

-- OS de Ateliê já enviada e ainda sem despacho deste job.
DO $backfill$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT j.id
      FROM public.cabedal_prep_jobs j
      JOIN public.service_order_items i
        ON i.atelier_job_id = j.id
       AND i.service_order_id = j.service_order_id
     WHERE j.service_order_id IS NOT NULL
       AND COALESCE(j.execution_mode, 'contractor') <> 'internal'
       AND j.pipeline_status IN (
         'sent_to_contractor', 'realized', 'partially_received', 'received_at_factory'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.service_order_dispatches d
          WHERE d.service_order_id = j.service_order_id
            AND d.notes = 'atelier:' || j.id::text
       )
  LOOP
    PERFORM public.atelier_record_shipment_dispatch(v_id);
  END LOOP;
END
$backfill$;

CREATE OR REPLACE FUNCTION public.atelier_post_receipt_return(p_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.atelier_job_receipts%ROWTYPE;
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_line public.service_order_items%ROWTYPE;
  v_return uuid;
  v_good integer;
  v_defect integer;
  v_loss integer;
  v_amount numeric;
  v_physical integer;
BEGIN
  SELECT * INTO v_receipt FROM public.atelier_job_receipts WHERE id = p_receipt_id;
  IF NOT FOUND OR v_receipt.reversed_at IS NOT NULL THEN
    RETURN;
  END IF;

  v_good := public.atelier_whole_pairs(v_receipt.pairs, 'Pares bons');
  v_defect := public.atelier_whole_pairs(COALESCE(v_receipt.qty_defect, 0), 'Pares com defeito');
  v_loss := public.atelier_whole_pairs(COALESCE(v_receipt.qty_loss, 0), 'Pares perdidos');
  IF v_good <= 0 THEN
    RAISE EXCEPTION 'A conferência precisa de ao menos 1 par bom' USING ERRCODE = '22023';
  END IF;
  v_physical := v_good + v_defect + v_loss;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = v_receipt.job_id;
  IF NOT FOUND OR v_job.execution_mode = 'internal' OR v_job.service_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_line
    FROM public.service_order_items
   WHERE atelier_job_id = v_job.id
   ORDER BY created_at
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_amount := ROUND(v_good * COALESCE(v_line.unit_price, 0), 2);

  INSERT INTO public.service_order_returns (
    service_order_id, contractor_id, returned_at,
    qty_good, qty_defect, qty_defect_scrapped, qty_loss,
    defect_notes, created_by, atelier_job_receipt_id
  ) VALUES (
    v_job.service_order_id,
    v_job.contractor_id,
    COALESCE(v_receipt.created_at, now()),
    v_good,
    v_defect, 0, v_loss,
    NULLIF(btrim(COALESCE(v_receipt.note, '')), ''),
    v_receipt.created_by,
    v_receipt.id
  )
  ON CONFLICT (atelier_job_receipt_id) DO NOTHING
  RETURNING id INTO v_return;

  IF v_return IS NULL THEN
    SELECT id INTO v_return
      FROM public.service_order_returns
     WHERE atelier_job_receipt_id = v_receipt.id;
  END IF;

  IF v_job.sale_order_item_id IS NOT NULL THEN
    INSERT INTO public.service_order_return_items (
      service_order_return_id, service_order_id, sale_order_item_id,
      qty_good, qty_defect, qty_defect_scrapped, qty_loss
    )
    SELECT v_return, v_job.service_order_id, v_job.sale_order_item_id,
           v_good, v_defect, 0, v_loss
     WHERE NOT EXISTS (
       SELECT 1 FROM public.service_order_return_items i
        WHERE i.service_order_return_id = v_return
          AND i.sale_order_item_id = v_job.sale_order_item_id
     );
  END IF;

  UPDATE public.service_order_items
     SET delivered_qty = COALESCE(delivered_qty, 0) + v_physical,
         line_status = CASE
           WHEN COALESCE(delivered_qty, 0) + v_physical >= quantity THEN 'Entregue'
           ELSE line_status
         END,
         updated_at = now()
   WHERE id = v_line.id;

  UPDATE public.accounts_payable
     SET amount = v_amount,
         notes = COALESCE(notes, '') || ' Valor dos pares bons, na tarifa travada no envio.'
   WHERE reference_type = 'service_order_return'
     AND reference_id = v_return
     AND status = 'pending';

  IF NOT FOUND AND v_amount > 0 THEN
    INSERT INTO public.accounts_payable (
      description, category, due_date, amount, status,
      reference_id, reference_type, notes
    )
    SELECT
      'OS ' || COALESCE(so.order_number, so.id::text) || ' — conferência Ateliê (' || v_good || ' pares bons)',
      'service',
      CURRENT_DATE + COALESCE(c.payment_days, 30),
      v_amount,
      'pending',
      v_return,
      'service_order_return',
      'Pares bons × tarifa travada no envio. Defeito e perda não geram título.'
    FROM public.service_orders so
    LEFT JOIN public.contractors c ON c.id = so.contractor_id
    WHERE so.id = v_job.service_order_id
      AND COALESCE(c.payment_days, 30) < 999
    ON CONFLICT (reference_id) WHERE reference_type = 'service_order_return' DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_post_receipt_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_post_receipt_return(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.register_atelier_job_receipt(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.register_atelier_job_receipt(
  p_job_id uuid,
  p_pairs numeric,
  p_note text DEFAULT NULL,
  p_defect numeric DEFAULT 0,
  p_loss numeric DEFAULT 0
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
  v_good integer;
  v_defect integer;
  v_loss integer;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  v_good := public.atelier_whole_pairs(p_pairs, 'Pares bons');
  v_defect := public.atelier_whole_pairs(COALESCE(p_defect, 0), 'Pares com defeito');
  v_loss := public.atelier_whole_pairs(COALESCE(p_loss, 0), 'Pares perdidos');
  IF v_good <= 0 THEN
    RAISE EXCEPTION 'Informe ao menos 1 par bom, inteiro' USING ERRCODE = '22023';
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
  IF v_open + v_good + v_defect + v_loss > v_job.pairs + 1e-9 THEN
    RAISE EXCEPTION 'Excede o job: já há % de % pares. Faltam %.',
      v_open, v_job.pairs, GREATEST(v_job.pairs - v_open, 0)
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.atelier_job_receipts (job_id, pairs, qty_defect, qty_loss, note, created_by)
  VALUES (
    p_job_id, v_good, v_defect, v_loss,
    NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid()
  )
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

REVOKE ALL ON FUNCTION public.register_atelier_job_receipt(uuid, numeric, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_atelier_job_receipt(uuid, numeric, text, numeric, numeric)
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
  IF NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Só admin ou gerência estorna um recebimento' USING ERRCODE = '42501';
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
  IF v_open - (v_receipt.pairs + COALESCE(v_receipt.qty_defect, 0) + COALESCE(v_receipt.qty_loss, 0))
       < v_consumed - 1e-9 THEN
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

  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
  VALUES (
    auth.uid(),
    'estorno_recebimento_atelie',
    'atelier_job_receipts',
    p_receipt_id::text,
    jsonb_build_object(
      'job_id', v_receipt.job_id,
      'pairs', v_receipt.pairs,
      'qty_defect', COALESCE(v_receipt.qty_defect, 0),
      'qty_loss', COALESCE(v_receipt.qty_loss, 0),
      'reason', btrim(p_reason)
    ),
    true,
    now()
  );

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
