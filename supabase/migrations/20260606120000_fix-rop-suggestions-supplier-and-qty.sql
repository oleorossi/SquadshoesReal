-- Fix #1+#7 (auditoria JIT 2026-06-06): generate_rop_purchase_suggestions() crashava
-- diariamente (cron jobid=4, 06:00) com FK 23503 porque v_products_below_rop emitia
-- group_suppliers.id (PK do vínculo, SEM FK p/ suppliers) em suggested_supplier_id, que
-- alimenta purchase_orders.supplier_id (FK -> suppliers.id). group_suppliers NÃO tem
-- coluna supplier_id (registro denormalizado). Resultado: 10 dias de falha silenciosa,
-- geração automática de compra 100% inoperante.
-- Correção: suggested_supplier_id = products.supplier_id SÓ quando existe em suppliers,
-- senão NULL (PO "A definir"). E saneia suggested_qty (vinha 100000/999991 por max_stock
-- default-lixo): só confia em max_stock se <= 10x min_stock; senão alvo = 2x min_stock.

CREATE OR REPLACE VIEW public.v_products_below_rop AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.group_id,
  p.category,
  p.unit,
  p.unit_price,
  p.quantity AS stock_qty,
  COALESCE(p.reserved_stock, 0::numeric) AS reserved_stock,
  GREATEST(0::numeric, p.quantity - COALESCE(p.reserved_stock, 0::numeric)) AS available_qty,
  p.min_stock,
  p.max_stock,
  CASE
    WHEN COALESCE(p.max_stock, 0::numeric) > 0::numeric
         AND p.max_stock <= GREATEST(COALESCE(p.min_stock, 0::numeric), 1::numeric) * 10::numeric
      THEN GREATEST(0::numeric, p.max_stock - GREATEST(0::numeric, p.quantity - COALESCE(p.reserved_stock, 0::numeric)))
    ELSE GREATEST(0::numeric, GREATEST(COALESCE(p.min_stock, 0::numeric), 1::numeric) * 2::numeric
                              - GREATEST(0::numeric, p.quantity - COALESCE(p.reserved_stock, 0::numeric)))
  END AS suggested_qty,
  COALESCE(p.supplier_lead_time_days, 10) AS supplier_lead_days,
  COALESCE(
    (SELECT s.name FROM public.suppliers s WHERE s.id = p.supplier_id),
    (SELECT gs.supplier_name FROM public.group_suppliers gs WHERE gs.group_id = p.group_id ORDER BY gs.updated_at DESC LIMIT 1),
    'A definir'
  ) AS suggested_supplier,
  (SELECT s.id FROM public.suppliers s WHERE s.id = p.supplier_id) AS suggested_supplier_id,
  COALESCE(
    (SELECT gsm.minimum_order FROM public.group_supplier_materials gsm
       WHERE gsm.group_id = p.group_id AND gsm.active = true ORDER BY gsm.updated_at DESC LIMIT 1),
    1::numeric
  ) AS supplier_moq,
  EXISTS (
    SELECT 1 FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
     WHERE poi.product_id = p.id
       AND po.status = ANY (ARRAY['suggested'::text, 'pending'::text, 'approved'::text])
  ) AS has_active_po
FROM public.products p
WHERE COALESCE(p.active, true) = true
  AND COALESCE(p.min_stock, 0::numeric) > 0::numeric
  AND GREATEST(0::numeric, p.quantity - COALESCE(p.reserved_stock, 0::numeric)) <= COALESCE(p.min_stock, 0::numeric);

-- Função: blindagem defensiva (fornecedor inexistente -> NULL, nunca FK 23503).
CREATE OR REPLACE FUNCTION public.generate_rop_purchase_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_supplier RECORD; v_prod RECORD; v_po_id uuid; v_total numeric; v_qty numeric;
  v_sup_id uuid; v_sup_name text;
  v_created int := 0; v_appended int := 0; v_items_added int := 0;
BEGIN
  FOR v_supplier IN
    SELECT suggested_supplier_id, COALESCE(suggested_supplier, 'A definir') AS supplier_name
      FROM public.v_products_below_rop WHERE NOT has_active_po
     GROUP BY suggested_supplier_id, suggested_supplier
  LOOP
    -- Guarda defensiva: fornecedor inexistente vira NULL (PO "A definir").
    v_sup_id := v_supplier.suggested_supplier_id;
    IF v_sup_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_sup_id) THEN
      v_sup_id := NULL;
    END IF;
    v_sup_name := v_supplier.supplier_name;

    SELECT id INTO v_po_id FROM public.purchase_orders
     WHERE COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(v_sup_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND status = 'suggested' AND auto_generated = true
       AND created_at > now() - interval '7 days'
     ORDER BY created_at DESC LIMIT 1;
    IF v_po_id IS NULL THEN
      INSERT INTO public.purchase_orders (status, supplier_id, supplier_name, total_value, auto_generated, notes)
      VALUES ('suggested', v_sup_id, v_sup_name, 0, true,
        'Sugestao automatica ROP em ' || to_char(now(), 'DD/MM/YYYY HH24:MI'))
      RETURNING id INTO v_po_id;
      v_created := v_created + 1;
    ELSE
      v_appended := v_appended + 1;
    END IF;
    v_total := COALESCE((SELECT total_value FROM public.purchase_orders WHERE id = v_po_id), 0);
    FOR v_prod IN
      SELECT * FROM public.v_products_below_rop
       WHERE NOT has_active_po
         AND COALESCE(suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(v_supplier.suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LOOP
      IF EXISTS (SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id = v_po_id AND product_id = v_prod.product_id) THEN CONTINUE; END IF;
      v_qty := GREATEST(v_prod.suggested_qty, COALESCE(v_prod.supplier_moq, 1));
      INSERT INTO public.purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
      VALUES (v_po_id, v_prod.product_id, v_prod.stock_qty, v_prod.min_stock, v_prod.max_stock, v_qty, v_qty, COALESCE(v_prod.unit_price, 0), v_prod.unit);
      v_total := v_total + v_qty * COALESCE(v_prod.unit_price, 0);
      v_items_added := v_items_added + 1;
    END LOOP;
    UPDATE public.purchase_orders SET total_value = v_total WHERE id = v_po_id;
  END LOOP;
  RETURN jsonb_build_object('pos_created', v_created, 'pos_appended', v_appended, 'items_added', v_items_added, 'run_at', now());
END;
$function$;
