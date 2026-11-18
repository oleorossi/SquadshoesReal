-- O estorno grava quantidade positiva com adjustment_kind = reversal.
-- Quem soma service_order_returns tem que inverter o sinal, senão o próximo
-- recebimento estoura "devolvidos > enviados". O título original da conferência
-- é que se cancela; o estorno não abre outro.

CREATE OR REPLACE FUNCTION public.service_order_return_physical_sign(
  p_kind text,
  p_reverses uuid
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_reverses IS NOT NULL OR p_kind = 'reversal' THEN -1
    WHEN p_kind = 'scrap' THEN 0
    ELSE 1
  END;
$$;

REVOKE ALL ON FUNCTION public.service_order_return_physical_sign(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_order_return_physical_sign(text, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_validate_service_order_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_contractor uuid;
  v_dispatched bigint := 0;
  v_returned bigint := 0;
  v_new_total bigint := 0;
  v_explicit_dispatch bigint := 0;
  v_projected_rework_credit bigint := 0;
  v_explicit_limit bigint := 0;
  v_sign integer;
BEGIN
  IF NEW.reverses_return_id IS NOT NULL
     OR COALESCE(NEW.adjustment_kind, '') IN ('reversal', 'scrap') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('service_order_flow:' || NEW.service_order_id::text));

  SELECT * INTO v_so
    FROM public.service_orders
   WHERE id = NEW.service_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço % não encontrada', NEW.service_order_id;
  END IF;

  IF TG_OP = 'INSERT'
     AND public.normalize_service_order_status(v_so.status) IN ('Concluído', 'Cancelado') THEN
    RAISE EXCEPTION 'OS % está % e não aceita novo retorno',
      COALESCE(v_so.order_number, v_so.id::text),
      public.normalize_service_order_status(v_so.status);
  END IF;

  v_contractor := COALESCE(NEW.contractor_id, v_so.contractor_id);

  IF NOT COALESCE(v_so.dispatch_tracked, false) AND v_contractor = v_so.contractor_id THEN
    v_dispatched := v_so.quantity::bigint;
  END IF;

  SELECT v_dispatched + COALESCE(sum(d.qty_dispatched), 0)::bigint
    INTO v_dispatched
    FROM public.service_order_dispatches d
   WHERE d.service_order_id = NEW.service_order_id
     AND COALESCE(d.contractor_id, v_so.contractor_id) = v_contractor;

  SELECT COALESCE(sum(
           public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id)
           * (r.qty_good + r.qty_defect + r.qty_loss)
         ), 0)::bigint
    INTO v_returned
    FROM public.service_order_returns r
    JOIN public.service_orders rso ON rso.id = r.service_order_id
   WHERE r.service_order_id = NEW.service_order_id
     AND COALESCE(r.contractor_id, rso.contractor_id) = v_contractor
     AND (TG_OP <> 'UPDATE' OR r.id <> NEW.id);

  v_sign := public.service_order_return_physical_sign(NEW.adjustment_kind, NEW.reverses_return_id);
  v_new_total := v_sign * (NEW.qty_good::bigint + NEW.qty_defect::bigint + NEW.qty_loss::bigint);
  IF v_returned + v_new_total > v_dispatched THEN
    RAISE EXCEPTION
      'Retorno excede o despacho do prestador: % devolvidos após o lançamento, % enviados (OS %)',
      v_returned + v_new_total,
      v_dispatched,
      COALESCE(v_so.order_number, v_so.id::text);
  END IF;

  SELECT COALESCE(sum(d.qty_dispatched), 0)::bigint
    INTO v_explicit_dispatch
    FROM public.service_order_dispatches d
   WHERE d.service_order_id = NEW.service_order_id;

  SELECT
    COALESCE(sum(
      public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id)
      * GREATEST(0, r.qty_defect - COALESCE(r.qty_defect_scrapped, 0))
    ), 0)::bigint
      + v_sign * GREATEST(0, NEW.qty_defect - COALESCE(NEW.qty_defect_scrapped, 0))::bigint
    INTO v_projected_rework_credit
    FROM public.service_order_returns r
   WHERE r.service_order_id = NEW.service_order_id
     AND (TG_OP <> 'UPDATE' OR r.id <> NEW.id);

  v_explicit_limit := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false)
      THEN v_so.quantity::bigint + v_projected_rework_credit
    ELSE v_projected_rework_credit
  END;
  IF v_explicit_dispatch > v_explicit_limit THEN
    RAISE EXCEPTION
      'Alteração do retorno removeria crédito de retrabalho já despachado: % enviados, limite projetado % (OS %)',
      v_explicit_dispatch,
      v_explicit_limit,
      COALESCE(v_so.order_number, v_so.id::text);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_validate_service_order_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_existing_dispatch bigint := 0;
  v_rework_credit bigint := 0;
  v_explicit_limit bigint := 0;
  v_after bigint := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('service_order_flow:' || NEW.service_order_id::text));

  SELECT * INTO v_so
    FROM public.service_orders
   WHERE id = NEW.service_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço % não encontrada', NEW.service_order_id;
  END IF;

  IF public.normalize_service_order_status(v_so.status) IN ('Concluído', 'Cancelado') THEN
    RAISE EXCEPTION 'OS % está % e não aceita novo despacho',
      COALESCE(v_so.order_number, v_so.id::text),
      public.normalize_service_order_status(v_so.status);
  END IF;

  SELECT COALESCE(sum(d.qty_dispatched), 0)::bigint
    INTO v_existing_dispatch
    FROM public.service_order_dispatches d
   WHERE d.service_order_id = NEW.service_order_id
     AND (TG_OP <> 'UPDATE' OR d.id <> NEW.id);

  SELECT COALESCE(sum(
           public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id)
           * GREATEST(0, r.qty_defect - COALESCE(r.qty_defect_scrapped, 0))
         ), 0)::bigint
    INTO v_rework_credit
    FROM public.service_order_returns r
   WHERE r.service_order_id = NEW.service_order_id;

  v_explicit_limit := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false)
      THEN v_so.quantity::bigint + v_rework_credit
    ELSE v_rework_credit
  END;
  v_after := v_existing_dispatch + NEW.qty_dispatched;

  IF v_after > v_explicit_limit THEN
    RAISE EXCEPTION
      'Envio excede o saldo autorizado da OS: % após o lançamento, limite % (% original + % de retrabalho)',
      v_after,
      v_explicit_limit,
      CASE WHEN COALESCE(v_so.dispatch_tracked, false) THEN v_so.quantity ELSE 0 END,
      v_rework_credit;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_ap_per_service_order_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_contractor uuid;
  v_amount numeric;
  v_days integer;
  v_due date;
  v_base date;
  v_cname text;
  v_supplier_id uuid;
  v_has_supplier_col boolean;
