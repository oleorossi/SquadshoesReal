-- Criar ou atualizar função para garantir atomicidade em itens de pedido de compra
DROP FUNCTION IF EXISTS public.upsert_purchase_order_items(
  p_order_id UUID,
  p_items JSONB
) CASCADE;
CREATE OR REPLACE FUNCTION public.upsert_purchase_order_items(
  p_order_id UUID,
  p_items JSONB
) RETURNS VOID AS $$
BEGIN
  -- Remove itens antigos
  DELETE FROM public.purchase_order_items
  WHERE purchase_order_id = p_order_id;

  -- Insere novos itens
  INSERT INTO public.purchase_order_items (
    purchase_order_id,
    product_id,
    quantity,
    unit_price,
    total_price,
    notes
  )
  SELECT 
    p_order_id,
    (item->>'product_id')::UUID,
    (item->>'quantity')::NUMERIC,
    (item->>'unit_price')::NUMERIC,
    (item->>'total_price')::NUMERIC,
    item->>'notes'
  FROM jsonb_array_elements(p_items) AS item;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
