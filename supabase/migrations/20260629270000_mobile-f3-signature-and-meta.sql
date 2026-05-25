-- F3 do app mobile: assinatura digital do cliente + meta de vendas
-- por vendedor (mensal) usada nos dashboards/KPIs.

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS client_signature_data_url text,
  ADD COLUMN IF NOT EXISTS client_signature_at timestamptz;

COMMENT ON COLUMN public.sale_orders.client_signature_data_url IS
  'Base64 PNG da assinatura do cliente capturada via canvas no app mobile. Opcional — nem todos os PVs têm.';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sales_target_monthly_brl numeric,
  ADD COLUMN IF NOT EXISTS sales_target_monthly_pairs integer;

COMMENT ON COLUMN public.profiles.sales_target_monthly_brl IS
  'Meta de venda mensal do vendedor em R$. Usado pra calcular % atingido no dashboard mobile.';
COMMENT ON COLUMN public.profiles.sales_target_monthly_pairs IS
  'Meta de venda mensal do vendedor em pares.';
