-- ---------------------------------------------------------------
-- 20260504130000_atomic-packaging-debit-rpc.sql
--
-- Substitui o padrão SELECT → calcula → UPDATE → INSERT do
-- src/hooks/useOrders.ts (linhas 109-134) por uma RPC atômica.
--
-- O fluxo anterior era 3 roundtrips sem lock:
--   1) SELECT products.quantity
--   2) UPDATE products.quantity = old - debit
--   3) INSERT stock_movements
-- Sob concorrência, duas OPs criadas no mesmo segundo podiam ler
-- o mesmo `quantity` e ambas debitar o full amount, deixando o
-- estoque negativo invisível. Esta RPC trava a linha do produto
-- com SELECT FOR UPDATE e faz tudo em transação única.
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.debit_packaging_for_order_atomic(p_order_id uuid, p_packaging_product_id uuid, p_quantity numeric, p_packaging_type text) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order_atomic(
  p_order_id uuid,
  p_packaging_product_id uuid,
  p_quantity numeric,
  p_packaging_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_stock numeric;
  v_new_stock  numeric;
  v_movement_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade de embalagem inválida (%)', p_quantity;
  END IF;
  IF p_packaging_product_id IS NULL THEN
    RAISE EXCEPTION 'packaging_product_id é obrigatório';
  END IF;

  -- Lock the product row to prevent concurrent debits from racing.
  SELECT quantity
    INTO v_prev_stock
    FROM public.products
   WHERE id = p_packaging_product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto de embalagem não encontrado (%)', p_packaging_product_id;
  END IF;

  v_new_stock := v_prev_stock - p_quantity;

  -- Block accidental negative stock — caller can check stock first.
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente: disponível % unidade(s), tentado debitar %',
      v_prev_stock, p_quantity;
  END IF;

  UPDATE public.products
     SET quantity = v_new_stock,
         updated_at = now()
   WHERE id = p_packaging_product_id;

  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
  ) VALUES (
    p_packaging_product_id,
    'out',
    p_quantity,
    v_prev_stock,
    v_new_stock,
    COALESCE('Embalagem OP - ' || p_packaging_type, 'Embalagem OP'),
    p_order_id
  )
  RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'product_id', p_packaging_product_id,
    'movement_id', v_movement_id,
    'previous_stock', v_prev_stock,
    'new_stock', v_new_stock,
    'debited', p_quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order_atomic(uuid, uuid, numeric, text)
  TO authenticated;
