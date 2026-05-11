-- Quando um PV tem taxa de frete por par (shipping_rate_per_pair > 0),
-- automaticamente cria uma despesa em financial_entries com:
--   • description: "Frete - {order_number}"
--   • amount: shipping_rate_per_pair * SUM(quantity dos itens)
--   • entry_date: hoje + 3 dias úteis (pagamento ao motorista)
--   • reference_type='sale_order_frete' / reference_id=sale_orders.id
--   • status='pendente'
-- Idempotente: se a entry já existe (mesmo reference), atualiza valor.
-- Cancela a entry se a taxa for zerada.

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS shipping_rate_per_pair numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sale_orders.shipping_rate_per_pair IS
  'Taxa de frete por par (R$). Quando > 0, gera financial_entry de despesa '
  'automaticamente via trigger tg_sale_order_creates_shipping_expense.';

CREATE OR REPLACE FUNCTION public.tg_sale_order_creates_shipping_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_pairs int;
  v_amount numeric;
  v_due_date date;
  v_existing uuid;
BEGIN
  IF COALESCE(NEW.shipping_rate_per_pair, 0) <= 0 THEN
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.shipping_rate_per_pair, 0) > 0 THEN
      UPDATE public.financial_entries
         SET status = 'cancelado',
             updated_at = now()
       WHERE reference_type = 'sale_order_frete'
         AND reference_id = NEW.id::text
         AND status = 'pendente';
    END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(quantity)::int, 0) INTO v_total_pairs
    FROM public.sale_order_items
   WHERE sale_order_id = NEW.id;

  IF v_total_pairs <= 0 THEN
    RETURN NEW;
  END IF;

  v_amount := NEW.shipping_rate_per_pair * v_total_pairs;
  v_due_date := public.add_business_days(CURRENT_DATE, 3)::date;

  SELECT id INTO v_existing
    FROM public.financial_entries
   WHERE reference_type = 'sale_order_frete'
     AND reference_id = NEW.id::text
     AND status = 'pendente'
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.financial_entries
       SET amount = v_amount,
           description = 'Frete - ' || COALESCE(NEW.order_number, NEW.id::text),
           updated_at = now()
     WHERE id = v_existing;
  ELSE
    INSERT INTO public.financial_entries (
      entry_date, type, description, amount,
      reference_type, reference_id, status, notes
    ) VALUES (
      v_due_date,
      'despesa',
      'Frete - ' || COALESCE(NEW.order_number, NEW.id::text),
      v_amount,
      'sale_order_frete',
      NEW.id::text,
      'pendente',
      'Lançamento automático gerado ao criar/atualizar PV com taxa de frete por par. ' ||
        'Pagamento previsto pra ' || to_char(v_due_date, 'DD/MM/YYYY') ||
        ' (3 dias úteis). Taxa: R$ ' || NEW.shipping_rate_per_pair ||
        '/par × ' || v_total_pairs || ' pares.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_order_creates_shipping_expense ON public.sale_orders;
CREATE TRIGGER trg_sale_order_creates_shipping_expense
  AFTER INSERT OR UPDATE OF shipping_rate_per_pair, order_number ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sale_order_creates_shipping_expense();

CREATE OR REPLACE FUNCTION public.tg_resync_shipping_on_items_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so_id uuid;
BEGIN
  v_so_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_so_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  UPDATE public.sale_orders SET updated_at = now() WHERE id = v_so_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_resync_shipping_on_items ON public.sale_order_items;
CREATE TRIGGER trg_resync_shipping_on_items
  AFTER INSERT OR UPDATE OF quantity OR DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_resync_shipping_on_items_change();

GRANT EXECUTE ON FUNCTION public.tg_sale_order_creates_shipping_expense() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_resync_shipping_on_items_change() TO authenticated;
