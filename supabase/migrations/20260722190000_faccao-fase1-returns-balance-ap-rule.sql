-- ============================================================================
-- TERCEIRIZAÇÃO/FACÇÃO Fase 1 (avaliação 2026-06-10): retorno PARCIAL com
-- bons/defeito/perda, saldo na rua por OS, e UMA regra de conta a pagar
-- (pares devolvidos BONS × preço — não o enviado). + 2.1 tabela de preço.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  returned_at timestamptz NOT NULL DEFAULT now(),
  qty_good integer NOT NULL DEFAULT 0 CHECK (qty_good >= 0),
  qty_defect integer NOT NULL DEFAULT 0 CHECK (qty_defect >= 0),
  qty_loss integer NOT NULL DEFAULT 0 CHECK (qty_loss >= 0),
  defect_notes text,
  signed_photo_url text,
  settlement_id uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (qty_good + qty_defect + qty_loss > 0)
);
CREATE INDEX IF NOT EXISTS idx_so_returns_so ON public.service_order_returns(service_order_id);

ALTER TABLE public.service_order_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS so_returns_rw ON public.service_order_returns;
CREATE POLICY so_returns_rw ON public.service_order_returns
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_order_returns TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_validate_service_order_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_qty integer;
  v_sum integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('so_return:' || NEW.service_order_id::text));

  SELECT quantity INTO v_qty FROM public.service_orders WHERE id = NEW.service_order_id FOR UPDATE;
  IF v_qty IS NULL THEN
    RAISE EXCEPTION 'Ordem de serviço % não encontrada', NEW.service_order_id;
  END IF;

  SELECT COALESCE(SUM(qty_good + qty_defect + qty_loss), 0) INTO v_sum
    FROM public.service_order_returns
   WHERE service_order_id = NEW.service_order_id
     AND (TG_OP <> 'UPDATE' OR id <> NEW.id);
  v_sum := v_sum + NEW.qty_good + NEW.qty_defect + NEW.qty_loss;

  IF v_sum > v_qty THEN
    RAISE EXCEPTION 'Retorno excede o enviado: % devolvidos de % enviados (OS)', v_sum, v_qty;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_so_return ON public.service_order_returns;
CREATE TRIGGER trg_validate_so_return
  BEFORE INSERT OR UPDATE ON public.service_order_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_service_order_return();

CREATE OR REPLACE FUNCTION public.tg_apply_service_order_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_qty integer;
  v_sum integer;
  v_last timestamptz;
BEGIN
  SELECT quantity INTO v_qty FROM public.service_orders WHERE id = NEW.service_order_id;
  SELECT COALESCE(SUM(qty_good + qty_defect + qty_loss), 0), MAX(returned_at)
    INTO v_sum, v_last
    FROM public.service_order_returns WHERE service_order_id = NEW.service_order_id;

  IF v_sum >= COALESCE(v_qty, 0) AND COALESCE(v_qty, 0) > 0 THEN
    UPDATE public.service_orders
       SET status = 'Concluído', delivered_at = v_last, updated_at = now()
     WHERE id = NEW.service_order_id
       AND COALESCE(status,'') NOT IN ('Concluído','concluido','received','finalizado','Finalizado','Cancelado','cancelled');
  ELSE
    UPDATE public.service_orders
       SET status = 'Em Andamento', updated_at = now()
     WHERE id = NEW.service_order_id
       AND COALESCE(status,'') IN ('Pendente','pendente');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_apply_so_return ON public.service_order_returns;
CREATE TRIGGER trg_apply_so_return
  AFTER INSERT OR UPDATE OR DELETE ON public.service_order_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_apply_service_order_return();

CREATE OR REPLACE VIEW public.v_service_order_balance AS
SELECT so.id AS service_order_id,
       so.contractor_id,
       so.quantity AS qty_sent,
       COALESCE(r.good, 0)   AS qty_returned_good,
       COALESCE(r.defect, 0) AS qty_returned_defect,
       COALESCE(r.loss, 0)   AS qty_loss,
       so.quantity - COALESCE(r.good + r.defect + r.loss, 0) AS qty_in_field,
       r.last_return_at
