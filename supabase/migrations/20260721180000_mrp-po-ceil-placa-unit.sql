-- ════════════════════════════════════════════════════════════════════════════
-- Fix MÉDIO (auditoria 2026-06-11) — generate_purchase_orders_from_mrp não
-- arredondava 'placa' pra cima.
-- ════════════════════════════════════════════════════════════════════════════
-- A lista de unidades discretas do CEIL tinha 'chapa' (sinônimo DEPRECADO) mas
-- não 'placa' (unidade canônica pós-normalização 20260702120000). Compra de EVA
-- em placa saía fracionada (ex.: 3,2 placas) — fornecedor não atende fração.
-- Adiciona 'placa'/'placas'. CREATE OR REPLACE (não recria v_mrp_needs — a
-- versão vigente é 20260721140000). Resto do corpo idêntico a 20260423205918.

CREATE OR REPLACE FUNCTION public.generate_purchase_orders_from_mrp(
  p_product_ids uuid[] DEFAULT NULL
) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_supplier uuid;
  v_po_id uuid;
  v_po_number text;
  v_qty_to_order numeric;
  v_unit_price_po numeric;
  v_unit_po text;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_mrp_needs
     WHERE suggested_qty > 0
       AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids))
     ORDER BY preferred_supplier_id NULLS LAST, product_name
  LOOP
    v_supplier := v_row.preferred_supplier_id;

    -- Calculate converted values
    v_qty_to_order := v_row.suggested_qty / COALESCE(v_row.conversion_rate, 1);
    v_unit_price_po := COALESCE(v_row.unit_price, 0) * COALESCE(v_row.conversion_rate, 1);
    v_unit_po := COALESCE(v_row.purchase_order_unit, v_row.unit);

    -- Apply min_order_quantity (usually in purchase units)
    v_qty_to_order := GREATEST(v_qty_to_order, COALESCE(v_row.min_order_quantity, 0));

    -- Round up for discrete units (inclui 'placa'/'placas' canônicos)
    IF v_unit_po IN ('un', 'cx', 'rolo', 'chapa', 'placa', 'placas', 'unidade', 'par') THEN
      v_qty_to_order := CEIL(v_qty_to_order);
    END IF;

    SELECT id INTO v_po_id
      FROM public.purchase_orders
     WHERE supplier_id IS NOT DISTINCT FROM v_supplier
       AND status = 'Rascunho'
       AND created_at > now() - interval '2 minutes'
     LIMIT 1;

    IF v_po_id IS NULL THEN
      v_po_number := 'PO-MRP-' || to_char(now(),'YYYYMMDDHH24MISS') ||
                     '-' || substr(md5(random()::text),1,4);
      INSERT INTO public.purchase_orders
        (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated)
      VALUES (
        v_po_number, 'Rascunho', v_supplier,
        COALESCE(v_row.supplier_name, ''),
        0,
        'Gerada automaticamente pelo MRP em ' || to_char(now(),'DD/MM/YYYY HH24:MI'),
        true
      ) RETURNING id INTO v_po_id;
    END IF;

    -- Insert item with converted values
    INSERT INTO public.purchase_order_items
      (purchase_order_id, product_id, quantity, unit_price, unit, current_stock, min_stock, suggested_quantity)
    VALUES (
      v_po_id, v_row.product_id,
      v_qty_to_order, v_unit_price_po, v_unit_po,
      v_row.on_hand, v_row.min_stock, v_row.suggested_qty
    );

    UPDATE public.purchase_orders
       SET total_value = (
         SELECT COALESCE(SUM(quantity * unit_price), 0)
           FROM public.purchase_order_items
          WHERE purchase_order_id = v_po_id
       ),
       updated_at = now()
     WHERE id = v_po_id;

    RETURN NEXT v_po_id;
  END LOOP;
END;
$$;
