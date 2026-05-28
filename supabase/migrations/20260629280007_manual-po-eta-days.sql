-- P3.3 (bug #4): POs manuais ganham eta_days automaticamente
-- Antes: trigger tg_purchase_orders_set_auto_eta filtrava `IF NOT auto_generated`
-- então POs criadas manualmente nasciam com eta_days=NULL, e isso cascateava
-- em promised_date=NULL (mesmo após P1.1).
-- Agora: todas as POs (manuais ou auto) recebem eta_days via cascata
-- get_effective_supplier_lead_days(product_id), e o trigger P1.1
-- popula promised_date automaticamente.

CREATE OR REPLACE FUNCTION public.tg_purchase_orders_set_auto_eta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
  v_eta int;
BEGIN
  -- Auditoria 28/05/2026: removido filtro `IF NOT auto_generated THEN RETURN`.
  -- POs manuais agora também ganham eta_days (que cascateia em promised_date).
  IF NEW.eta_days IS NOT NULL THEN RETURN NEW; END IF;
  SELECT product_id INTO v_product_id FROM purchase_order_items WHERE purchase_order_id = NEW.id LIMIT 1;
  IF v_product_id IS NULL THEN RETURN NEW; END IF;
  v_eta := public.get_effective_supplier_lead_days(v_product_id, NULL);
  IF v_eta IS NULL OR v_eta <= 0 THEN RETURN NEW; END IF;
  UPDATE public.purchase_orders SET eta_days = v_eta WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

-- Backfill: POs ativas com eta_days NULL ganham valor via cascata.
-- O UPDATE seta eta_days, que dispara o trigger BEFORE UPDATE de P1.1
-- (tg_purchase_orders_set_promised_date) e popula promised_date.
UPDATE public.purchase_orders po
SET eta_days = public.get_effective_supplier_lead_days(
  (SELECT product_id FROM public.purchase_order_items WHERE purchase_order_id = po.id LIMIT 1),
  NULL
)
WHERE po.eta_days IS NULL
  AND po.status NOT IN ('cancelled', 'received')
  AND EXISTS (SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id = po.id);
