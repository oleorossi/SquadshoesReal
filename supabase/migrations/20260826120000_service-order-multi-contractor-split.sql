-- OS dividida entre VÁRIOS prestadores: cada parcela de envio e cada recebimento
-- escolhe o prestador. "Na rua" e a conta a pagar passam a ser POR PRESTADOR.
-- Conta a pagar = A CADA RECEBIMENTO (pares bons × valor/par da ficha = OS.unit_price),
-- pro prestador que devolveu. Só vale pra OS dispatch_tracked (vindas do PV); OS
-- antigas/avulsas mantêm a conta no fechamento (1 prestador). accounts_payable vazio.
-- Aplicada via MCP em 2026-06-21.

ALTER TABLE public.service_order_dispatches
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES public.contractors(id);
ALTER TABLE public.service_order_returns
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES public.contractors(id);

-- Saldo POR PRESTADOR (alimenta os dialogs): enviado/recebido/na-rua de cada um.
CREATE OR REPLACE VIEW public.v_service_order_contractor_balance AS
  SELECT m.service_order_id, m.contractor_id,
    COALESCE(SUM(m.dispatched),0)::bigint AS qty_dispatched,
    COALESCE(SUM(m.good),0)::bigint AS qty_good,
    COALESCE(SUM(m.defect),0)::bigint AS qty_defect,
    COALESCE(SUM(m.loss),0)::bigint AS qty_loss,
    (COALESCE(SUM(m.dispatched),0) - COALESCE(SUM(m.good + m.defect + m.loss),0))::bigint AS qty_in_field
  FROM (
    SELECT d.service_order_id, COALESCE(d.contractor_id, so.contractor_id) AS contractor_id,
           d.qty_dispatched AS dispatched, 0 AS good, 0 AS defect, 0 AS loss
      FROM public.service_order_dispatches d JOIN public.service_orders so ON so.id = d.service_order_id
    UNION ALL
    SELECT r.service_order_id, COALESCE(r.contractor_id, so.contractor_id),
           0, r.qty_good, r.qty_defect, r.qty_loss
      FROM public.service_order_returns r JOIN public.service_orders so ON so.id = r.service_order_id
  ) m
  GROUP BY m.service_order_id, m.contractor_id;

-- Conta a pagar POR RECEBIMENTO (só OS dividida): pares bons × valor/par, pro prestador.
CREATE OR REPLACE FUNCTION public.tg_ap_per_service_order_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_so public.service_orders; v_contractor uuid; v_amount numeric; v_days int; v_due date; v_cname text;
BEGIN
  SELECT * INTO v_so FROM public.service_orders WHERE id = NEW.service_order_id;
  IF NOT FOUND OR NOT COALESCE(v_so.dispatch_tracked, false) THEN RETURN NEW; END IF;
  IF COALESCE(NEW.qty_good, 0) <= 0 THEN RETURN NEW; END IF;
  v_contractor := COALESCE(NEW.contractor_id, v_so.contractor_id);
  v_amount := NEW.qty_good * COALESCE(v_so.unit_price, 0);
  IF v_amount <= 0 THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.accounts_payable
             WHERE reference_type = 'service_order_return' AND reference_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(payment_days, 30), COALESCE(trade_name, name)
    INTO v_days, v_cname FROM public.contractors WHERE id = v_contractor;
  v_due := CURRENT_DATE + (COALESCE(v_days, 30) || ' days')::interval;
  INSERT INTO public.accounts_payable (
    description, supplier_id, category, due_date, amount, status, reference_id, reference_type, notes
  ) VALUES (
    'OS ' || COALESCE(v_so.order_number, v_so.id::text) || ' — ' || COALESCE(NULLIF(v_cname,''), 'prestador') ||
      ' (' || NEW.qty_good || ' pares)',
    NULL, 'service', v_due, v_amount, 'pending', NEW.id, 'service_order_return',
    'Recebimento de OS dividida em ' || CURRENT_DATE::text || ' — ' || COALESCE(NULLIF(v_cname,''), 'prestador') ||
      ': ' || NEW.qty_good || ' bons × ' || COALESCE(v_so.unit_price, 0)::text || '. Venc.: ' || COALESCE(v_days, 30) || ' dias.'
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ap_per_so_return ON public.service_order_returns;
CREATE TRIGGER trg_ap_per_so_return AFTER INSERT ON public.service_order_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_ap_per_service_order_return();

-- A conta a pagar NO FECHAMENTO pula OS dividida (essas pagam por recebimento, acima).
CREATE OR REPLACE FUNCTION public.tg_create_ap_for_service_order()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_supplier_id uuid; v_due_date date; v_amount numeric; v_has_supplier_col boolean;
  v_payment_days int; v_base_date date;
  v_finalized_statuses constant text[] := ARRAY['received', 'Concluído', 'concluido', 'finalizado', 'Finalizado'];
BEGIN
  IF COALESCE(NEW.dispatch_tracked, false) THEN RETURN NEW; END IF;  -- OS dividida paga por recebimento
  IF NEW.status IS NULL OR NOT (NEW.status = ANY (v_finalized_statuses)) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT NULL AND OLD.status = ANY (v_finalized_statuses) THEN RETURN NEW; END IF;
  v_amount := public.service_order_payable_amount(NEW);
  IF v_amount <= 0 THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.accounts_payable WHERE reference_type = 'service_order' AND reference_id = NEW.id) THEN RETURN NEW; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contractors' AND column_name='supplier_id') INTO v_has_supplier_col;
  IF v_has_supplier_col THEN
    EXECUTE 'SELECT supplier_id FROM public.contractors WHERE id = $1' INTO v_supplier_id USING NEW.contractor_id;
  ELSE
    v_supplier_id := NULL;
  END IF;
  SELECT COALESCE(c.payment_days, 30) INTO v_payment_days FROM public.contractors c WHERE c.id = NEW.contractor_id;
  v_payment_days := COALESCE(v_payment_days, 30);
  v_base_date := CURRENT_DATE;
  v_due_date  := v_base_date + (v_payment_days || ' days')::interval;
  INSERT INTO public.accounts_payable (description, supplier_id, category, due_date, amount, status, reference_id, reference_type, notes)
  VALUES (
    'OS ' || COALESCE(NEW.order_number, NEW.id::text) || ' — ' || COALESCE(NEW.description, 'Ordem de serviço'),
    v_supplier_id, 'service', v_due_date, v_amount, 'pending', NEW.id, 'service_order',
    'AP gerado na entrega da OS em ' || v_base_date::text || ' (pares bons devolvidos × preço). Vencimento: ' || v_payment_days || ' dias.'
  );
  RETURN NEW;
END;
$function$;
