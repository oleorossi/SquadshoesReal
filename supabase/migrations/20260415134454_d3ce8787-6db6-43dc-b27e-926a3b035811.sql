-- Add billing_week column to sale_orders for production priority
ALTER TABLE public.sale_orders ADD COLUMN IF NOT EXISTS billing_week text;

-- Comment explaining the column
COMMENT ON COLUMN public.sale_orders.billing_week IS 'Semana de faturamento (ex: 2026-W16). Define a prioridade de entrada nos setores produtivos.';

-- Add priority_order to orders for sector sequencing  
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_ahead_of_schedule boolean DEFAULT false;

COMMENT ON COLUMN public.orders.is_ahead_of_schedule IS 'Indica se o pedido foi puxado antecipadamente pelo setor (adiantado).';

-- Create index for performance on billing_week ordering
CREATE INDEX IF NOT EXISTS idx_sale_orders_billing_week ON public.sale_orders(billing_week);
CREATE INDEX IF NOT EXISTS idx_orders_planned_delivery ON public.orders(planned_delivery);