-- ============================================================================
-- B2 — MRP: eliminar linha de item duplicada sob concorrência
-- ============================================================================
-- Avaliação dos motores (2026-07-08): `generate_purchase_orders_from_mrp` fazia
-- um INSERT cru em purchase_order_items SEM merge-por-produto e SEM
-- idempotency_key. O advisory lock por fornecedor impede OC duplicada, mas NÃO
-- impede LINHA duplicada: duas gerações concorrentes (ou re-run) — cada uma com
-- um snapshot de v_mrp_needs onde o qty_in_po da outra ainda não aparece —
-- passam ambas por suggested_qty > 0 e consolidam DUAS linhas do mesmo produto
-- na mesma OC → quantidade dobrada.
--
-- Fix: rotear o insert pelo RPC já existente e testado `upsert_po_item_atomic`
-- (usado por materialAutoPO.ts), que faz merge atômico por (po, produto) e
-- atualiza total_value na mesma transação. `suggested_quantity` (não setado
-- pelo upsert) é preservado por um UPDATE logo após. Nenhuma outra lógica muda.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_purchase_orders_from_mrp(p_product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record; v_supplier uuid; v_po_id uuid; v_po_number text;
  v_qty_to_order numeric; v_unit_price_po numeric; v_unit_po text;
  v_linked uuid[]; v_lock_key bigint; v_multiple numeric;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_mrp_needs
     WHERE suggested_qty > 0 AND NOT COALESCE(is_packaging, false)
       AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids))
     ORDER BY preferred_supplier_id NULLS LAST, product_name
  LOOP
    v_supplier := v_row.preferred_supplier_id;
    v_qty_to_order := v_row.suggested_qty / COALESCE(v_row.conversion_rate, 1);
    v_unit_price_po := COALESCE(v_row.unit_price, 0) * COALESCE(v_row.conversion_rate, 1);
    v_unit_po := COALESCE(v_row.purchase_order_unit, v_row.unit);
    v_qty_to_order := GREATEST(v_qty_to_order, COALESCE(v_row.min_order_quantity, 0));
    IF v_unit_po IN ('un', 'cx', 'rolo', 'chapa', 'placa', 'unidade', 'par') THEN
      v_qty_to_order := CEIL(v_qty_to_order);
    END IF;
    SELECT COALESCE(NULLIF(pr.purchase_multiple, 0), NULLIF(pg.purchase_multiple, 0), 0) INTO v_multiple
      FROM public.products pr LEFT JOIN public.product_groups pg ON pg.id = pr.group_id WHERE pr.id = v_row.product_id;
    IF v_multiple IS NOT NULL AND v_multiple > 1 THEN
      v_qty_to_order := CEIL(v_qty_to_order / v_multiple) * v_multiple;
    END IF;
    v_lock_key := hashtextextended(COALESCE(v_supplier::text, 'no-supplier'), 0);
    PERFORM pg_advisory_xact_lock(v_lock_key);
    SELECT ARRAY_AGG(DISTINCT so.id) INTO v_linked FROM sale_orders so
      JOIN sale_order_items soi ON soi.sale_order_id = so.id
      JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
     WHERE sm.product_id = v_row.product_id AND so.deleted_at IS NULL AND so.status IN ('Aprovado', 'Em Produção');
    SELECT id INTO v_po_id FROM public.purchase_orders
     WHERE supplier_id IS NOT DISTINCT FROM v_supplier AND status = 'pending' AND auto_generated = true
       AND created_at > now() - interval '2 minutes' LIMIT 1;
    IF v_po_id IS NULL THEN
      v_po_number := 'PO-MRP-' || to_char(now(),'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text),1,4);
      INSERT INTO public.purchase_orders (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated, linked_sale_order_ids)
      VALUES (v_po_number, 'pending', v_supplier, COALESCE(v_row.supplier_name, ''), 0,
        'Gerada automaticamente pelo MRP em ' || to_char(now(),'DD/MM/YYYY HH24:MI'), true, COALESCE(v_linked, ARRAY[]::uuid[]))
      RETURNING id INTO v_po_id;
    ELSE
      UPDATE public.purchase_orders SET linked_sale_order_ids = (
        SELECT ARRAY_AGG(DISTINCT x) FROM unnest(COALESCE(linked_sale_order_ids, ARRAY[]::uuid[]) || COALESCE(v_linked, ARRAY[]::uuid[])) AS x
      ) WHERE id = v_po_id;
    END IF;
    -- Merge-by-produto atômico (idempotente sob concorrência / re-run):
    -- soma na linha existente do produto em vez de inserir uma nova, e já
    -- atualiza total_value da OC na mesma transação.
    PERFORM public.upsert_po_item_atomic(
      v_po_id, v_row.product_id, v_qty_to_order, v_unit_price_po, v_unit_po,
      COALESCE(v_row.on_hand, 0), COALESCE(v_row.min_stock, 0), 0, NULL, NULL
    );
    -- `suggested_quantity` não é setado pelo upsert; preserva a coluna pra a OC
    -- continuar exibindo a sugestão do MRP (acumula no merge, seta no insert).
    UPDATE public.purchase_order_items
       SET suggested_quantity = COALESCE(suggested_quantity, 0) + v_row.suggested_qty
     WHERE purchase_order_id = v_po_id AND product_id = v_row.product_id;
    RETURN NEXT v_po_id;
  END LOOP;
END;
$function$;
