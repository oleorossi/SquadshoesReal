-- =============================================================================
-- purchase_order_items: coalesce dos snapshots de estoque (null → 0) (2026-06-20)
-- =============================================================================
-- Bug: salvar uma variante (MasterVariantDialog → "Editar completo") dava
--   "Erro ao salvar: null value in column max_stock of relation
--    purchase_order_items violates not-null constraint".
-- Causa: o trigger auto_create_purchase_order (em products) dispara quando a qtd
--   cai <= estoque mínimo e INSERE um item de OC automática copiando
--   max_stock = NEW.max_stock. O input "Estoque máximo" foi REMOVIDO do cadastro
--   (mai/2026), então products.max_stock pode ser NULL. As colunas
--   current_stock/min_stock/max_stock/suggested_quantity de purchase_order_items
--   são NOT NULL DEFAULT 0, mas um NULL EXPLÍCITO no INSERT ignora o default →
--   viola a constraint → a UPDATE do produto inteira falha (rollback) → impossível
--   salvar a variante. (Vale tb p/ generate_rop_purchase_suggestions e o create de
--   OC no front, que também copiam max_stock do produto.)
--
-- Fix GLOBAL (pega TODO caminho de insert/update): trigger BEFORE em
--   purchase_order_items que coalesce os snapshots numéricos pra 0 quando vierem
--   NULL. Mais robusto que corrigir cada call-site (auto-PO, ROP, front, upserts).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_poi_coalesce_stock_snapshots()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.current_stock      := COALESCE(NEW.current_stock, 0);
  NEW.min_stock          := COALESCE(NEW.min_stock, 0);
  NEW.max_stock          := COALESCE(NEW.max_stock, 0);
  NEW.suggested_quantity := COALESCE(NEW.suggested_quantity, 0);
  NEW.quantity           := COALESCE(NEW.quantity, 0);
  NEW.unit_price         := COALESCE(NEW.unit_price, 0);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_poi_coalesce_stock_snapshots ON public.purchase_order_items;
CREATE TRIGGER trg_poi_coalesce_stock_snapshots
  BEFORE INSERT OR UPDATE ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_poi_coalesce_stock_snapshots();

COMMENT ON FUNCTION public.tg_poi_coalesce_stock_snapshots() IS
  'Coalesce dos snapshots de estoque (current/min/max_stock, suggested_quantity, '
  'quantity, unit_price) pra 0 quando NULL — products.max_stock pode ser NULL '
  '(input removido do cadastro) e o auto_create_purchase_order/ROP/front copiam '
  'esse valor num INSERT, que viola NOT NULL ao passar NULL explícito.';
