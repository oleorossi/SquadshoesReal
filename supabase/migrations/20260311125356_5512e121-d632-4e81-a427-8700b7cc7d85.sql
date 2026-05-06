ALTER TABLE public.sale_orders ADD COLUMN IF NOT EXISTS nfe text DEFAULT '';
ALTER TABLE public.sale_orders ADD COLUMN IF NOT EXISTS remessa text DEFAULT '';