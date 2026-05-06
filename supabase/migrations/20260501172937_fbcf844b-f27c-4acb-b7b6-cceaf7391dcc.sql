-- Função para sincronizar o total do pedido de venda
CREATE OR REPLACE FUNCTION public.sync_sale_order_total()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id uuid;
  v_total numeric;
BEGIN
  -- Determinar o ID do pedido afetado
  IF TG_OP = 'DELETE' THEN
    v_order_id := OLD.sale_order_id;
  ELSE
    v_order_id := NEW.sale_order_id;
  END IF;

  -- Calcular o novo total
  SELECT COALESCE(SUM(quantity * unit_price), 0)
  INTO v_total
  FROM public.sale_order_items
  WHERE sale_order_id = v_order_id;

  -- Atualizar o pedido principal
  UPDATE public.sale_orders
  SET total_value = v_total,
      updated_at = now()
  WHERE id = v_order_id;

  -- Se for UPDATE e o ID do pedido mudou, sincronizar também o pedido antigo
  IF TG_OP = 'UPDATE' AND OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id THEN
    SELECT COALESCE(SUM(quantity * unit_price), 0)
    INTO v_total
    FROM public.sale_order_items
    WHERE sale_order_id = OLD.sale_order_id;

    UPDATE public.sale_orders
    SET total_value = v_total,
        updated_at = now()
    WHERE id = OLD.sale_order_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Gatilho para sincronização automática
DROP TRIGGER IF EXISTS trg_sync_sale_order_total ON public.sale_order_items;
CREATE TRIGGER trg_sync_sale_order_total
AFTER INSERT OR UPDATE OF quantity, unit_price, sale_order_id OR DELETE
ON public.sale_order_items
FOR EACH ROW
EXECUTE FUNCTION public.sync_sale_order_total();

-- Comentário para documentação
COMMENT ON FUNCTION public.sync_sale_order_total() IS 'Sincroniza automaticamente o total_value da tabela sale_orders com a soma de seus itens.';