BEGIN
  IF NEW.reverses_return_id IS NOT NULL OR COALESCE(NEW.adjustment_kind, '') = 'reversal' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_so FROM public.service_orders WHERE id = NEW.service_order_id;
  IF NOT FOUND OR NOT COALESCE(v_so.dispatch_tracked, false) OR COALESCE(NEW.qty_good, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_contractor := COALESCE(NEW.contractor_id, v_so.contractor_id);
  SELECT COALESCE(payment_days, 30), COALESCE(NULLIF(trade_name, ''), name)
    INTO v_days, v_cname FROM public.contractors WHERE id = v_contractor;
  v_days := COALESCE(v_days, 30);
  IF v_days >= 999 THEN RETURN NEW; END IF;

  v_amount := NEW.qty_good * COALESCE(v_so.unit_price, 0);
  IF v_amount <= 0 THEN RETURN NEW; END IF;
  v_base := COALESCE(NEW.returned_at::date, CURRENT_DATE);
  v_due := v_base + v_days;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'contractors' AND column_name = 'supplier_id'
  ) INTO v_has_supplier_col;
  IF v_has_supplier_col THEN
    EXECUTE 'SELECT supplier_id FROM public.contractors WHERE id = $1'
      INTO v_supplier_id USING v_contractor;
  END IF;

  INSERT INTO public.accounts_payable (
    description, supplier_id, category, due_date, amount, status,
    reference_id, reference_type, notes
  ) VALUES (
    'OS ' || COALESCE(v_so.order_number, v_so.id::text) || ' — '
      || COALESCE(NULLIF(v_cname, ''), 'prestador') || ' (' || NEW.qty_good || ' pares aceitos)',
    v_supplier_id, 'service', v_due, v_amount, 'pending', NEW.id, 'service_order_return',
    'Gerado pela conferência de ' || v_base::text || ': '
      || NEW.qty_good || ' pares bons × ' || COALESCE(v_so.unit_price, 0)::text
      || '. Vencimento em ' || v_days || ' dias.'
  ) ON CONFLICT (reference_id) WHERE reference_type = 'service_order_return' DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.service_order_payable_amount(p_so public.service_orders)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.service_order_returns r WHERE r.service_order_id = p_so.id)
    THEN (
      SELECT COALESCE(SUM(
               public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id)
               * r.qty_good
             ), 0)
        FROM public.service_order_returns r
       WHERE r.service_order_id = p_so.id
    ) * COALESCE(p_so.unit_price, 0)
    ELSE COALESCE(p_so.total_value, 0)
  END;
$$;

-- O estorno cancela o título da conferência original. Não abre outro de R$15.
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
    jsonb_build_object('reversal_return_id', v_new, 'receipt_id', p_receipt_id, 'reason', v_receipt.reversal_reason),
    true, now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_reverse_receipt_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_reverse_receipt_return(uuid) TO service_role;