FROM public.service_orders so
LEFT JOIN (
  SELECT service_order_id,
         SUM(qty_good) AS good, SUM(qty_defect) AS defect, SUM(qty_loss) AS loss,
         MAX(returned_at) AS last_return_at
    FROM public.service_order_returns GROUP BY service_order_id
) r ON r.service_order_id = so.id;
GRANT SELECT ON public.v_service_order_balance TO authenticated;

CREATE OR REPLACE FUNCTION public.service_order_payable_amount(p_so public.service_orders)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.service_order_returns r WHERE r.service_order_id = p_so.id)
    THEN (SELECT COALESCE(SUM(r.qty_good), 0) FROM public.service_order_returns r WHERE r.service_order_id = p_so.id)
         * COALESCE(p_so.unit_price, 0)
    ELSE COALESCE(p_so.total_value, 0)
  END;
$$;

CREATE OR REPLACE FUNCTION public.tg_create_ap_for_service_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_supplier_id uuid;
  v_due_date    date;
  v_amount      numeric;
  v_has_supplier_col boolean;
  v_payment_days int;
  v_base_date date;
  v_finalized_statuses constant text[] := ARRAY['received', 'Concluído', 'concluido', 'finalizado', 'Finalizado'];
BEGIN
  IF NEW.status IS NULL OR NOT (NEW.status = ANY (v_finalized_statuses)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT NULL AND OLD.status = ANY (v_finalized_statuses) THEN
    RETURN NEW;
  END IF;

  v_amount := public.service_order_payable_amount(NEW);
  IF v_amount <= 0 THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounts_payable
    WHERE reference_type = 'service_order' AND reference_id = NEW.id
  ) THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contractors' AND column_name='supplier_id'
  ) INTO v_has_supplier_col;

  IF v_has_supplier_col THEN
    EXECUTE 'SELECT supplier_id FROM public.contractors WHERE id = $1'
      INTO v_supplier_id USING NEW.contractor_id;
  ELSE
    v_supplier_id := NULL;
  END IF;

  SELECT COALESCE(c.payment_days, 30) INTO v_payment_days
  FROM public.contractors c WHERE c.id = NEW.contractor_id;
  v_payment_days := COALESCE(v_payment_days, 30);

  v_base_date := CURRENT_DATE;
  v_due_date  := v_base_date + (v_payment_days || ' days')::interval;

  INSERT INTO public.accounts_payable (
    description, supplier_id, category, due_date, amount, status,
    reference_id, reference_type, notes
  ) VALUES (
    'OS ' || COALESCE(NEW.order_number, NEW.id::text) ||
      ' — ' || COALESCE(NEW.description, 'Ordem de serviço'),
    v_supplier_id, 'service', v_due_date, v_amount, 'pending',
    NEW.id, 'service_order',
    'AP gerado na entrega da OS em ' || v_base_date::text ||
      ' (pares bons devolvidos × preço). Vencimento: ' || v_payment_days || ' dias.'
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_sync_ap_on_service_order_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_amount numeric;
BEGIN
  IF NEW.total_value IS DISTINCT FROM OLD.total_value OR NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
    v_amount := public.service_order_payable_amount(NEW);
    IF v_amount > 0 THEN
      UPDATE public.accounts_payable
      SET amount = v_amount, updated_at = now()
      WHERE reference_type = 'service_order' AND reference_id = NEW.id
        AND status = 'pending';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.contractor_service_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  sector text NOT NULL,
  price_per_pair numeric NOT NULL CHECK (price_per_pair >= 0),
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_to date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, sector, valid_from)
);
ALTER TABLE public.contractor_service_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contractor_rates_rw ON public.contractor_service_rates;
CREATE POLICY contractor_rates_rw ON public.contractor_service_rates
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contractor_service_rates TO authenticated;

CREATE OR REPLACE FUNCTION public.get_contractor_rate(p_contractor_id uuid, p_sector text, p_date date DEFAULT CURRENT_DATE)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT price_per_pair
    FROM public.contractor_service_rates
   WHERE contractor_id = p_contractor_id
     AND lower(sector) = lower(p_sector)
     AND valid_from <= p_date
     AND (valid_to IS NULL OR valid_to >= p_date)
   ORDER BY valid_from DESC
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_contractor_rate(uuid, text, date) TO authenticated;
