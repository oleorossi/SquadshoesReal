ALTER TABLE public.product_references 
ADD COLUMN has_straps boolean NOT NULL DEFAULT false,
ADD COLUMN strap_colors jsonb DEFAULT '[]'::jsonb;