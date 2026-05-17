-- =============================================================================
-- force_delete_product: exclui um produto E todos os vínculos numa transação.
--
-- Caminho normal: useDeleteProduct verifica vínculos e BLOQUEIA exclusão
-- (sugere desativar). Esta função é o "escape hatch" pra operador desfazer
-- cadastros errados — apaga BOMs/reservas/itens de OC/movimentações junto.
--
-- Retorna JSON com contagens do que foi apagado, pra UI mostrar resumo.
--
-- Segurança:
--   • SECURITY DEFINER + is_approved_user() (mesmo padrão dos outros hot ops)
--   • Cancela reservas ATIVAS antes de apagar (devolve quantity reserved)
--   • Apaga em ordem segura: dependências primeiro, produto por último
-- =============================================================================

DROP FUNCTION IF EXISTS public.force_delete_product(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.force_delete_product(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product_name text;
  v_sheet_materials_count    integer := 0;
  v_reservations_count       integer := 0;
  v_purchase_items_count     integer := 0;
  v_stock_movements_count    integer := 0;
  v_reservations_released_qty numeric := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT name INTO v_product_name FROM public.products WHERE id = p_product_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Produto % não encontrado', p_product_id;
  END IF;

  -- Cancela reservas ativas antes de apagar (libera reserved_stock no products)
  WITH released AS (
    SELECT id, GREATEST(0, quantity_reserved - quantity_consumed) AS to_release
      FROM public.material_reservations
     WHERE product_id = p_product_id
       AND status IN ('reserved', 'partially_consumed')
       FOR UPDATE
  ),
  totals AS (
    SELECT COALESCE(SUM(to_release), 0) AS tot FROM released
  )
  UPDATE public.material_reservations
     SET status = 'cancelled', updated_at = now()
   WHERE id IN (SELECT id FROM released)
  RETURNING (SELECT tot FROM totals) INTO v_reservations_released_qty;

  -- Apaga BOM lines apontando pro produto (sheet_materials)
  WITH d AS (DELETE FROM public.sheet_materials WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_sheet_materials_count FROM d;

  -- Apaga reservas (já canceladas + históricas)
  WITH d AS (DELETE FROM public.material_reservations WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_reservations_count FROM d;

  -- Apaga itens de OC apontando pro produto
  WITH d AS (DELETE FROM public.purchase_order_items WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_purchase_items_count FROM d;

  -- Apaga movimentações de estoque
  WITH d AS (DELETE FROM public.stock_movements WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_stock_movements_count FROM d;

  -- Finalmente, apaga o produto
  DELETE FROM public.products WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'product_id',            p_product_id,
    'product_name',          v_product_name,
    'sheet_materials_count', v_sheet_materials_count,
    'reservations_count',    v_reservations_count,
    'reservations_released_qty', v_reservations_released_qty,
    'purchase_items_count',  v_purchase_items_count,
    'stock_movements_count', v_stock_movements_count,
    'deleted_at',            now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.force_delete_product(uuid) TO authenticated;

COMMENT ON FUNCTION public.force_delete_product(uuid) IS
  'Excluir produto + todos os vínculos (sheet_materials, material_reservations, purchase_order_items, stock_movements) atomicamente. Usar com cuidado — perde histórico. Retorna contagens do que foi apagado.';
