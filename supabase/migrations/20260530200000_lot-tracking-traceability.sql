-- Item #6 do roadmap (auditoria 30/05). Lot tracking ativo + rastreabilidade
-- reversa OP→lote. Tabela lot_tracking já existia (0 registros) com 17 colunas.
-- Faltava RLS, vínculo em stock_movements, e RPCs de intake/consume.

ALTER TABLE public.lot_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lot_tracking_select ON public.lot_tracking;
CREATE POLICY lot_tracking_select ON public.lot_tracking
  FOR SELECT TO authenticated USING (is_approved_user());

DROP POLICY IF EXISTS lot_tracking_write ON public.lot_tracking;
CREATE POLICY lot_tracking_write ON public.lot_tracking
  FOR ALL TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente','almoxarifado']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','almoxarifado']));

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS lot_id uuid
    REFERENCES public.lot_tracking(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS stock_movements_lot_idx
  ON public.stock_movements(lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movements_order_idx
  ON public.stock_movements(order_id) WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_lot_intake(
  p_product_id uuid,
  p_quantity numeric,
  p_unit_cost numeric DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_supplier_lot text DEFAULT NULL,
  p_invoice_id uuid DEFAULT NULL,
  p_bin_location_id uuid DEFAULT NULL,
  p_received_date date DEFAULT CURRENT_DATE,
  p_expiry_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot_id uuid;
  v_lot_number text;
  v_seq int;
  v_product_name text;
  v_prev_qty numeric;
BEGIN
  IF NOT user_has_any_role(ARRAY['admin','gerente','almoxarifado']) THEN
    RAISE EXCEPTION 'Permission denied: requer admin/gerente/almoxarifado';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser > 0';
  END IF;

  SELECT name, COALESCE(quantity, 0) INTO v_product_name, v_prev_qty
    FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;

  SELECT COALESCE(MAX(CASE WHEN lot_number ~ ('^LOT-' || to_char(p_received_date,'YYYYMMDD') || '-\d+$')
                          THEN substring(lot_number FROM 'LOT-' || to_char(p_received_date,'YYYYMMDD') || '-(\d+)$')::int
                          ELSE 0 END), 0) + 1
    INTO v_seq
    FROM public.lot_tracking;

  v_lot_number := 'LOT-' || to_char(p_received_date, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.lot_tracking (
    id, product_id, lot_number, supplier_lot, supplier_id, invoice_id,
    quantity_received, quantity_available, quantity_consumed,
    unit_cost, received_date, expiry_date, bin_location_id, status, notes
  ) VALUES (
    gen_random_uuid(), p_product_id, v_lot_number, p_supplier_lot, p_supplier_id, p_invoice_id,
    p_quantity, p_quantity, 0,
    p_unit_cost, p_received_date, p_expiry_date, p_bin_location_id, 'active', p_notes
  )
  RETURNING id INTO v_lot_id;

  UPDATE public.products SET quantity = v_prev_qty + p_quantity, updated_at = now()
   WHERE id = p_product_id;

  INSERT INTO public.stock_movements (
    id, product_id, movement_type, quantity, previous_stock, new_stock,
    description, lot_id, created_at, user_id
  ) VALUES (
    gen_random_uuid(), p_product_id, 'entrada', p_quantity,
    v_prev_qty, v_prev_qty + p_quantity,
    'Entrada lote ' || v_lot_number || COALESCE(' (NF '||p_supplier_lot||')', ''),
    v_lot_id, now(), auth.uid()
  );

  RETURN v_lot_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_lot_intake(uuid, numeric, numeric, uuid, text, uuid, uuid, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_lot_intake(uuid, numeric, numeric, uuid, text, uuid, uuid, date, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_from_lot(
  p_lot_id uuid,
  p_order_id uuid,
  p_quantity numeric,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available numeric;
  v_product_id uuid;
  v_lot_number text;
  v_prev_qty numeric;
BEGIN
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser > 0';
  END IF;

  SELECT quantity_available, product_id, lot_number
    INTO v_available, v_product_id, v_lot_number
    FROM public.lot_tracking
    WHERE id = p_lot_id
    FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'Lote % não encontrado', p_lot_id;
  END IF;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'Saldo insuficiente no lote %: disponível %, solicitado %', v_lot_number, v_available, p_quantity;
  END IF;

  SELECT COALESCE(quantity, 0) INTO v_prev_qty FROM public.products WHERE id = v_product_id;

  UPDATE public.lot_tracking
     SET quantity_available = quantity_available - p_quantity,
         quantity_consumed = COALESCE(quantity_consumed, 0) + p_quantity,
         status = CASE WHEN quantity_available - p_quantity = 0 THEN 'depleted' ELSE status END,
         updated_at = now()
   WHERE id = p_lot_id;

  -- NB: consume_from_lot é caminho de rastreabilidade COMPLEMENTAR; quem
  -- decrementa products.quantity em produção é hybrid_debit_stock_for_order.
  -- Aqui só registramos o movement com lot_id pra rastreabilidade reversa,
  -- sem alterar products. previous_stock/new_stock = qty atual.
  INSERT INTO public.stock_movements (
    id, product_id, movement_type, quantity, previous_stock, new_stock,
    description, order_id, lot_id, created_at, user_id
  ) VALUES (
    gen_random_uuid(), v_product_id, 'saida', -p_quantity,
    v_prev_qty, v_prev_qty,
    'Consumo lote ' || v_lot_number || COALESCE(' · ' || p_notes, ''),
    p_order_id, p_lot_id, now(), auth.uid()
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_from_lot(uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_from_lot(uuid, uuid, numeric, text) TO authenticated;

CREATE OR REPLACE VIEW public.v_order_lot_traceability AS
SELECT
  sm.order_id,
  sm.product_id,
  p.name AS product_name,
  p.sku,
  lt.id AS lot_id,
  lt.lot_number,
  lt.supplier_lot,
  s.name AS supplier_name,
  lt.received_date,
  lt.expiry_date,
  ABS(sm.quantity) AS quantity_consumed,
  lt.unit_cost,
  ABS(sm.quantity) * COALESCE(lt.unit_cost, 0) AS cost_impact,
  sm.created_at AS consumed_at,
  sm.id AS movement_id,
  sm.description
FROM public.stock_movements sm
JOIN public.lot_tracking lt ON lt.id = sm.lot_id
JOIN public.products p ON p.id = sm.product_id
LEFT JOIN public.suppliers s ON s.id = lt.supplier_id
WHERE sm.order_id IS NOT NULL
  AND sm.movement_type = 'saida'
ORDER BY sm.created_at DESC;

ALTER VIEW public.v_order_lot_traceability SET (security_invoker = on);
GRANT SELECT ON public.v_order_lot_traceability TO authenticated;

CREATE OR REPLACE VIEW public.v_lots_active AS
SELECT
  lt.id, lt.product_id, p.name AS product_name, p.sku,
  lt.lot_number, lt.supplier_lot,
  lt.supplier_id, s.name AS supplier_name,
  lt.quantity_received, lt.quantity_available, lt.quantity_consumed,
  lt.unit_cost,
  lt.received_date, lt.expiry_date,
  lt.bin_location_id, bl.code AS bin_code, bl.name AS bin_name,
  lt.status, lt.notes,
  CASE WHEN lt.expiry_date IS NOT NULL AND lt.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
       THEN true ELSE false END AS expiring_soon,
  CASE WHEN lt.expiry_date IS NOT NULL AND lt.expiry_date < CURRENT_DATE
       THEN true ELSE false END AS expired
FROM public.lot_tracking lt
JOIN public.products p ON p.id = lt.product_id
LEFT JOIN public.suppliers s ON s.id = lt.supplier_id
LEFT JOIN public.bin_locations bl ON bl.id = lt.bin_location_id
WHERE COALESCE(lt.status, 'active') <> 'depleted'
ORDER BY lt.received_date DESC;

ALTER VIEW public.v_lots_active SET (security_invoker = on);
GRANT SELECT ON public.v_lots_active TO authenticated;
