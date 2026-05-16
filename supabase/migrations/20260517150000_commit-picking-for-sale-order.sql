-- Função pra debitar TODAS as reservas soft de um PV de uma vez só.
-- Use case: cliente quer fazer "pedido a pedido" (não onda semanal) e marca
-- o PV como "picking realizado" pra confirmar saída de material em massa.
--
-- Mecanismo:
--  1. Lock no sale_order pra serializar contra outras operações
--  2. Itera material_reservations(status='reserved') das OPs do PV
--  3. Pra cada reserva: lock product, valida estoque, subtrai quantity,
--     insere stock_movement('out'), marca reservation como 'consumed'
--  4. Trigger tg_sync_reserved_stock_on_update decrementa reserved_stock
--     automaticamente.
--
-- Soles já são debitados na criação da OP via debit_sole_stock_by_grade
-- (que marca a reservation do solado como 'consumed' direto), então não
-- aparecem aqui. Itens com estoque insuficiente são SKIPADOS (não bloqueia
-- o resto), retornados em `insufficient` pra UI listar.
--
-- Não destrutivo: estorno via release_order_reservations ou cancel_order
-- continua funcionando (estorna stock_movements pelos mov registrados).

DROP FUNCTION IF EXISTS public.commit_picking_for_sale_order(p_sale_order_id uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.commit_picking_for_sale_order(
  p_sale_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res RECORD;
  v_cur_qty numeric;
  v_picked integer := 0;
  v_skipped integer := 0;
  v_insufficient text[] := '{}';
  v_picked_items jsonb := '[]'::jsonb;
  v_so_exists boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Lock no PV pra evitar race com cancel/duplicar/etc rodando em paralelo
  SELECT true INTO v_so_exists
    FROM public.sale_orders
   WHERE id = p_sale_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de Venda não encontrado: %', p_sale_order_id;
  END IF;

  FOR v_res IN
    SELECT mr.id,
           mr.order_id,
           mr.product_id,
           mr.quantity_reserved,
           p.name AS product_name,
           o.order_number AS op_number
      FROM public.material_reservations mr
      JOIN public.orders   o ON o.id = mr.order_id
      JOIN public.products p ON p.id = mr.product_id
     WHERE o.sale_order_id = p_sale_order_id
       AND mr.status = 'reserved'
     ORDER BY mr.product_id, mr.id
       FOR UPDATE OF mr
  LOOP
    -- Lock no produto antes de validar/atualizar quantity
    SELECT quantity INTO v_cur_qty
      FROM public.products
     WHERE id = v_res.product_id
       FOR UPDATE;

    IF v_cur_qty < v_res.quantity_reserved THEN
      v_insufficient := v_insufficient ||
        format('%s: disponível %s · necessário %s',
               v_res.product_name,
               v_cur_qty::text,
               v_res.quantity_reserved::text);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE public.products
       SET quantity   = quantity - v_res.quantity_reserved,
           updated_at = now()
     WHERE id = v_res.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock,
      description, order_id, user_id
    ) VALUES (
      v_res.product_id,
      'out',
      v_res.quantity_reserved,
      v_cur_qty,
      v_cur_qty - v_res.quantity_reserved,
      'Picking realizado em massa (PV) — ' || COALESCE(v_res.op_number, ''),
      v_res.order_id,
      auth.uid()
    );

    UPDATE public.material_reservations
       SET status            = 'consumed',
           quantity_consumed = quantity_reserved,
           consumed_at       = now(),
           reservation_type  = 'hard',
           updated_at        = now()
     WHERE id = v_res.id;

    v_picked := v_picked + 1;
    v_picked_items := v_picked_items || jsonb_build_object(
      'product_id', v_res.product_id,
      'product_name', v_res.product_name,
      'quantity', v_res.quantity_reserved,
      'op', v_res.op_number
    );
  END LOOP;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'picked_count',  v_picked,
    'skipped_count', v_skipped,
    'insufficient',  v_insufficient,
    'picked_items',  v_picked_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_picking_for_sale_order(uuid) TO authenticated;

COMMENT ON FUNCTION public.commit_picking_for_sale_order(uuid) IS
  'Debita em massa todas as reservas soft (status=reserved) das OPs de um PV. '
  'Use quando o operador quer rodar picking pedido-a-pedido sem esperar onda. '
  'Idempotente: reservas já consumidas são puladas (não constam no loop).';
