-- Marca PVs que tiveram picking confirmado individualmente (botão "Picking
-- Realizado" no drawer do PV) pra serem EXCLUÍDOS do relatório semanal
-- de Picking (PCP Hub → Picking Semanal). Sem isso, o mesmo PV aparece
-- tanto no fluxo individual quanto na lista da onda → operador podia
-- "picking" duas vezes (ou ficar confuso sobre o que ainda falta separar).
--
-- Coluna nullable: NULL = picking via onda (padrão), timestamp = picking
-- realizado individualmente naquela data. Não bloqueia nada — só serve
-- como filtro no relatório.
--
-- A função `commit_picking_for_sale_order` é atualizada pra setar essa
-- coluna ao final (após processar todas as reservas com sucesso).

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS picking_individually_done_at timestamptz;

COMMENT ON COLUMN public.sale_orders.picking_individually_done_at IS
  'Set quando o botão "Picking Realizado" é acionado no drawer do PV. ' ||
  'Usado pelo Picking Semanal (PCP Hub) pra excluir esse PV da lista de ' ||
  'separação por onda, evitando picking em duplicidade.';

-- Recria commit_picking_for_sale_order pra setar a coluna no fim
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

  -- Lock no PV pra evitar race
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

  -- Marca o PV como picking individual realizado SE algo foi efetivamente
  -- debitado. Se nada foi processado (tudo já estava consumed antes), não
  -- toca no timestamp pra não disfarçar o estado pré-existente.
  IF v_picked > 0 THEN
    UPDATE public.sale_orders
       SET picking_individually_done_at = now(),
           updated_at = now()
     WHERE id = p_sale_order_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'picked_count',  v_picked,
    'skipped_count', v_skipped,
    'insufficient',  v_insufficient,
    'picked_items',  v_picked_items,
    'marked_done',   v_picked > 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_picking_for_sale_order(uuid) TO authenticated;

COMMENT ON FUNCTION public.commit_picking_for_sale_order(uuid) IS
  'Debita em massa todas as reservas soft de um PV E marca picking_individually_done_at ' ||
  'pra excluir o PV do Picking Semanal (evita débito em duplicidade).';
