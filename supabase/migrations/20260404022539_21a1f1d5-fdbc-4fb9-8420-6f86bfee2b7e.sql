
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;
ALTER TABLE public.economic_groups ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;
ALTER TABLE public.sale_orders ADD COLUMN IF NOT EXISTS delivery_week text;
ALTER TABLE public.sale_orders ADD COLUMN IF NOT EXISTS delivery_month text;
