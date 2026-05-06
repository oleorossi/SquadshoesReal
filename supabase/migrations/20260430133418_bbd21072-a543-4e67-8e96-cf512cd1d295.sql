-- Drop function para permitir troca de nomes de parâmetros
DROP FUNCTION IF EXISTS public.add_business_days(date, int);

CREATE OR REPLACE FUNCTION public.add_business_days(p_start_date date, p_days int)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_date date := p_start_date;
  v_left int := ABS(p_days);
  v_step int := CASE WHEN p_days >= 0 THEN 1 ELSE -1 END;
BEGIN
  WHILE v_left > 0 LOOP
    v_date := v_date + v_step;
    IF EXTRACT(ISODOW FROM v_date) BETWEEN 1 AND 5 THEN
      v_left := v_left - 1;
    END IF;
  END LOOP;
  RETURN v_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_business_days(date, int) TO authenticated;

-- Reaplica as dependências que usam essa função
DROP FUNCTION IF EXISTS public.compute_wave_timeline(p_sale_order_ids uuid[]) CASCADE;
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline    date,
  corte_start_date     date,
  costura_start_date   date,
  montagem_start_date  date,
  acabamento_start_date date,
  material_ready_date  date,
  purchase_deadline    date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int; v_lead_costura  int; v_lead_montagem int;
  v_lead_acab     int; v_lead_buffer   int; v_lead_supplier int;
  v_deadline      date;
BEGIN
  SELECT MIN(so.delivery_deadline) INTO v_deadline
  FROM public.sale_orders so WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;
  IF v_deadline IS NULL THEN RETURN; END IF;

  SELECT
    COALESCE(MAX(ts.lead_time_corte_dias), 2),
    COALESCE(MAX(ts.lead_time_costura_dias), 3),
    COALESCE(MAX(ts.lead_time_montagem_dias), 2),
    COALESCE(MAX(ts.lead_time_acabamento_dias), 1),
    COALESCE(MAX(ts.lead_time_buffer_material_dias), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM public.sale_order_items soi JOIN public.technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  SELECT COALESCE(MAX(COALESCE(p.supplier_lead_time_days, 7)), 7) INTO v_lead_supplier
  FROM public.sale_order_items soi JOIN public.sheet_materials sm ON sm.sheet_id = soi.reference_id
  JOIN public.products p ON p.id = sm.product_id WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  RETURN QUERY SELECT
    v_deadline,
    public.add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura + v_lead_corte)),
    public.add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura)),
    public.add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem)),
    public.add_business_days(v_deadline, -v_lead_acab),
    public.add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura + v_lead_corte + v_lead_buffer)),
    public.add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura + v_lead_corte + v_lead_buffer + v_lead_supplier));
END;
$$;

-- Travas de Integridade
DROP FUNCTION IF EXISTS public.check_grade_quantity_coherence() CASCADE;
CREATE OR REPLACE FUNCTION public.check_grade_quantity_coherence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_grade_sum numeric := 0;
BEGIN
  IF NEW.stock_grade IS NULL OR jsonb_typeof(NEW.stock_grade) <> 'object' THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(GREATEST(0, value::numeric)), 0) INTO v_grade_sum FROM jsonb_each_text(NEW.stock_grade);
  IF ABS(v_grade_sum - COALESCE(NEW.quantity, 0)) > 0.01 THEN
    RAISE EXCEPTION 'Inconsistência de grade no produto %: soma % != saldo %', NEW.id, v_grade_sum, NEW.quantity;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_grade_quantity_coherence ON public.products;
CREATE TRIGGER trg_check_grade_quantity_coherence
  BEFORE UPDATE ON public.products FOR EACH ROW
  WHEN (NEW.stock_grade IS DISTINCT FROM OLD.stock_grade OR NEW.quantity IS DISTINCT FROM OLD.quantity)
  EXECUTE FUNCTION public.check_grade_quantity_coherence();

-- Unicidade de OP
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_active_per_sale_order_item
  ON public.orders (sale_order_item_id) WHERE status <> 'Cancelada';

-- Estorno automático de reservas
DROP FUNCTION IF EXISTS public.auto_release_reservations_on_op_cancel() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_release_reservations_on_op_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Cancelada' AND OLD.status <> 'Cancelada' THEN
    UPDATE public.material_reservations SET status = 'cancelled', updated_at = now()
    WHERE order_id = NEW.id AND status IN ('reserved', 'partially_consumed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_release_reservations_on_op_cancel ON public.orders;
CREATE TRIGGER trg_auto_release_reservations_on_op_cancel
  AFTER UPDATE ON public.orders FOR EACH ROW
  WHEN (NEW.status = 'Cancelada' AND OLD.status IS DISTINCT FROM 'Cancelada')
  EXECUTE FUNCTION public.auto_release_reservations_on_op_cancel();
