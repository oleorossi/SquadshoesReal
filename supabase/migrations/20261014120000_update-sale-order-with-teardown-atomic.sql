-- Atualiza PV e desmonta OPs órfãs/de itens removidos em uma única transação.
--
-- O frontend identifica as OPs que perderão o vínculo antes do replace dos
-- itens. Esta RPC mantém o teardown no banco para que nenhuma falha entre o
-- estorno de estoque, a exclusão da OP e o update do PV deixe dados parciais.

CREATE OR REPLACE FUNCTION public.update_sale_order_with_teardown(
  p_order_id uuid,
  p_header jsonb,
  p_items jsonb,
  p_teardown_op_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op_id uuid;
  v_op_status text;
  v_teardown_op_ids uuid[] := '{}';
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Serializa edições concorrentes deste PV antes de qualquer estorno.
  PERFORM pg_advisory_xact_lock(
    hashtext('update_sale_order_with_teardown:' || p_order_id::text)
  );

  -- Mantém a mesma seleção do frontend: só OPs ainda vinculadas a este PV
  -- podem ser desmontadas. A ordem do array é preservada para os estornos.
  FOREACH v_op_id IN ARRAY COALESCE(p_teardown_op_ids, '{}'::uuid[])
  LOOP
    SELECT status
      INTO v_op_status
      FROM public.orders
     WHERE id = v_op_id
       AND sale_order_id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_teardown_op_ids := array_append(v_teardown_op_ids, v_op_id);

    -- Rascunho/Cancelada nunca tiveram débito de estoque. Não restaurar é
    -- essencial porque restore_sole_grade_for_order não deve creditar esses
    -- buckets sem débito correspondente.
    IF v_op_status NOT IN ('Rascunho', 'Cancelada') THEN
      -- Ordem canônica preservada: reservas → grade de solado → produtos.
      PERFORM public.release_order_reservations(v_op_id);
      PERFORM public.restore_sole_grade_for_order(v_op_id);
      PERFORM public.restore_product_stocks_for_order(v_op_id);
    END IF;
  END LOOP;

  -- Depois dos estornos, replica as exclusões em lote do frontend.
  IF cardinality(v_teardown_op_ids) > 0 THEN
    DELETE FROM public.order_stages
     WHERE order_id = ANY(v_teardown_op_ids);

    DELETE FROM public.production_consumptions
     WHERE order_id = ANY(v_teardown_op_ids);

    UPDATE public.stock_movements
       SET order_id = NULL
     WHERE order_id = ANY(v_teardown_op_ids);

    DELETE FROM public.orders
     WHERE id = ANY(v_teardown_op_ids);
  END IF;

  -- update_sale_order_atomic faz o merge/upsert de cabeçalho e itens e retorna
  -- inserted_item_ids; chamada dentro desta mesma transação, portanto qualquer
  -- erro reverte integralmente o teardown acima.
  RETURN public.update_sale_order_atomic(p_order_id, p_header, p_items);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[]) IS
  'Desmonta OPs removidas/orfãs e atualiza o PV atomicamente; preserva a ordem reservas → grade de solado → produtos.';
