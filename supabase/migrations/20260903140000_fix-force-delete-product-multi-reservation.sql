-- Corrige force_delete_product: o UPDATE de reservas usava
-- `RETURNING (SELECT tot FROM totals) INTO v_reservations_released_qty`, que
-- retorna UMA linha por reserva cancelada → "query returned more than one row"
-- ao forçar exclusão de produto com ≥2 reservas ativas. Agora o total liberado
-- é somado num SELECT próprio (1 linha) e o UPDATE não usa RETURNING INTO.
CREATE OR REPLACE FUNCTION public.force_delete_product(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Total a liberar (reporting) — somado ANTES de cancelar, em 1 linha.
  SELECT COALESCE(SUM(GREATEST(0, quantity_reserved - quantity_consumed)), 0)
    INTO v_reservations_released_qty
    FROM public.material_reservations
   WHERE product_id = p_product_id
     AND status IN ('reserved', 'partially_consumed');

  -- Cancela as reservas ativas (dispara o sync de reserved_stock). Sem
  -- RETURNING INTO — o UPDATE pode afetar N linhas sem erro.
  UPDATE public.material_reservations
     SET status = 'cancelled', updated_at = now()
   WHERE product_id = p_product_id
     AND status IN ('reserved', 'partially_consumed');

  WITH d AS (DELETE FROM public.sheet_materials WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_sheet_materials_count FROM d;

  WITH d AS (DELETE FROM public.material_reservations WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_reservations_count FROM d;

  WITH d AS (DELETE FROM public.purchase_order_items WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_purchase_items_count FROM d;

  WITH d AS (DELETE FROM public.stock_movements WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_stock_movements_count FROM d;

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
$function$;
