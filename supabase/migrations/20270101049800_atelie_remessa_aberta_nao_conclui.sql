-- Remessa aberta: a conferência não pode concluir a OS enquanto ela ainda
-- aceita envio. O rollup das linhas (todas Entregue) fechava no primeiro
-- retorno integral, e a remessa seguinte do mesmo lote nascia noutra OS.
-- O estorno da conferência abatia delivered_qty da primeira linha do job
-- na OS, não da parte conferida.

CREATE OR REPLACE FUNCTION public.tg_service_order_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_os      uuid;
  v_total   numeric;
  v_meters  numeric;
  v_pend    integer;
  v_active  integer;
  v_cur     text;
  v_open    boolean;
BEGIN
  v_os := COALESCE(NEW.service_order_id, OLD.service_order_id);
  IF v_os IS NULL THEN RETURN NULL; END IF;

  SELECT
    COALESCE(SUM(total_value) FILTER (WHERE line_status <> 'Cancelado'), 0),
    COALESCE(SUM(meters)      FILTER (WHERE line_status <> 'Cancelado'), 0),
    COUNT(*) FILTER (WHERE line_status = 'Pendente'),
    COUNT(*) FILTER (WHERE line_status <> 'Cancelado')
  INTO v_total, v_meters, v_pend, v_active
  FROM public.service_order_items
  WHERE service_order_id = v_os;

  SELECT status, COALESCE(accepting_shipments, false)
    INTO v_cur, v_open
    FROM public.service_orders WHERE id = v_os;

  UPDATE public.service_orders
     SET total_value = v_total,
         -- Conclui quando há linhas ativas e NENHUMA pendente (todas entregues),
         -- e a OS não está cancelada/já concluída. Remessa aberta do Ateliê
         -- espera Encerrar envios — o rollup não fecha enquanto a marca vale.
         status = CASE
           WHEN v_active > 0 AND v_pend = 0
                AND NOT COALESCE(v_open, false)
                AND lower(btrim(v_cur)) NOT IN ('cancelado','cancelada','cancelled','concluído','concluido','finalizado')
             THEN 'Concluído'
           ELSE status END,
         updated_at = now()
   WHERE id = v_os;

  RETURN NULL;
END;
$$;

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
  v_paid boolean;
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
    contractor_id, quantity, metadata, actor_id
  ) VALUES (
    v_orig.service_order_id, 'return_reversed', 'service_order_returns', v_new,
    v_orig.contractor_id,
    v_orig.qty_good + v_orig.qty_defect + v_orig.qty_loss,
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

  UPDATE public.accounts_payable
     SET status = 'cancelled',
         notes = concat_ws(' ', notes, 'Estorno não gera título.'),
         updated_at = now()
   WHERE reference_type = 'service_order_return'
     AND reference_id = v_new
     AND lower(btrim(status)) NOT IN ('paid', 'pago', 'quitado');

  UPDATE public.accounts_payable
     SET status = 'cancelled',
         notes = concat_ws(' ', notes, 'Estornada:', NULLIF(btrim(COALESCE(v_receipt.reversal_reason, '')), '')),
         updated_at = now()
   WHERE reference_type = 'service_order_return'
     AND reference_id = v_orig.id
     AND lower(btrim(status)) IN ('pending', 'pendente', 'open', 'aberto');

  SELECT EXISTS (
    SELECT 1 FROM public.accounts_payable
     WHERE reference_type = 'service_order_return'
       AND reference_id = v_orig.id
       AND lower(btrim(status)) IN ('paid', 'pago', 'quitado')
  ) INTO v_paid;

  IF v_paid AND NOT EXISTS (
    SELECT 1 FROM public.accounts_payable
     WHERE reference_type = 'service_order_return_credit'
       AND reference_id = v_new
  ) THEN
    INSERT INTO public.accounts_payable (
      description, category, due_date, amount, status, reference_id, reference_type, notes
    )
    SELECT
      'Crédito por estorno de conferência já paga',
      'service',
      CURRENT_DATE,
      ap.amount,
      'pending',
      v_new,
      'service_order_return_credit',
      'A conta original já estava paga. Abater este crédito. Motivo: '
        || COALESCE(NULLIF(btrim(v_receipt.reversal_reason), ''), 'não informado')
    FROM public.accounts_payable ap
    WHERE ap.reference_type = 'service_order_return'
      AND ap.reference_id = v_orig.id
      AND lower(btrim(ap.status)) IN ('paid', 'pago', 'quitado')
    LIMIT 1;
  END IF;

  -- A conferência grava delivered_qty na linha da parte. O estorno tem que
  -- desfazer a mesma linha. job_id OR part_id + created_at pegava a primeira
  -- remessa do job na OS aberta.
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
        AND (
          CASE
            WHEN v_receipt.part_id IS NOT NULL THEN i.atelier_part_id = v_receipt.part_id
            ELSE i.atelier_job_id = v_receipt.job_id
          END
        )
      ORDER BY i.created_at
      LIMIT 1
   );

  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
  VALUES (
    COALESCE(v_receipt.reversed_by, auth.uid()),
    'estorno_recebimento_atelie',
    'service_order_returns',
    v_orig.id::text,
    jsonb_build_object('reversal_return_id', v_new, 'receipt_id', p_receipt_id, 'reason', v_receipt.reversal_reason),
    true, now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_reverse_receipt_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_reverse_receipt_return(uuid) TO service_role;
