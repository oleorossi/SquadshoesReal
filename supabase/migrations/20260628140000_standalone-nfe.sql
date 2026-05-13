-- =============================================================================
-- NF Avulsa: emissão sem PV de produção
-- =============================================================================
-- Caso de uso: emitir NF-e diretamente, escolhendo referência de estoque,
-- cor, grade e quantidade, sem precisar criar um Pedido de Venda completo
-- nem passar por fluxo produtivo.
--
-- Estratégia: reusa estrutura de sale_orders + sale_order_items pra não
-- duplicar a infra de emit-nfe (CFOP, sync GestaoClick, AR, etc.), mas:
--   - sale_orders.is_standalone_nfe = true (flag visual + lógica)
--   - sale_order_items.reference_id agora nullable (NF avulsa não tem ficha)
--   - sale_order_items.product_id nova coluna pra apontar direto pra produto
--   - CHECK (reference_id IS NOT NULL OR product_id IS NOT NULL)
--   - emit-nfe edge function passa a aceitar items com product_id (lê
--     nome/NCM/preço do produto em vez de da ficha)
--
-- O que NÃO acontece em PV avulso (porque não há produção):
--   - try_reserve_materials (frontend não chama)
--   - calculate_order_cost (sem ficha → não há BOM)
--   - tg_sale_order_creates_cmv (já pula por não ter order_costs)
--   - process_dirty_order_costs (idem)
-- =============================================================================

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS is_standalone_nfe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sale_orders.is_standalone_nfe IS
  'PV criado pela aba "NF Avulsa": gera NF sem produção, sem reservas, sem CMV. '
  'Itens vinculados via sale_order_items.product_id direto, sem ficha técnica.';

CREATE INDEX IF NOT EXISTS idx_sale_orders_standalone_nfe
  ON public.sale_orders (is_standalone_nfe)
  WHERE is_standalone_nfe = true;


-- ─── sale_order_items: product_id direto + reference_id nullable ───────────
ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT;

ALTER TABLE public.sale_order_items
  ALTER COLUMN reference_id DROP NOT NULL;

-- CHECK: ou reference_id (ficha técnica) ou product_id (avulso) deve existir.
ALTER TABLE public.sale_order_items
  DROP CONSTRAINT IF EXISTS sale_order_items_reference_or_product;
ALTER TABLE public.sale_order_items
  ADD CONSTRAINT sale_order_items_reference_or_product
  CHECK (reference_id IS NOT NULL OR product_id IS NOT NULL);

COMMENT ON COLUMN public.sale_order_items.product_id IS
  'Quando NF Avulsa: aponta direto pro produto em estoque (sem ficha técnica). '
  'Pelo menos um entre reference_id e product_id deve estar preenchido.';

CREATE INDEX IF NOT EXISTS idx_sale_order_items_product_id
  ON public.sale_order_items (product_id)
  WHERE product_id IS NOT NULL;


-- ─── products.gestaoclick_id: cache do ID externo ──────────────────────────
-- emit-nfe cria produto no GestaoClick em runtime se não existir. Cachear
-- evita recriar a cada NF avulsa que reusa o mesmo produto.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS gestaoclick_id text;

COMMENT ON COLUMN public.products.gestaoclick_id IS
  'ID do produto no GestaoClick (cache após primeira emissão de NF avulsa).';
