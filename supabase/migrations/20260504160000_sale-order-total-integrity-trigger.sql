-- ---------------------------------------------------------------
-- 20260504160000_sale-order-total-integrity-trigger.sql
--
-- Mantém `sale_orders.total` automaticamente sincronizado com
-- a soma de `sale_order_items` (qty × unit_price), e adiciona
-- função RPC para recalcular sob demanda.
--
-- Motivação:
-- A edge function `emit-nfe` foi corrigida em 20260504 para validar
-- `|sumItems - order.total| > 0,01`. Mas na origem, hoje, é
-- possível alterar/remover itens sem que o total seja atualizado.
-- Esse trigger evita o problema na raiz: qualquer INSERT/UPDATE/
-- DELETE em sale_order_items recalcula o total do pedido pai.
--
-- Performance: pedidos têm tipicamente <50 itens; a recalculação
-- por trigger é O(n) e roda em transação. Vale o custo.
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.recalc_sale_order_total(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.recalc_sale_order_total(p_sale_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_sale_order_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(unit_price, 0)), 0)
    INTO v_total
    FROM public.sale_order_items
   WHERE sale_order_id = p_sale_order_id;

  -- Round to centavos to avoid float drift across many items.
  v_total := round(v_total::numeric, 2);

  UPDATE public.sale_orders
     SET total = v_total,
         updated_at = now()
   WHERE id = p_sale_order_id
     AND COALESCE(total, 0) IS DISTINCT FROM v_total;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_sale_order_total(uuid) TO authenticated;

-- Trigger function: dispara recálculo após qualquer mudança em itens.
DROP FUNCTION IF EXISTS public.fn_sync_sale_order_total() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_sync_sale_order_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  -- Em DELETE, OLD; em INSERT/UPDATE, NEW. Em UPDATE de sale_order_id
  -- (movendo um item entre pedidos) recalcula AMBOS os pedidos.
  IF TG_OP = 'DELETE' THEN
    v_target_id := OLD.sale_order_id;
    PERFORM public.recalc_sale_order_total(v_target_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id THEN
    PERFORM public.recalc_sale_order_total(OLD.sale_order_id);
    PERFORM public.recalc_sale_order_total(NEW.sale_order_id);
    RETURN NEW;
  ELSE
    PERFORM public.recalc_sale_order_total(NEW.sale_order_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sale_order_total ON public.sale_order_items;
CREATE TRIGGER trg_sync_sale_order_total
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_sale_order_total();

-- Backfill: alinha todos os pedidos existentes que estão com total
-- divergente da soma dos itens. Roda apenas uma vez na aplicação.
DO $$
DECLARE
  v_fixed integer := 0;
  v_so_id uuid;
BEGIN
  FOR v_so_id IN
    SELECT DISTINCT so.id
      FROM public.sale_orders so
      LEFT JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     GROUP BY so.id, so.total
    HAVING ABS(COALESCE(so.total, 0) - COALESCE(SUM(COALESCE(soi.quantity, 0) * COALESCE(soi.unit_price, 0)), 0)) > 0.01
  LOOP
    PERFORM public.recalc_sale_order_total(v_so_id);
    v_fixed := v_fixed + 1;
  END LOOP;
  RAISE NOTICE 'Backfill: % pedidos tiveram total reajustado.', v_fixed;
END;
$$;
