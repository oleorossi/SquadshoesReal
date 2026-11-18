-- Estorno da conferência do Ateliê deixa de apagar o retorno (o ledger é
-- imutável). O estorno é um retorno compensatório ligado ao original, mais
-- o evento da OS. Defeito pendente não conclui a OS: retrabalho reenvia o
-- par na mesma OS; descarte baixa a sucata. O recebimento dos bons entra
-- mesmo com defeito em aberto.

ALTER TABLE public.service_order_returns
  ADD COLUMN IF NOT EXISTS reverses_return_id uuid REFERENCES public.service_order_returns(id),
  ADD COLUMN IF NOT EXISTS adjustment_kind text;

ALTER TABLE public.service_order_returns
  DROP CONSTRAINT IF EXISTS service_order_returns_adjustment_kind_ck;
ALTER TABLE public.service_order_returns
  ADD CONSTRAINT service_order_returns_adjustment_kind_ck
  CHECK (adjustment_kind IS NULL OR adjustment_kind IN ('reversal', 'scrap'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_order_returns_reversal
  ON public.service_order_returns (reverses_return_id)
  WHERE reverses_return_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.atelier_defect_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.atelier_job_receipts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('rework', 'scrap')),
  pairs integer NOT NULL CHECK (pairs > 0),
  charge_contractor boolean NOT NULL DEFAULT false,
  reason text,
  dispatch_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atelier_defect_resolutions_receipt
  ON public.atelier_defect_resolutions (receipt_id);

ALTER TABLE public.atelier_defect_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atelier_defect_resolutions FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS atelier_defect_resolutions_read ON public.atelier_defect_resolutions;
CREATE POLICY atelier_defect_resolutions_read ON public.atelier_defect_resolutions
  FOR SELECT TO authenticated
  USING (public.is_approved_user());
GRANT SELECT ON public.atelier_defect_resolutions TO authenticated;
GRANT ALL ON public.atelier_defect_resolutions TO service_role;

ALTER TABLE public.atelier_job_receipts
  ADD COLUMN IF NOT EXISTS rework_resolution_id uuid REFERENCES public.atelier_defect_resolutions(id);

CREATE OR REPLACE FUNCTION public.atelier_pending_defect(p_job_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0, COALESCE((
           SELECT SUM(r.qty_defect)::int
             FROM public.atelier_job_receipts r
            WHERE r.job_id = p_job_id AND r.reversed_at IS NULL
         ), 0)
         - COALESCE((
           SELECT SUM(d.pairs)::int
             FROM public.atelier_defect_resolutions d
             JOIN public.atelier_job_receipts r ON r.id = d.receipt_id
            WHERE r.job_id = p_job_id
              AND r.reversed_at IS NULL
              AND d.kind = 'scrap'
         ), 0)
         - COALESCE((
           SELECT SUM(r.pairs)::int
             FROM public.atelier_job_receipts r
            WHERE r.job_id = p_job_id
              AND r.reversed_at IS NULL
              AND r.rework_resolution_id IS NOT NULL
         ), 0))::int;
$$;

REVOKE ALL ON FUNCTION public.atelier_pending_defect(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_pending_defect(uuid) TO authenticated, service_role;

-- Retorno compensatório e sucata não aumentam o saldo físico.
DO $patch_return_validator$
DECLARE
  v_def text;
  v_anchor text := 'PERFORM pg_advisory_xact_lock(hashtext(''service_order_flow:'' || NEW.service_order_id::text));';
  v_insert text := $ins$IF NEW.reverses_return_id IS NOT NULL OR COALESCE(NEW.adjustment_kind, '') = 'scrap' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('service_order_flow:' || NEW.service_order_id::text));$ins$;
BEGIN
  SELECT pg_get_functiondef('public.tg_validate_service_order_return()'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'tg_validate_service_order_return ausente';
  END IF;
  IF strpos(v_def, 'reverses_return_id') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_anchor) = 0 THEN
    RAISE EXCEPTION 'não achei o lock do retorno para aceitar o estorno';
  END IF;
  v_def := replace(v_def, v_anchor, v_insert);
  EXECUTE v_def;
END
$patch_return_validator$;

-- A linha do Ateliê não vira Entregue enquanto houver defeito sem destino.
-- Sem isso o rollup conclui a OS e o guard recusa o recebimento dos bons.
DO $patch_line_status$
DECLARE
  v_def text;
  v_old text := 'WHEN COALESCE(delivered_qty, 0) + v_physical >= quantity THEN ''Entregue''';
  v_new text := 'WHEN COALESCE(delivered_qty, 0) + v_physical >= quantity AND public.atelier_pending_defect(v_job.id) = 0 THEN ''Entregue''';
BEGIN
  SELECT pg_get_functiondef('public.atelier_post_receipt_return(uuid)'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'atelier_post_receipt_return ausente';
  END IF;
  IF strpos(v_def, 'atelier_pending_defect') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei o status Entregue da linha do Ateliê';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_line_status$;

-- Job com defeito ainda sem retrabalho ou descarte permanece recebido parcial.
DO $patch_apply_status$
DECLARE
  v_def text;
  v_old text := 'pipeline_status = v_status,';
  v_new text := 'pipeline_status = CASE WHEN public.atelier_pending_defect(p_job_id) > 0 AND v_status IN (''received_at_factory'', ''done'') THEN ''partially_received'' ELSE v_status END,';
BEGIN
  SELECT pg_get_functiondef('public.atelier_apply_received_total(uuid)'::regprocedure) INTO v_def;
  IF strpos(v_def, 'atelier_pending_defect(p_job_id)') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei o status do job na conferência';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_apply_status$;

CREATE OR REPLACE FUNCTION public.atelier_reverse_receipt_return(p_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.atelier_job_receipts%ROWTYPE;
  v_orig public.service_order_returns%ROWTYPE;
  v_new uuid;
  v_status text;
  v_ap uuid;
  v_amount numeric;
BEGIN
  SELECT * INTO v_receipt FROM public.atelier_job_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_orig
    FROM public.service_order_returns
   WHERE atelier_job_receipt_id = p_receipt_id
     AND reverses_return_id IS NULL
   ORDER BY created_at
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_order_returns WHERE reverses_return_id = v_orig.id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.service_order_returns (
    service_order_id, contractor_id, returned_at,
    qty_good, qty_defect, qty_defect_scrapped, qty_loss,
    defect_notes, created_by, reverses_return_id, adjustment_kind
  ) VALUES (
    v_orig.service_order_id, v_orig.contractor_id, now(),
    v_orig.qty_good, v_orig.qty_defect, v_orig.qty_defect_scrapped, v_orig.qty_loss,
    NULLIF(btrim(COALESCE(v_receipt.reversal_reason, '')), ''),
    COALESCE(v_receipt.reversed_by, auth.uid()),
    v_orig.id, 'reversal'
  )
  RETURNING id INTO v_new;

  INSERT INTO public.service_order_events (
    service_order_id, event_type, source_table, source_id,
    contractor_id, quantity, amount, metadata, actor_id
  ) VALUES (
    v_orig.service_order_id, 'return_reversed', 'service_order_returns', v_new,
    v_orig.contractor_id,
    v_orig.qty_good + v_orig.qty_defect + v_orig.qty_loss,
    NULL,
    jsonb_build_object(
      'original_return_id', v_orig.id,
      'receipt_id', p_receipt_id,
      'reason', NULLIF(btrim(COALESCE(v_receipt.reversal_reason, '')), ''),
      'qty_good', v_orig.qty_good,
      'qty_defect', v_orig.qty_defect,
      'qty_loss', v_orig.qty_loss
    ),
    COALESCE(v_receipt.reversed_by, auth.uid())
  );

  SELECT id, status, amount INTO v_ap, v_status, v_amount
    FROM public.accounts_payable
   WHERE reference_type = 'service_order_return'
     AND reference_id = v_orig.id
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;

  IF v_status = 'pending' THEN
    UPDATE public.accounts_payable
       SET status = 'cancelled',
           notes = concat_ws(' ', notes, 'Estornada:', NULLIF(btrim(COALESCE(v_receipt.reversal_reason, '')), '')),
           updated_at = now()
     WHERE id = v_ap;
  ELSIF v_status IS NOT NULL AND v_status <> 'cancelled' THEN
    INSERT INTO public.accounts_payable (
      description, category, due_date, amount, status, reference_id, reference_type, notes
    ) VALUES (
      'Crédito por estorno de conferência já paga',
      'service',
      CURRENT_DATE,
      v_amount,
      'pending',
      v_new,
      'service_order_return_credit',
      'A conta original já estava paga. Abater este crédito em vez de apagar o pagamento. Motivo: '
        || COALESCE(NULLIF(btrim(v_receipt.reversal_reason), ''), 'não informado')
    );
  END IF;

  UPDATE public.service_order_items
     SET delivered_qty = GREATEST(
           COALESCE(delivered_qty, 0)
           - (v_orig.qty_good + v_orig.qty_defect + v_orig.qty_loss),
           0
         ),
         line_status = 'Pendente',
         updated_at = now()
   WHERE id = (
     SELECT i.id FROM public.service_order_items i
      WHERE i.service_order_id = v_orig.service_order_id
        AND (i.atelier_job_id = v_receipt.job_id OR i.atelier_part_id = v_receipt.part_id)
      ORDER BY i.created_at
      LIMIT 1
   );

  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
  VALUES (
    COALESCE(v_receipt.reversed_by, auth.uid()),
    'estorno_recebimento_atelie',
    'service_order_returns',
    v_orig.id::text,
    jsonb_build_object(
      'reversal_return_id', v_new,
      'receipt_id', p_receipt_id,
      'reason', v_receipt.reversal_reason,
      'payable_status', v_status
    ),
    true, now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_reverse_receipt_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_reverse_receipt_return(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.atelier_rework_defect(p_receipt_id uuid, p_pairs integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.atelier_job_receipts%ROWTYPE;
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_return public.service_order_returns%ROWTYPE;
  v_open int;
  v_id uuid;
  v_dispatch uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_pairs IS NULL OR p_pairs <= 0 THEN
    RAISE EXCEPTION 'Informe os pares que voltam para retrabalho' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_receipt FROM public.atelier_job_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Conferência não encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_return
    FROM public.service_order_returns
   WHERE atelier_job_receipt_id = p_receipt_id AND reverses_return_id IS NULL
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta conferência não tem retorno na OS' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(SUM(pairs), 0) INTO v_open
    FROM public.atelier_defect_resolutions WHERE receipt_id = p_receipt_id;
  IF v_open + p_pairs > v_receipt.qty_defect THEN
    RAISE EXCEPTION 'O retrabalho passa do defeito desta entrada' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = v_receipt.job_id;
  INSERT INTO public.atelier_defect_resolutions (receipt_id, kind, pairs, reason, created_by)
  VALUES (p_receipt_id, 'rework', p_pairs, 'Devolvido para retrabalho', auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.service_order_dispatches (
    service_order_id, contractor_id, qty_dispatched, dispatched_at, notes, created_by
  ) VALUES (
    v_return.service_order_id, v_return.contractor_id, p_pairs, now(),
    'atelier-rework:' || v_id::text, auth.uid()
  )
  RETURNING id INTO v_dispatch;
  UPDATE public.atelier_defect_resolutions SET dispatch_id = v_dispatch WHERE id = v_id;
  INSERT INTO public.service_order_events (
    service_order_id, event_type, source_table, source_id, contractor_id, quantity, metadata
  ) VALUES (
    v_return.service_order_id, 'defect_rework', 'atelier_defect_resolutions', v_id,
    v_return.contractor_id, p_pairs,
    jsonb_build_object('receipt_id', p_receipt_id, 'dispatch_id', v_dispatch, 'payment', 'nenhum')
  );
  PERFORM public.atelier_apply_received_total(v_job.id);
  RETURN jsonb_build_object('ok', true, 'resolution_id', v_id, 'dispatch_id', v_dispatch);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_rework_defect(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_rework_defect(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_scrap_defect(
  p_receipt_id uuid,
  p_pairs integer,
  p_charge boolean DEFAULT false,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.atelier_job_receipts%ROWTYPE;
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_return public.service_order_returns%ROWTYPE;
  v_line public.service_order_items%ROWTYPE;
  v_open int;
  v_id uuid;
  v_product uuid;
  v_cost numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_pairs IS NULL OR p_pairs <= 0 THEN
    RAISE EXCEPTION 'Informe os pares que serão descartados' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do descarte' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_receipt FROM public.atelier_job_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Conferência não encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_return
    FROM public.service_order_returns
   WHERE atelier_job_receipt_id = p_receipt_id AND reverses_return_id IS NULL
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta conferência não tem retorno na OS' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(SUM(pairs), 0) INTO v_open
    FROM public.atelier_defect_resolutions WHERE receipt_id = p_receipt_id;
  IF v_open + p_pairs > v_receipt.qty_defect THEN
    RAISE EXCEPTION 'O descarte passa do defeito desta entrada' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = v_receipt.job_id;
  INSERT INTO public.service_order_returns (
    service_order_id, contractor_id, qty_good, qty_defect, qty_defect_scrapped, qty_loss,
    adjustment_kind, defect_notes, created_by
  ) VALUES (
    v_return.service_order_id, v_return.contractor_id, 0, p_pairs, p_pairs, 0,
    'scrap', btrim(p_reason), auth.uid()
  );
  INSERT INTO public.atelier_defect_resolutions (
    receipt_id, kind, pairs, charge_contractor, reason, created_by
  ) VALUES (
    p_receipt_id, 'scrap', p_pairs, COALESCE(p_charge, false), btrim(p_reason), auth.uid()
  )
  RETURNING id INTO v_id;

  IF COALESCE(p_charge, false) THEN
    SELECT * INTO v_line
      FROM public.service_order_items
     WHERE service_order_id = v_return.service_order_id
       AND (atelier_job_id = v_job.id OR atelier_part_id = v_receipt.part_id)
     ORDER BY created_at
     LIMIT 1;
    SELECT d.product_id INTO v_product
      FROM public.cabedal_prep_stock_debits d
     WHERE d.job_id = v_job.id
     ORDER BY d.created_at
     LIMIT 1;
    IF v_product IS NULL OR v_line.id IS NULL THEN
      RAISE EXCEPTION 'Não há produto do kit para cobrar o descarte neste job' USING ERRCODE = '22023';
    END IF;
    v_cost := COALESCE(v_line.unit_price, 0);
    INSERT INTO public.contractor_loss_claims (
      service_order_id, service_order_item_id, base_product_id,
      lost_quantity, base_unit_cost_snapshot, responsible_party, reason,
      idempotency_key, payload_hash, correlation_id
    ) VALUES (
      v_return.service_order_id, v_line.id, v_product,
      p_pairs, GREATEST(v_cost, 0), 'contractor', btrim(p_reason),
      'atelier-scrap:' || v_id::text,
      md5('atelier-scrap:' || v_id::text),
      gen_random_uuid()
    );
  END IF;

  UPDATE public.service_order_items
     SET line_status = 'Entregue', updated_at = now()
   WHERE service_order_id = v_return.service_order_id
     AND atelier_job_id = v_job.id
     AND COALESCE(delivered_qty, 0) >= quantity
     AND public.atelier_pending_defect(v_job.id) = 0;

  INSERT INTO public.service_order_events (
    service_order_id, event_type, source_table, source_id, quantity, metadata
  ) VALUES (
    v_return.service_order_id, 'defect_scrapped', 'atelier_defect_resolutions', v_id,
    p_pairs, jsonb_build_object('charge', COALESCE(p_charge, false), 'reason', btrim(p_reason))
  );
  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
  VALUES (
    auth.uid(), 'descarte_defeito_atelie', 'atelier_job_receipts', p_receipt_id::text,
    jsonb_build_object('pairs', p_pairs, 'charge', COALESCE(p_charge, false), 'reason', btrim(p_reason)),
    true, now()
  );
  PERFORM public.atelier_apply_received_total(v_job.id);
  RETURN jsonb_build_object('ok', true, 'resolution_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_scrap_defect(uuid, integer, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_scrap_defect(uuid, integer, boolean, text)
  TO authenticated, service_role;

-- Saldo: estorno subtrai, sucata não cria defeito novo.
CREATE OR REPLACE VIEW public.v_service_order_balance
WITH (security_invoker = true) AS
WITH d AS (
  SELECT service_order_id, COALESCE(sum(qty_dispatched), 0)::bigint AS explicit_dispatch
  FROM public.service_order_dispatches
  GROUP BY service_order_id
),
r AS (
  SELECT
    service_order_id,
    COALESCE(sum(CASE
      WHEN reverses_return_id IS NOT NULL THEN -qty_good
      WHEN adjustment_kind = 'scrap' THEN 0
      ELSE qty_good END), 0)::bigint AS good,
    COALESCE(sum(CASE
      WHEN reverses_return_id IS NOT NULL THEN -qty_defect
      WHEN adjustment_kind = 'scrap' THEN 0
      ELSE qty_defect END), 0)::bigint AS defect,
    COALESCE(sum(CASE
      WHEN reverses_return_id IS NOT NULL THEN -qty_loss
      WHEN adjustment_kind = 'scrap' THEN 0
      ELSE qty_loss END), 0)::bigint AS loss,
    COALESCE(sum(CASE
      WHEN reverses_return_id IS NOT NULL THEN -qty_defect_scrapped
      ELSE qty_defect_scrapped END), 0)::bigint AS scrapped,
    max(returned_at) AS last_return_at
  FROM public.service_order_returns
  GROUP BY service_order_id
),
b AS (
  SELECT
    so.*,
    COALESCE(d.explicit_dispatch, 0)::bigint AS explicit_dispatch,
    CASE
      WHEN COALESCE(so.dispatch_tracked, false) THEN COALESCE(d.explicit_dispatch, 0)::bigint
      ELSE so.quantity::bigint + COALESCE(d.explicit_dispatch, 0)::bigint
    END AS gross_dispatch,
    COALESCE(r.good, 0)::bigint AS good,
    COALESCE(r.defect, 0)::bigint AS defect,
    COALESCE(r.loss, 0)::bigint AS loss,
    COALESCE(r.scrapped, 0)::bigint AS scrapped,
    r.last_return_at
  FROM public.service_orders so
  LEFT JOIN d ON d.service_order_id = so.id
  LEFT JOIN r ON r.service_order_id = so.id
)
SELECT
  b.id AS service_order_id,
  b.contractor_id,
  b.quantity AS qty_sent,
  b.good AS qty_returned_good,
  b.defect AS qty_returned_defect,
  b.loss AS qty_loss,
  CASE
    WHEN public.normalize_service_order_status(b.status) IN ('Concluído', 'Cancelado') THEN 0::bigint
    ELSE GREATEST(0::bigint, b.gross_dispatch - (b.good + b.defect + b.loss))
  END AS qty_in_field,
  b.last_return_at,
  b.dispatch_tracked,
  b.gross_dispatch AS qty_dispatched,
  CASE
    WHEN public.normalize_service_order_status(b.status) IN ('Concluído', 'Cancelado') THEN 0::bigint
    ELSE GREATEST(0::bigint, b.quantity::bigint + GREATEST(0::bigint, b.defect - b.scrapped) - b.gross_dispatch)
  END AS qty_to_dispatch,
  GREATEST(0::bigint, (b.defect - b.scrapped) - GREATEST(0::bigint, b.gross_dispatch - b.quantity::bigint))
    AS qty_defect_pending_rework,
  b.loss + b.scrapped AS qty_short
FROM b;

GRANT SELECT ON public.v_service_order_balance TO authenticated, service_role;

-- O fechamento da OS usa o saldo líquido, já sem o estorno e sem a sucata fantasma.
DO $patch_apply_return$
DECLARE
  v_def text;
  v_old text := $old$    COALESCE(sum(r.qty_good), 0)::bigint,
    COALESCE(sum(r.qty_defect), 0)::bigint,
    COALESCE(sum(r.qty_loss), 0)::bigint,
    COALESCE(sum(r.qty_defect_scrapped), 0)::bigint,$old$;
  v_new text := $new$    COALESCE(sum(CASE WHEN r.reverses_return_id IS NOT NULL THEN -r.qty_good WHEN r.adjustment_kind = 'scrap' THEN 0 ELSE r.qty_good END), 0)::bigint,
    COALESCE(sum(CASE WHEN r.reverses_return_id IS NOT NULL THEN -r.qty_defect WHEN r.adjustment_kind = 'scrap' THEN 0 ELSE r.qty_defect END), 0)::bigint,
    COALESCE(sum(CASE WHEN r.reverses_return_id IS NOT NULL THEN -r.qty_loss WHEN r.adjustment_kind = 'scrap' THEN 0 ELSE r.qty_loss END), 0)::bigint,
    COALESCE(sum(CASE WHEN r.reverses_return_id IS NOT NULL THEN -r.qty_defect_scrapped ELSE r.qty_defect_scrapped END), 0)::bigint,$new$;
BEGIN
  SELECT pg_get_functiondef('public.tg_apply_service_order_return()'::regprocedure) INTO v_def;
  IF strpos(v_def, 'adjustment_kind') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei a soma do retorno para o estorno';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_apply_return$;

CREATE OR REPLACE FUNCTION public.atelier_receive_rework(p_resolution_id uuid, p_pairs integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.atelier_defect_resolutions%ROWTYPE;
  v_receipt public.atelier_job_receipts%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_pairs IS NULL OR p_pairs <= 0 THEN
    RAISE EXCEPTION 'Informe os pares bons que voltaram do retrabalho' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_res FROM public.atelier_defect_resolutions WHERE id = p_resolution_id FOR UPDATE;
  IF NOT FOUND OR v_res.kind <> 'rework' THEN
    RAISE EXCEPTION 'Retrabalho não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.atelier_job_receipts WHERE rework_resolution_id = p_resolution_id AND reversed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Este retrabalho já voltou' USING ERRCODE = '22023';
  END IF;
  IF p_pairs <> v_res.pairs THEN
    RAISE EXCEPTION 'O retorno do retrabalho tem de ser os % pares reenviados', v_res.pairs
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_receipt FROM public.atelier_job_receipts WHERE id = v_res.receipt_id;
  INSERT INTO public.atelier_job_receipts (
    job_id, part_id, pairs, qty_defect, qty_loss, note, created_by, rework_resolution_id
  ) VALUES (
    v_receipt.job_id, v_receipt.part_id, p_pairs, 0, 0,
    'Retorno do retrabalho', auth.uid(), p_resolution_id
  )
  RETURNING id INTO v_id;
  PERFORM public.atelier_apply_received_total(v_receipt.job_id);
  RETURN jsonb_build_object('ok', true, 'receipt_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_receive_rework(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_receive_rework(uuid, integer) TO authenticated, service_role;

-- O retorno bom do retrabalho, no mesmo tamanho, fecha o defeito pendente.
CREATE OR REPLACE FUNCTION public.tg_atelier_link_rework_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count int;
BEGIN
  IF NEW.rework_resolution_id IS NOT NULL OR COALESCE(NEW.qty_defect, 0) > 0 OR NEW.pairs <= 0 THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM public.atelier_defect_resolutions d
    JOIN public.atelier_job_receipts src ON src.id = d.receipt_id
   WHERE src.job_id = NEW.job_id
     AND src.reversed_at IS NULL
     AND d.kind = 'rework'
     AND d.pairs = NEW.pairs
     AND NOT EXISTS (
       SELECT 1 FROM public.atelier_job_receipts back
        WHERE back.rework_resolution_id = d.id AND back.reversed_at IS NULL
     );
  IF v_count <> 1 THEN
    RETURN NEW;
  END IF;
  SELECT d.id INTO v_id
    FROM public.atelier_defect_resolutions d
    JOIN public.atelier_job_receipts src ON src.id = d.receipt_id
   WHERE src.job_id = NEW.job_id
     AND src.reversed_at IS NULL
     AND d.kind = 'rework'
     AND d.pairs = NEW.pairs
     AND NOT EXISTS (
       SELECT 1 FROM public.atelier_job_receipts back
        WHERE back.rework_resolution_id = d.id AND back.reversed_at IS NULL
     )
   LIMIT 1;
  UPDATE public.atelier_job_receipts SET rework_resolution_id = v_id WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_link_rework_return ON public.atelier_job_receipts;
CREATE TRIGGER trg_atelier_link_rework_return
  AFTER INSERT ON public.atelier_job_receipts
  FOR EACH ROW EXECUTE FUNCTION public.tg_atelier_link_rework_return();

DROP FUNCTION IF EXISTS public.atelier_period_report(date, date);

CREATE OR REPLACE FUNCTION public.atelier_period_report(p_from date, p_to date)
RETURNS TABLE (
  side text, contractor_id uuid, contractor_name text,
  sent_pairs numeric, received_pairs numeric, pending_pairs numeric,
  late_jobs integer, avg_lead_first_days numeric, avg_lead_full_days numeric,
  cost numeric, done_pairs numeric, defect_pairs numeric, loss_pairs numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH bounds AS (
    SELECT COALESCE(p_from, CURRENT_DATE - 30) AS d0, COALESCE(p_to, CURRENT_DATE) AS d1
  ),
  jobs AS (
    SELECT j.id, j.pairs, j.sent_at, j.target_end, j.sector, j.contractor_id,
           CASE WHEN j.execution_mode = 'internal' THEN 'internal' ELSE 'contractor' END AS side,
           public.atelier_job_open_received(j.id) AS received_now
      FROM public.cabedal_prep_jobs j
     WHERE j.pipeline_status <> 'cancelled'
       AND j.sector IN ('costura_cabedal', 'aviamento')
  ),
  sent_rows AS (
    SELECT CASE WHEN p.execution_mode = 'internal' THEN 'internal' ELSE 'contractor' END AS side,
           p.contractor_id, p.pairs::numeric AS pairs,
           GREATEST(p.pairs - p.received_pairs, 0)::numeric AS pending,
           p.sent_at,
           (p.return_on IS NOT NULL AND p.return_on < CURRENT_DATE AND p.received_pairs + 1e-9 < p.pairs) AS late
      FROM public.atelier_job_parts p
      JOIN public.cabedal_prep_jobs j ON j.id = p.job_id
     WHERE j.pipeline_status <> 'cancelled'
       AND j.sector IN ('costura_cabedal', 'aviamento')
       AND p.sent_at IS NOT NULL
    UNION ALL
    SELECT j.side, j.contractor_id, j.pairs,
           GREATEST(j.pairs - j.received_now, 0), j.sent_at,
           j.target_end IS NOT NULL
             AND public.atelier_job_return_date(j.target_end, j.sector) < CURRENT_DATE
             AND j.received_now + 1e-9 < j.pairs
      FROM jobs j
     WHERE j.sent_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.atelier_job_parts p WHERE p.job_id = j.id)
  ),
  sent AS (
    SELECT side, contractor_id, SUM(pairs) AS sent_pairs, SUM(pending) AS pending_pairs,
           COUNT(*) FILTER (WHERE late)::int AS late_jobs
      FROM sent_rows, bounds b
     WHERE sent_at::date BETWEEN b.d0 AND b.d1 AND side = 'contractor'
     GROUP BY side, contractor_id
  ),
  receipts AS (
    SELECT j.side, j.contractor_id, r.pairs, COALESCE(r.qty_defect, 0) AS qty_defect,
           COALESCE(r.qty_loss, 0) AS qty_loss, r.created_at,
           COALESCE(p.sent_at, j.sent_at) AS sent_at, j.id AS job_id,
           COALESCE(p.unit_price, i.unit_price, 0) AS unit_price
      FROM public.atelier_job_receipts r
      JOIN jobs j ON j.id = r.job_id
      LEFT JOIN public.atelier_job_parts p ON p.id = r.part_id
      LEFT JOIN LATERAL (
        SELECT unit_price FROM public.service_order_items si
         WHERE (r.part_id IS NOT NULL AND si.atelier_part_id = r.part_id)
            OR (r.part_id IS NULL AND si.atelier_job_id = j.id)
         ORDER BY si.created_at LIMIT 1
      ) i ON true
      CROSS JOIN bounds b
     WHERE r.reversed_at IS NULL AND r.created_at::date BETWEEN b.d0 AND b.d1
  ),
  received AS (
    SELECT side, contractor_id, SUM(pairs) AS received_pairs,
           SUM(qty_defect) AS defect_pairs, SUM(qty_loss) AS loss_pairs,
           SUM(CASE WHEN side = 'contractor' THEN pairs * unit_price ELSE 0 END) AS cost,
           SUM(CASE WHEN side = 'internal' THEN pairs ELSE 0 END) AS done_pairs
      FROM receipts GROUP BY side, contractor_id
  ),
  first_receipt AS (
    SELECT j.id, MIN(r.created_at) AS first_at
      FROM jobs j
      JOIN public.atelier_job_receipts r ON r.job_id = j.id AND r.reversed_at IS NULL
     WHERE j.sent_at IS NOT NULL AND j.side = 'contractor'
     GROUP BY j.id
  ),
  full_receipt AS (
    SELECT j.id, MAX(r.created_at) AS full_at
      FROM jobs j
      JOIN public.atelier_job_receipts r ON r.job_id = j.id AND r.reversed_at IS NULL
     WHERE j.sent_at IS NOT NULL AND j.side = 'contractor' AND j.received_now + 1e-9 >= j.pairs
     GROUP BY j.id
  ),
  leads AS (
    SELECT j.contractor_id,
           AVG(EXTRACT(EPOCH FROM (f.first_at - j.sent_at)) / 86400.0)
             FILTER (WHERE j.sent_at::date BETWEEN b.d0 AND b.d1) AS avg_first,
           AVG(EXTRACT(EPOCH FROM (u.full_at - j.sent_at)) / 86400.0)
             FILTER (WHERE j.sent_at::date BETWEEN b.d0 AND b.d1) AS avg_full
      FROM jobs j
      CROSS JOIN bounds b
      LEFT JOIN first_receipt f ON f.id = j.id
      LEFT JOIN full_receipt u ON u.id = j.id
     WHERE j.side = 'contractor'
     GROUP BY j.contractor_id
  ),
  keys AS (
    SELECT side, contractor_id FROM sent
    UNION
    SELECT side, contractor_id FROM received
  )
  SELECT k.side, k.contractor_id,
         CASE WHEN k.side = 'internal' THEN NULL ELSE c.name END,
         COALESCE(s.sent_pairs, 0), COALESCE(r.received_pairs, 0), COALESCE(s.pending_pairs, 0),
         COALESCE(s.late_jobs, 0), ROUND(l.avg_first::numeric, 1), ROUND(l.avg_full::numeric, 1),
         ROUND(COALESCE(r.cost, 0), 2), COALESCE(r.done_pairs, 0),
         COALESCE(r.defect_pairs, 0), COALESCE(r.loss_pairs, 0)
    FROM keys k
    LEFT JOIN sent s ON s.side = k.side AND s.contractor_id IS NOT DISTINCT FROM k.contractor_id
    LEFT JOIN received r ON r.side = k.side AND r.contractor_id IS NOT DISTINCT FROM k.contractor_id
    LEFT JOIN leads l ON k.side = 'contractor' AND l.contractor_id IS NOT DISTINCT FROM k.contractor_id
    LEFT JOIN public.contractors c ON c.id = k.contractor_id
   ORDER BY k.side, c.name NULLS FIRST;
$$;

REVOKE ALL ON FUNCTION public.atelier_period_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_period_report(date, date) TO authenticated, service_role;
