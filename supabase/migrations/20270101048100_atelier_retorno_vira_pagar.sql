-- Fase 3. Cada conferência do Ateliê vira o retorno da OS e a conta
-- a pagar dos pares bons, no preço travado na linha. Estorno desfaz
-- os dois enquanto o título está em aberto e a produção não consumiu
-- (essa trava já está em reverse_atelier_job_receipt). Interno não gera título.

ALTER TABLE public.service_order_returns
  ADD COLUMN IF NOT EXISTS atelier_job_receipt_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_order_returns_atelier_receipt
  ON public.service_order_returns (atelier_job_receipt_id);

COMMENT ON COLUMN public.service_order_returns.atelier_job_receipt_id IS
  'Conferência do Ateliê que originou este retorno. Um lançamento, um retorno.';

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
  v_amount numeric;
BEGIN
  SELECT * INTO v_receipt FROM public.atelier_job_receipts WHERE id = p_receipt_id;
  IF NOT FOUND OR v_receipt.reversed_at IS NOT NULL THEN
    RETURN;
  END IF;

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

  v_amount := ROUND(v_receipt.pairs * COALESCE(v_line.unit_price, 0), 2);

  INSERT INTO public.service_order_returns (
    service_order_id, contractor_id, returned_at,
    qty_good, qty_defect, qty_defect_scrapped, qty_loss,
    defect_notes, created_by, atelier_job_receipt_id
  ) VALUES (
    v_job.service_order_id,
    v_job.contractor_id,
    COALESCE(v_receipt.created_at, now()),
    v_receipt.pairs,
    0, 0, 0,
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
           v_receipt.pairs, 0, 0, 0
     WHERE NOT EXISTS (
       SELECT 1 FROM public.service_order_return_items i
        WHERE i.service_order_return_id = v_return
          AND i.sale_order_item_id = v_job.sale_order_item_id
     );
  END IF;

  UPDATE public.service_order_items
     SET delivered_qty = COALESCE(delivered_qty, 0) + v_receipt.pairs,
         line_status = CASE
           WHEN COALESCE(delivered_qty, 0) + v_receipt.pairs >= quantity THEN 'Entregue'
           ELSE line_status
         END,
         updated_at = now()
   WHERE id = v_line.id;

  -- O gatilho da OS usa o preço médio do cabeçalho. A linha tem o preço travado.
  UPDATE public.accounts_payable
     SET amount = v_amount,
         notes = COALESCE(notes, '') || ' Valor da linha do Ateliê, não a média da remessa.'
   WHERE reference_type = 'service_order_return'
     AND reference_id = v_return
     AND status = 'pending';

  IF NOT FOUND AND v_amount > 0 THEN
    INSERT INTO public.accounts_payable (
      description, category, due_date, amount, status,
      reference_id, reference_type, notes
    )
    SELECT
      'OS ' || COALESCE(so.order_number, so.id::text) || ' — conferência Ateliê (' || v_receipt.pairs || ' pares)',
      'service',
      CURRENT_DATE + COALESCE(c.payment_days, 30),
      v_amount,
      'pending',
      v_return,
      'service_order_return',
      'Pares bons × tarifa travada no envio.'
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

CREATE OR REPLACE FUNCTION public.atelier_reverse_receipt_return(p_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_return uuid;
  v_status text;
  v_job_id uuid;
  v_pairs numeric;
  v_item uuid;
BEGIN
  SELECT id INTO v_return
    FROM public.service_order_returns
   WHERE atelier_job_receipt_id = p_receipt_id
   FOR UPDATE;
  IF v_return IS NULL THEN
    RETURN;
  END IF;

  SELECT status INTO v_status
    FROM public.accounts_payable
   WHERE reference_type = 'service_order_return'
     AND reference_id = v_return
   FOR UPDATE;

  IF v_status IS NOT NULL AND v_status <> 'pending' THEN
    RAISE EXCEPTION 'A conta desta conferência já não está em aberto. O estorno não apaga um pagamento.'
      USING ERRCODE = '22023';
  END IF;

  SELECT job_id, pairs INTO v_job_id, v_pairs
    FROM public.atelier_job_receipts
   WHERE id = p_receipt_id;

  SELECT sale_order_item_id INTO v_item
    FROM public.cabedal_prep_jobs
   WHERE id = v_job_id;

  DELETE FROM public.accounts_payable
   WHERE reference_type = 'service_order_return'
     AND reference_id = v_return
     AND status = 'pending';

  DELETE FROM public.service_order_return_items
   WHERE service_order_return_id = v_return;

  DELETE FROM public.service_order_returns
   WHERE id = v_return;

  UPDATE public.service_order_items
     SET delivered_qty = GREATEST(COALESCE(delivered_qty, 0) - COALESCE(v_pairs, 0), 0),
         line_status = CASE
           WHEN GREATEST(COALESCE(delivered_qty, 0) - COALESCE(v_pairs, 0), 0) >= quantity THEN 'Entregue'
           ELSE 'Pendente'
         END,
         updated_at = now()
   WHERE atelier_job_id = v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_reverse_receipt_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_reverse_receipt_return(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_atelier_receipt_posts_os()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.atelier_post_receipt_return(NEW.id);
  ELSIF TG_OP = 'UPDATE'
        AND OLD.reversed_at IS NULL
        AND NEW.reversed_at IS NOT NULL THEN
    PERFORM public.atelier_reverse_receipt_return(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_receipt_posts_os ON public.atelier_job_receipts;
CREATE TRIGGER trg_atelier_receipt_posts_os
  AFTER INSERT OR UPDATE OF reversed_at
  ON public.atelier_job_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_receipt_posts_os();
