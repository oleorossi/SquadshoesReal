-- OC do vencedor da cotação + inspeção de recebimento com NC — paridade Tutor32, compras #3.
--
-- (A) create_po_from_quotation: a cotação (RFQ) já elege vencedor; faltava virar OC.
--     Gera purchase_orders + itens com os preços do vencedor (líquidos de desconto).
-- (B) goods_receipt_inspections + record_receipt_inspection: inspeção de qualidade no
--     recebimento. Quantidade rejeitada (não-conformidade) é movida para QUARENTENA
--     reaproveitando move_stock_status (estoque #1).

-- (A) Gerar OC a partir do vencedor da cotação
CREATE OR REPLACE FUNCTION public.create_po_from_quotation(p_quotation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_q public.purchase_quotations%ROWTYPE;
  v_resp public.purchase_quotation_responses%ROWTYPE;
  v_supplier_name text;
  v_po_id uuid;
BEGIN
  SELECT * INTO v_q FROM public.purchase_quotations WHERE id = p_quotation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotação % não encontrada', p_quotation_id; END IF;

  -- vencedor: resposta is_winner; fallback p/ selected_supplier_id
  SELECT * INTO v_resp FROM public.purchase_quotation_responses
   WHERE quotation_id = p_quotation_id AND is_winner = true
   ORDER BY responded_at NULLS LAST LIMIT 1;
  IF NOT FOUND AND v_q.selected_supplier_id IS NOT NULL THEN
    SELECT * INTO v_resp FROM public.purchase_quotation_responses
     WHERE quotation_id = p_quotation_id AND supplier_id = v_q.selected_supplier_id LIMIT 1;
  END IF;
  IF v_resp.id IS NULL THEN
    RAISE EXCEPTION 'Cotação sem vencedor definido — selecione o vencedor antes de gerar a OC';
  END IF;

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_resp.supplier_id;

  INSERT INTO public.purchase_orders (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated)
  VALUES ('OC-COT-' || COALESCE(v_q.quotation_number, left(p_quotation_id::text,8)),
          'pending', v_resp.supplier_id, v_supplier_name, 0,
          'Gerada da cotação ' || COALESCE(v_q.quotation_number, p_quotation_id::text), false)
  RETURNING id INTO v_po_id;

  INSERT INTO public.purchase_order_items (purchase_order_id, product_id, quantity, unit, unit_price)
  SELECT v_po_id, qi.product_id, qi.quantity, qi.unit,
         ROUND(pr.unit_price * (1 - COALESCE(pr.discount_pct,0)/100.0), 6)
  FROM public.purchase_quotation_items qi
  JOIN public.purchase_quotation_prices pr
    ON pr.quotation_item_id = qi.id AND pr.response_id = v_resp.id
  WHERE qi.quotation_id = p_quotation_id;

  RETURN v_po_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_po_from_quotation(uuid) TO authenticated;

-- (B) Inspeção de recebimento
CREATE TABLE IF NOT EXISTS public.goods_receipt_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty_received numeric NOT NULL DEFAULT 0,
  qty_approved numeric NOT NULL DEFAULT 0,
  qty_rejected numeric NOT NULL DEFAULT 0,
  nc_reason text DEFAULT '',
  inspector text DEFAULT '',
  status text NOT NULL DEFAULT 'aprovado',  -- aprovado | parcial | rejeitado
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goods_receipt_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read gri" ON public.goods_receipt_inspections;
CREATE POLICY "auth read gri" ON public.goods_receipt_inspections FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write gri" ON public.goods_receipt_inspections;
CREATE POLICY "auth write gri" ON public.goods_receipt_inspections FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.record_receipt_inspection(
  p_po_id uuid,
  p_product_id uuid,
  p_qty_approved numeric,
  p_qty_rejected numeric,
  p_nc_reason text DEFAULT '',
  p_inspector text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_id uuid;
BEGIN
  IF COALESCE(p_qty_approved,0) < 0 OR COALESCE(p_qty_rejected,0) < 0 THEN
    RAISE EXCEPTION 'Quantidades não podem ser negativas';
  END IF;
  IF COALESCE(p_qty_approved,0) + COALESCE(p_qty_rejected,0) <= 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma quantidade (aprovada ou rejeitada)';
  END IF;

  v_status := CASE
    WHEN COALESCE(p_qty_rejected,0) = 0 THEN 'aprovado'
    WHEN COALESCE(p_qty_approved,0) = 0 THEN 'rejeitado'
    ELSE 'parcial' END;

  INSERT INTO public.goods_receipt_inspections
    (purchase_order_id, product_id, qty_received, qty_approved, qty_rejected, nc_reason, inspector, status)
  VALUES (p_po_id, p_product_id, COALESCE(p_qty_approved,0)+COALESCE(p_qty_rejected,0),
          COALESCE(p_qty_approved,0), COALESCE(p_qty_rejected,0), p_nc_reason, p_inspector, v_status)
  RETURNING id INTO v_id;

  -- não-conformidade: move o rejeitado do disponível para quarentena
  IF COALESCE(p_qty_rejected,0) > 0 THEN
    PERFORM public.move_stock_status(
      p_product_id, p_qty_rejected, 'disponivel', 'quarentena',
      'NC recebimento OC' || CASE WHEN p_nc_reason <> '' THEN ': '||p_nc_reason ELSE '' END);
  END IF;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_receipt_inspection(uuid, uuid, numeric, numeric, text, text) TO authenticated;
