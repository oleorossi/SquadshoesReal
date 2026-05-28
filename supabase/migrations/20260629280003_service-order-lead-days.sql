-- P2.1 (bug #6): lead time explícito em service_orders + contractors
-- Antes: quoted_deadline era manual; sistema não sabia quanto a contratada
-- demora. Agora cascata: quoted_lead_days (por OS) → default_lead_days
-- (por contratada) → 10 dias fallback. Auto-popula quoted_deadline.

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS quoted_lead_days int;

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS default_lead_days int;

COMMENT ON COLUMN public.service_orders.quoted_lead_days IS
  'Override por OS: quantos dias úteis a contratada tem pra entregar (a partir de service_date).';
COMMENT ON COLUMN public.contractors.default_lead_days IS
  'Lead time padrão da contratada (dias úteis). NULL = 10 dias fallback.';

CREATE OR REPLACE FUNCTION public.get_effective_os_lead_days(p_service_order_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    so.quoted_lead_days,
    c.default_lead_days,
    10
  )
  FROM service_orders so
  LEFT JOIN contractors c ON c.id = so.contractor_id
  WHERE so.id = p_service_order_id;
$function$;

CREATE OR REPLACE FUNCTION public.tg_service_orders_compute_quoted_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead int;
BEGIN
  IF NEW.quoted_deadline IS NULL AND NEW.service_date IS NOT NULL THEN
    v_lead := COALESCE(
      NEW.quoted_lead_days,
      (SELECT default_lead_days FROM contractors WHERE id = NEW.contractor_id),
      10
    );
    NEW.quoted_deadline := public.add_business_days(NEW.service_date, v_lead);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_service_orders_compute_quoted_deadline ON public.service_orders;
CREATE TRIGGER trg_service_orders_compute_quoted_deadline
  BEFORE INSERT OR UPDATE OF quoted_lead_days, service_date, contractor_id
  ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_service_orders_compute_quoted_deadline();

UPDATE public.service_orders so
SET quoted_deadline = public.add_business_days(
  so.service_date,
  COALESCE(so.quoted_lead_days, (SELECT default_lead_days FROM contractors WHERE id = so.contractor_id), 10)
)
WHERE so.quoted_deadline IS NULL
  AND so.service_date IS NOT NULL;
