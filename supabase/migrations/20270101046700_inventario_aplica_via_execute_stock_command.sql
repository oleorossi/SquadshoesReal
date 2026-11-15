-- Contagem cíclica (Inventário ABC): apply_inventory_count deixa de chamar o adjust_stock
-- legado (fechado pelo contrato de estoque 20270101012500) e passa a aplicar as divergências
-- por public.execute_stock_command('adjust_products'), o caminho canônico de saldo:
--   * valida o papel (admin/gerente/almoxarifado), trava as linhas e confere o snapshot;
--   * grava stock_movements com receipt (stock_command_receipts);
--   * lote atômico: se qualquer item for recusado (ex.: produto com grade por numeração,
--     saldo mudou no meio), nada é aplicado e a contagem continua aberta.
-- NÃO aplicada no banco por MCP: entra pelo workflow de migrations depois da revisão do PR.
-- Idempotente (CREATE OR REPLACE + GRANT/REVOKE).
CREATE OR REPLACE FUNCTION public.apply_inventory_count(p_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count public.inventory_counts%ROWTYPE;
  v_div integer := 0;
  v_divval numeric := 0;
  v_counted integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_snapshot jsonb := '[]'::jsonb;
  v_item_ids uuid[] := ARRAY[]::uuid[];
  v_result jsonb;
  v_errors jsonb;
  r record;
BEGIN
  SELECT * INTO v_count FROM public.inventory_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contagem % não encontrada', p_count_id USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE COALESCE(i.divergence, 0) <> 0),
         COALESCE(sum(abs(COALESCE(i.divergence, 0)) * COALESCE(i.unit_price, 0))
                  FILTER (WHERE COALESCE(i.divergence, 0) <> 0), 0)
    INTO v_counted, v_div, v_divval
    FROM public.inventory_count_items i
   WHERE i.count_id = p_count_id AND i.counted_qty IS NOT NULL;

  -- Só itens divergentes ainda não ajustados viram ajuste; o saldo novo é o contado.
  FOR r IN
    SELECT i.id AS item_id, i.product_id, i.counted_qty, p.quantity AS current_qty
      FROM public.inventory_count_items i
      JOIN public.products p ON p.id = i.product_id
     WHERE i.count_id = p_count_id
       AND i.counted_qty IS NOT NULL
       AND COALESCE(i.divergence, 0) <> 0
       AND NOT COALESCE(i.adjusted, false)
     ORDER BY i.product_id
  LOOP
    v_item_ids := v_item_ids || r.item_id;
    IF round(r.counted_qty, 4) IS DISTINCT FROM round(r.current_qty, 4) THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'product_id', r.product_id,
        'expected_previous_qty', r.current_qty,
        'new_qty', r.counted_qty,
        'reason', 'Inventário ' || v_count.count_number
      ));
      v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
        'product_id', r.product_id,
        'quantity', r.current_qty
      ));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_items) > 0 THEN
    v_result := public.execute_stock_command(
      'adjust_products',
      jsonb_build_object('items', v_items),
      gen_random_uuid(),
      jsonb_build_object('products', v_snapshot)
    );
    IF NOT COALESCE((v_result ->> 'success')::boolean, false) THEN
      v_errors := COALESCE(v_result -> 'errors', '[]'::jsonb);
      RAISE EXCEPTION 'Contagem % não aplicada: % item(ns) recusado(s) pelo comando de estoque',
        v_count.count_number, jsonb_array_length(v_errors)
        USING ERRCODE = '22023',
              DETAIL = v_errors::text,
              HINT = 'GRADE_REQUIRED_FOR_GRADED_PRODUCT: ajuste por numeração na tela de estoque; CONCURRENCY_ERROR: o saldo mudou, recarregue e aplique de novo.';
    END IF;
  END IF;

  IF array_length(v_item_ids, 1) > 0 THEN
    UPDATE public.inventory_count_items SET adjusted = true WHERE id = ANY (v_item_ids);
  END IF;

  UPDATE public.inventory_counts
     SET counted_products = v_counted,
         divergences_count = v_div,
         total_divergence_value = v_divval,
         status = 'concluida',
         completed_at = now()
   WHERE id = p_count_id;

  RETURN jsonb_build_object(
    'counted', v_counted,
    'divergences', v_div,
    'divergence_value', v_divval,
    'adjusted', jsonb_array_length(v_items),
    'stock_command_receipt_id', v_result ->> 'receipt_id'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_inventory_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_inventory_count(uuid) TO authenticated, service_role;
