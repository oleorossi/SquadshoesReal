-- 1) quantity >= 0 (existem registros legados com quantity = 0; negativos não são permitidos)
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_quantity_non_negative;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_quantity_non_negative
  CHECK (quantity >= 0);

-- 2) new_stock >= 0
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_new_stock_non_negative;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_new_stock_non_negative
  CHECK (new_stock >= 0);

-- 3) previous_stock >= 0
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_previous_stock_non_negative;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_previous_stock_non_negative
  CHECK (previous_stock >= 0);

-- 4) Trigger em products: impedir quantity < 0 com mensagem clara
DROP FUNCTION IF EXISTS public.prevent_negative_product_stock() CASCADE;
CREATE OR REPLACE FUNCTION public.prevent_negative_product_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.quantity IS NOT NULL AND NEW.quantity < 0 THEN
    RAISE EXCEPTION 'Estoque negativo nao permitido para o produto % (id=%): tentativa de definir quantity = %',
      COALESCE(NEW.name, '?'), NEW.id, NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_negative_product_stock ON public.products;
CREATE TRIGGER trg_prevent_negative_product_stock
  BEFORE INSERT OR UPDATE OF quantity ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_negative_product_stock();