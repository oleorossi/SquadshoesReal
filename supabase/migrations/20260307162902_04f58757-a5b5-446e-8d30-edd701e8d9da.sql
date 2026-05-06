
ALTER TABLE public.orders
  ADD COLUMN packaging_type text NOT NULL DEFAULT '',
  ADD COLUMN packaging_product_id uuid REFERENCES public.products(id) DEFAULT NULL,
  ADD COLUMN packaging_quantity numeric NOT NULL DEFAULT 0;
