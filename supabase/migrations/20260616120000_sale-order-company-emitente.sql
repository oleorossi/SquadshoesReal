-- 2º CNPJ no fluxo: escolha do emitente na CRIAÇÃO do Pedido de Venda, e
-- propagação automática pra NF-e e etiqueta da caixa externa.
--
-- Já aplicada em produção via Supabase MCP em 2026-06-16 (idempotente).

-- CNPJ emitente escolhido na criação do PV. NF-e e etiqueta da caixa externa
-- passam a usar este CNPJ (em vez de um único emitente fixo). NULL = primária.
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- PVs existentes assumem a empresa primária (mesmo emitente de hoje).
UPDATE public.sale_orders so
   SET company_id = c.id
  FROM public.companies c
 WHERE c.is_primary = true
   AND so.company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sale_orders_company ON public.sale_orders(company_id);

-- Mapeia empresa → loja do GestaoClick/ClickNotas. Sem isso a emit-nfe sempre
-- usa a loja "matriz", então o 2º CNPJ sairia sob a loja errada. NULL = mantém
-- o comportamento atual (matriz/primeira ativa).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS gestaoclick_loja_id text;

COMMENT ON COLUMN public.sale_orders.company_id IS
  'Empresa emitente (CNPJ) escolhida na criação do PV. NF-e e etiqueta da caixa externa usam este CNPJ.';
COMMENT ON COLUMN public.companies.gestaoclick_loja_id IS
  'ID da loja correspondente no GestaoClick/ClickNotas. Garante que a NF-e seja emitida sob o CNPJ desta empresa (sem isso a emit-nfe usa a matriz).';
