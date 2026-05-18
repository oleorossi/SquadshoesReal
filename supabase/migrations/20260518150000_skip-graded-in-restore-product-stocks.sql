-- Fix: restore_product_stocks_for_order falha em produtos COM stock_grade
-- (solados, palmilhas prontas) e arrisca double-credit.
--
-- Cenário do bug (OP 93596380, solado "01" CARAMELO 07d82225-...):
--   1) Frontend cancela OP, chama restore_sole_grade_for_order(p_order_id):
--      restaura stock_grade + quantity COERENTES (ambos +N usando orders.grade)
--   2) Frontend chama restore_product_stocks_for_order(p_order_id):
--      itera stock_movements e faz UPDATE products SET quantity = quantity+N
--      SEM tocar em stock_grade.
--   3) Trigger check_grade_quantity_coherence vê NEW.quantity > SUM(NEW.stock_grade)
--      e RAISE EXCEPTION 'Inconsistência: SUM(stock_grade) = % difere de quantity = %'.
--   4) Cancel falha pro user.
--
-- Causa raiz: restore_product_stocks_for_order foi escrita pra matéria-prima
-- (não tem grade), mas hoje os stock_movements incluem TAMBÉM produtos com
-- grade (solados/palmilhas prontas) — porque debit_sole_stock_by_grade
-- registra movimento. Restaurar quantity sem stock_grade quebra a invariante.
--
-- Fix: SKIP de produtos com stock_grade não-vazio (excluindo metadata _size_*).
-- Esses já têm dedicated restore (restore_sole_grade_for_order), chamado ANTES.
--
-- Bonus: previne double-credit silencioso que aconteceria se o trigger
-- coherence não estivesse barrando (restore_sole_grade credita N, e
-- restore_product_stocks creditaria MAIS N só em quantity, dobrando).
--
-- Matéria-prima/componentes/embalagem continuam restaurados normal.
--
-- box_types (fallback) também continua intocado — não tem stock_grade.

DROP FUNCTION IF EXISTS public.restore_product_stocks_for_order(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_current_qty numeric;
  v_stock_grade jsonb;
  v_grade_nonempty boolean;
  v_net_credit numeric;
  v_updated boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOR v_rec IN
    SELECT
      product_id,
      COALESCE(SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN movement_type = 'in'  THEN quantity ELSE 0 END), 0) AS net_debit
    FROM public.stock_movements
    WHERE order_id = p_order_id
    GROUP BY product_id
  LOOP
    v_net_credit := v_rec.net_debit;
    IF v_net_credit <= 0 THEN CONTINUE; END IF;
    v_updated := false;

    -- Path 1: products (matéria-prima, finished goods, palmilha, tira, etc)
    SELECT quantity, stock_grade INTO v_current_qty, v_stock_grade
      FROM public.products WHERE id = v_rec.product_id FOR UPDATE;
    IF FOUND THEN
      -- Detecta se produto é graded (tem stock_grade não-vazio, excluindo
      -- metadata _size_*). Graded → SKIP (handled by restore_sole_grade_for_order).
      v_grade_nonempty := false;
      IF v_stock_grade IS NOT NULL AND jsonb_typeof(v_stock_grade) = 'object' THEN
        SELECT EXISTS (
          SELECT 1 FROM jsonb_each_text(v_stock_grade)
           WHERE left(key, 1) <> '_'
        ) INTO v_grade_nonempty;
      END IF;

      IF v_grade_nonempty THEN
        -- Skip: produto graded, já restaurado por restore_sole_grade_for_order.
        -- Marcar v_updated=true pra não cair no path 2 (box_types).
        v_updated := true;
      ELSE
        UPDATE public.products
           SET quantity = v_current_qty + v_net_credit, updated_at = now()
         WHERE id = v_rec.product_id;
        v_updated := true;
      END IF;
    END IF;

    -- Path 2: box_types (embalagem) — somente se não achou em products
    IF NOT v_updated THEN
      SELECT quantity INTO v_current_qty
        FROM public.box_types WHERE id = v_rec.product_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.box_types
           SET quantity = v_current_qty + v_net_credit, updated_at = now()
         WHERE id = v_rec.product_id;
        v_updated := true;
      END IF;
    END IF;

    -- Se nenhum match: linha órfã (produto/box deletado depois do débito).
    -- Não-fatal — segue restaurando os outros itens.
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_product_stocks_for_order(uuid) TO authenticated;

COMMENT ON FUNCTION public.restore_product_stocks_for_order(uuid) IS
  'Restaura estoque de produtos E box_types ao cancelar OP. SKIPA produtos graded (stock_grade não-vazio) — esses são restaurados via restore_sole_grade_for_order (chamado antes pelo frontend). Aggregates net debit por product_id em stock_movements. Idempotente para não-graded.';
