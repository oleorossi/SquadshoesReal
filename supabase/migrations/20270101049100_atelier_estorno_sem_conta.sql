-- Estorno não gera conta a pagar. O gatilho vale no INSERT e no UPDATE:
-- se a linha é reversal, cancela título pending dela e não cria outro.
-- A conta 6fbc5ed3 (R$15 pending do estorno c0a643d3) sai. Fica só o R$20.

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
    UPDATE public.accounts_payable
       SET status = 'cancelled',
           notes = concat_ws(' ', notes, 'Estorno não gera título.'),
           updated_at = now()
     WHERE reference_type = 'service_order_return'
       AND reference_id = NEW.id
       AND lower(btrim(status)) IN ('pending', 'pendente', 'open', 'aberto');
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

DROP TRIGGER IF EXISTS trg_ap_per_so_return ON public.service_order_returns;
CREATE TRIGGER trg_ap_per_so_return
  AFTER INSERT OR UPDATE ON public.service_order_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_ap_per_service_order_return();

DELETE FROM public.accounts_payable ap
 USING public.service_order_returns r
 WHERE ap.id::text LIKE '6fbc5ed3%'
   AND r.id::text LIKE 'c0a643d3%'
   AND ap.reference_id = r.id
   AND ap.reference_type = 'service_order_return'
   AND r.adjustment_kind = 'reversal'
   AND r.service_order_id = 'bed7d9f9-50cb-45ca-802e-c35240457aa6'
   AND lower(btrim(ap.status)) = 'pending'
   AND ap.amount = 15
   AND COALESCE(ap.amount_paid, 0) = 0;
