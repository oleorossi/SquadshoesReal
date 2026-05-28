-- P1.1 (bug #5): popula purchase_orders.promised_date = created_at + eta_days
-- Antes: 100% das POs com promised_date NULL. Sem isso, dashboard de atrasos
-- não funciona — não há base pra comparar com hoje.
-- Trigger respeita edits manuais (só popula NULL → derivado).

CREATE OR REPLACE FUNCTION public.tg_purchase_orders_set_promised_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.promised_date IS NULL AND NEW.eta_days IS NOT NULL AND NEW.eta_days > 0 THEN
    NEW.promised_date := public.add_business_days(NEW.created_at::date, NEW.eta_days);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_purchase_orders_set_promised_date ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_set_promised_date
  BEFORE INSERT OR UPDATE OF eta_days, created_at
  ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_purchase_orders_set_promised_date();

UPDATE public.purchase_orders
SET promised_date = public.add_business_days(created_at::date, eta_days)
WHERE promised_date IS NULL
  AND eta_days IS NOT NULL
  AND eta_days > 0
  AND status NOT IN ('cancelled','received');

COMMENT ON FUNCTION public.tg_purchase_orders_set_promised_date() IS
  'Auditoria 28/05/2026: popula promised_date = created_at + eta_days (dias úteis) quando NULL. Preserva edits manuais.';