-- O par que volta do retrabalho não soma de novo nos 12 do job.
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
     AND r.reversed_at IS NULL
     AND r.rework_resolution_id IS NULL;
$$;

REVOKE ALL ON FUNCTION public.atelier_job_open_received(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_job_open_received(uuid) TO authenticated, service_role;

DO $patch_part_received$
DECLARE
  v_def text;
  v_old text := 'WHERE r.part_id = v_part.id AND r.reversed_at IS NULL;';
  v_new text := 'WHERE r.part_id = v_part.id AND r.reversed_at IS NULL AND r.rework_resolution_id IS NULL;';
BEGIN
  SELECT pg_get_functiondef('public.atelier_apply_received_total(uuid)'::regprocedure) INTO v_def;
  IF strpos(v_def, 'rework_resolution_id IS NULL') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei a soma da parte no recebimento';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_part_received$;

-- Saldo por prestador e o relatório de pares usam o mesmo sinal.
CREATE OR REPLACE VIEW public.v_service_order_contractor_balance
WITH (security_invoker = true) AS
WITH movements AS (
  SELECT
    so.id AS service_order_id,
    so.contractor_id,
    so.quantity::bigint AS dispatched,
    0::bigint AS good,
    0::bigint AS defect,
    0::bigint AS loss
  FROM public.service_orders so
  WHERE NOT COALESCE(so.dispatch_tracked, false)
  UNION ALL
  SELECT
    d.service_order_id,
    COALESCE(d.contractor_id, so.contractor_id),
    d.qty_dispatched::bigint,
    0::bigint, 0::bigint, 0::bigint
  FROM public.service_order_dispatches d
  JOIN public.service_orders so ON so.id = d.service_order_id
  UNION ALL
  SELECT
    r.service_order_id,
    COALESCE(r.contractor_id, so.contractor_id),
    0::bigint,
    (public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id) * r.qty_good)::bigint,
    (public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id) * r.qty_defect)::bigint,
    (public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id) * r.qty_loss)::bigint
  FROM public.service_order_returns r
  JOIN public.service_orders so ON so.id = r.service_order_id
)
SELECT
  m.service_order_id,
  m.contractor_id,
  COALESCE(sum(m.dispatched), 0)::bigint AS qty_dispatched,
  COALESCE(sum(m.good), 0)::bigint AS qty_good,
  COALESCE(sum(m.defect), 0)::bigint AS qty_defect,
  COALESCE(sum(m.loss), 0)::bigint AS qty_loss,
  CASE
    WHEN public.normalize_service_order_status(so.status) IN ('Concluído', 'Cancelado') THEN 0::bigint
    ELSE GREATEST(
      0::bigint,
      COALESCE(sum(m.dispatched), 0)::bigint
        - COALESCE(sum(m.good + m.defect + m.loss), 0)::bigint
    )
  END AS qty_in_field
FROM movements m
JOIN public.service_orders so ON so.id = m.service_order_id
GROUP BY m.service_order_id, m.contractor_id, so.status;

GRANT SELECT ON public.v_service_order_contractor_balance TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_contractor_metrics
WITH (security_invoker = true) AS
SELECT
  c.id AS contractor_id,
  COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, ''), '—') AS contractor_name,
  c.service_type,
  c.active,
  count(so.id) AS total_orders,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) = 'Concluído'
  ) AS completed_orders,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) = 'Cancelado'
  ) AS cancelled_orders,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) NOT IN ('Concluído', 'Cancelado')
  ) AS open_orders,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) = 'Concluído'
      AND so.quoted_deadline IS NOT NULL
      AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) <= so.quoted_deadline
  ) AS on_time_count,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) = 'Concluído'
      AND so.quoted_deadline IS NOT NULL
      AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline
  ) AS late_count,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) NOT IN ('Concluído', 'Cancelado')
      AND so.quoted_deadline IS NOT NULL
      AND so.quoted_deadline < CURRENT_DATE
  ) AS open_overdue_count,
  COALESCE(avg(
    CASE
      WHEN public.normalize_service_order_status(so.status) = 'Concluído'
       AND so.quoted_deadline IS NOT NULL
       AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline
      THEN COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) - so.quoted_deadline
      ELSE NULL::integer
    END
  ), 0::numeric)::numeric(10,1) AS avg_late_days,
  COALESCE(sum(
    CASE WHEN public.normalize_service_order_status(so.status) <> 'Cancelado'
      THEN so.total_value ELSE 0::numeric END
  ), 0::numeric) AS total_value_all,
  COALESCE(max(fin.paid_amount), 0::numeric) AS total_value_paid,
  COALESCE(sum(
    CASE WHEN public.normalize_service_order_status(so.status) NOT IN ('Concluído', 'Cancelado')
      THEN so.total_value ELSE 0::numeric END
  ), 0::numeric) AS total_value_open,
  COALESCE(sum(
    CASE WHEN public.normalize_service_order_status(so.status) <> 'Cancelado'
      THEN so.quantity ELSE 0 END
  ), 0::bigint) AS total_quantity,
  max(so.created_at) AS last_order_at,
  COALESCE(max(ret.qty_good), 0::bigint) AS total_returned_good,
  COALESCE(max(ret.qty_defect), 0::bigint) AS total_returned_defect,
  COALESCE(max(ret.qty_loss), 0::bigint) AS total_returned_loss,
  CASE
    WHEN COALESCE(max(ret.qty_good), 0::bigint) + COALESCE(max(ret.qty_defect), 0::bigint) > 0
    THEN round(
      100.0 * COALESCE(max(ret.qty_defect), 0::bigint)::numeric
        / (COALESCE(max(ret.qty_good), 0::bigint) + COALESCE(max(ret.qty_defect), 0::bigint))::numeric,
      1
    )
    ELSE NULL::numeric
  END AS defect_pct,
  COALESCE(sum(
    CASE WHEN public.normalize_service_order_status(so.status) = 'Concluído'
      THEN so.total_value ELSE 0::numeric END
  ), 0::numeric) AS total_value_completed,
  COALESCE(max(fin.unpaid_amount), 0::numeric) AS total_value_unpaid
