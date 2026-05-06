ALTER TABLE public.sale_orders 
ADD COLUMN IF NOT EXISTS packaging_product_id uuid REFERENCES public.products(id) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS packaging_quantity integer NOT NULL DEFAULT 0;