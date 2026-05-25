-- Idempotência pra app mobile (vendedor offline). Cliente gera UUID antes
-- do submit; se enviar 2x (rede instável, retry no sync queue, double-tap),
-- server detecta via UNIQUE constraint e retorna o PV existente em vez de
-- duplicar.
--
-- Padrão de mercado: Stripe usa Idempotency-Key header, Shopify usa
-- order.token, etc. Aqui colocamos no body via coluna dedicada.
--
-- NULL permitido: PVs criados pela UI desktop não precisam (têm controle
-- de duplo-click via UI state). Só uso obrigatório no fluxo mobile.

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sale_orders_client_request_id_uidx
  ON public.sale_orders (client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN public.sale_orders.client_request_id IS
  'UUID gerado pelo cliente antes do submit. Usado pra deduplicação no fluxo mobile/offline — mesmo client_request_id enviado 2x retorna o PV existente sem criar duplicata. NULL pra PVs criados via UI desktop tradicional.';

-- Flag de vendedor (impactará auto-redirect no login pra /m)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_sales_rep boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_sales_rep IS
  'Quando true, usuário é redirecionado pra /m (interface mobile de vendas) ao logar em vez do dashboard desktop.';
