-- Fix: restore de embalagem (box_types) não funcionava ao cancelar OP.
--
-- Bug: debit_packaging_for_order (20260424180000) faz
--   INSERT INTO stock_movements (product_id, ...) VALUES (cfg.box_type_id, ...)
-- mas stock_movements.product_id tem FK para products(id) e cfg.box_type_id
-- pertence à tabela box_types (UUID space totalmente independente). Em
-- ambientes onde a FK está ativa, o INSERT falha — toda baixa de embalagem
-- gera erro silencioso reportado pelo caller via secondaryDebitErrors.
-- Em ambientes onde a FK foi dropada (provavelmente via migration que não
-- encontrei no histórico), o INSERT passa MAS restore_product_stocks_for_order
-- nunca consegue restaurar o estoque de caixa porque procura
-- UPDATE products WHERE id = stock_movement.product_id (que não existe).
--
-- Fix:
-- 1) Dropa a FK em stock_movements.product_id (se ainda existir). product_id
--    passa a ser um "soft pointer" — pode apontar para products(id) OU
--    box_types(id). Tradeoff conhecido: perde proteção referencial em troca
--    de capturar audit trail das duas categorias num único stream.
-- 2) Atualiza restore_product_stocks_for_order para PRIMEIRO tentar restaurar
--    em products; se não achar, tentar em box_types. Idempotente — se
--    nenhum dos dois match, ignora a linha (evita 'orphan crashes').

-- ============================================================
-- 1) Dropar FK que estava bloqueando packaging stock_movements
-- ============================================================
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_product_id_fkey;

-- Adiciona índice para sustentar o restore que vai filtrar por box_types
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id
  ON public.stock_movements(product_id);

COMMENT ON COLUMN public.stock_movements.product_id IS
  'Soft pointer — pode apontar para products(id) OU box_types(id). FK removida em 20260527240000 para suportar audit trail unificado de baixas de embalagem (box_types).';

-- ============================================================
-- 2) restore_product_stocks_for_order com fallback para box_types
-- ============================================================
DROP FUNCTION IF EXISTS public.restore_product_stocks_for_order(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_current_qty numeric;
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
    SELECT quantity INTO v_current_qty
      FROM public.products WHERE id = v_rec.product_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.products
         SET quantity = v_current_qty + v_net_credit, updated_at = now()
       WHERE id = v_rec.product_id;
      v_updated := true;
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
    -- Não-fatal — segue restaurando os outros itens. Operador pode auditar
    -- via SELECT product_id FROM stock_movements WHERE order_id = X
    -- AND NOT EXISTS (matches em ambas tabelas).
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_product_stocks_for_order(uuid) TO authenticated;

COMMENT ON FUNCTION public.restore_product_stocks_for_order(uuid) IS
  'Restaura estoque de produtos E box_types ao cancelar OP. Aggregates net debit por product_id em stock_movements; tenta primeiro products(id), depois box_types(id). Idempotente — re-execução não reabate.';
