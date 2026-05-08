-- =============================================================================
-- AUDIT ROUND 9 — Dívidas técnicas: precisão histórica em DRE
-- =============================================================================
-- 🟡 Dívida #1 — DRE inventory variation usa unit_price ATUAL em movimentos
--    antigos. Em useFinanceIntelligence.useDREInventoryVariation, cada
--    stock_movement era valorizado por products.unit_price atual — quando
--    fornecedor reajusta preço, todos os meses anteriores ficam recalculados.
--
--    Fix: nova coluna stock_movements.unit_price_at_movement, populada por
--    trigger BEFORE INSERT lendo products.unit_price no momento do movimento.
--    Frontend usa essa coluna pra valorização histórica fiel; fallback pra
--    productPriceMap atual se a coluna estiver NULL (movimentos antigos).
--
-- 🟡 Dívida #2 — DRE compras filtra POs por updated_at em vez de data de
--    recebimento real. Editar uma PO recebida (anotação, ajuste) joga ela
--    pra o mês da edição, distorcendo a comparação mensal.
--
--    Fix: nova coluna purchase_orders.received_at, populada por trigger
--    BEFORE UPDATE quando status muda pra 'received'. Backfill de POs
--    historicamente recebidas usa updated_at como aproximação.
-- =============================================================================

-- ─── Dívida #1: stock_movements.unit_price_at_movement ──────────────────────

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS unit_price_at_movement numeric;

COMMENT ON COLUMN public.stock_movements.unit_price_at_movement IS
  'Preço unitário do produto no momento do movimento. Populado automaticamente '
  'por trigger. Usado em DRE histórico — não recalcula com mudanças de preço.';

CREATE OR REPLACE FUNCTION public.tg_stock_movements_set_unit_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.unit_price_at_movement IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT unit_price INTO NEW.unit_price_at_movement
      FROM public.products
     WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_movements_set_unit_price ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_set_unit_price
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_stock_movements_set_unit_price();

-- Backfill: 278 movimentos pré-existentes ficam com o preço atual do produto.
-- Não é fiel histórico, mas evita NULL na coluna pra queries futuras. Marca
-- entries antigas com NULL no description só se quiser distinguir (não fazendo).
UPDATE public.stock_movements sm
   SET unit_price_at_movement = p.unit_price
  FROM public.products p
 WHERE sm.product_id = p.id
   AND sm.unit_price_at_movement IS NULL;


-- ─── Dívida #2: purchase_orders.received_at ─────────────────────────────────

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

COMMENT ON COLUMN public.purchase_orders.received_at IS
  'Timestamp do recebimento (status mudou pra received). Populado por trigger. '
  'Imutável após primeiro set. Usado em DRE compras — edições posteriores '
  'não movem a PO de mês.';

CREATE OR REPLACE FUNCTION public.tg_purchase_orders_set_received_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Só setar quando vira 'received' E ainda não estava setado.
  -- Não desfazer se voltar de 'received' pra outro status (preserva histórico).
  IF NEW.status = 'received'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'received')
     AND NEW.received_at IS NULL THEN
    NEW.received_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_orders_set_received_at ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_set_received_at
  BEFORE INSERT OR UPDATE OF status ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_purchase_orders_set_received_at();

-- Backfill: POs historicamente recebidas — usar updated_at como aproximação.
-- Frontend já usava updated_at antes, então a precisão pra histórico é a mesma.
UPDATE public.purchase_orders
   SET received_at = updated_at
 WHERE status = 'received'
   AND received_at IS NULL;