FROM public.contractors c
LEFT JOIN public.service_orders so ON so.contractor_id = c.id
LEFT JOIN (
  SELECT
    COALESCE(r.contractor_id, so2.contractor_id) AS contractor_id,
    sum(public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id) * r.qty_good)::bigint AS qty_good,
    sum(public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id) * r.qty_defect)::bigint AS qty_defect,
    sum(public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id) * r.qty_loss)::bigint AS qty_loss
  FROM public.service_order_returns r
  JOIN public.service_orders so2 ON so2.id = r.service_order_id
  GROUP BY COALESCE(r.contractor_id, so2.contractor_id)
) ret ON ret.contractor_id = c.id
LEFT JOIN (
  SELECT
    p.contractor_id,
    sum(
      CASE
        WHEN lower(btrim(COALESCE(p.status, ''))) IN ('cancelled', 'cancelado', 'cancelada', 'estornado') THEN 0::numeric
        WHEN lower(btrim(COALESCE(p.status, ''))) IN ('paid', 'pago', 'quitado')
          THEN COALESCE(NULLIF(p.amount_paid, 0::numeric), p.amount)
        ELSE COALESCE(p.amount_paid, 0::numeric)
      END
    ) AS paid_amount,
    sum(
      CASE
        WHEN lower(btrim(COALESCE(p.status, ''))) IN (
          'paid', 'pago', 'quitado', 'cancelled', 'cancelado', 'cancelada', 'estornado'
        ) THEN 0::numeric
        ELSE GREATEST(0::numeric, p.amount - COALESCE(p.amount_paid, 0::numeric))
      END
    ) AS unpaid_amount
  FROM public.v_service_order_payables p
  GROUP BY p.contractor_id
) fin ON fin.contractor_id = c.id
GROUP BY c.id, c.trade_name, c.name, c.service_type, c.active;

GRANT SELECT ON public.v_contractor_metrics TO authenticated, service_role;

-- OS-00384: o título de R$15 da conferência estornada continua pending,
-- e o estorno criou uma linha cancelada duplicada. Só esta OS.
UPDATE public.accounts_payable ap
   SET status = 'cancelled',
       notes = concat_ws(' ', ap.notes, 'Estornada: correção do estorno da conferência.'),
       updated_at = now()
  FROM public.service_order_returns r
 WHERE r.service_order_id = 'bed7d9f9-50cb-45ca-802e-c35240457aa6'
   AND r.id::text LIKE 'c01c1b13%'
   AND r.reverses_return_id IS NULL
   AND ap.reference_type = 'service_order_return'
   AND ap.reference_id = r.id
   AND lower(btrim(ap.status)) IN ('pending', 'pendente', 'open', 'aberto')
   AND ap.amount = 15;

DELETE FROM public.accounts_payable ap
 USING public.service_order_returns r
 WHERE r.service_order_id = 'bed7d9f9-50cb-45ca-802e-c35240457aa6'
   AND r.adjustment_kind = 'reversal'
   AND r.id::text LIKE 'c0a643d3%'
   AND ap.reference_type = 'service_order_return'
   AND ap.reference_id = r.id
   AND lower(btrim(ap.status)) IN ('cancelled', 'cancelado', 'cancelada')
   AND COALESCE(ap.amount_paid, 0) = 0;
