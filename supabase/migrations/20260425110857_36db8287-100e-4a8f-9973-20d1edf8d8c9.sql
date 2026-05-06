ALTER TABLE public.product_technical_sheets 
ADD COLUMN IF NOT EXISTS reference_product_id UUID REFERENCES public.products(id),
ADD COLUMN IF NOT EXISTS reference_date TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.sole_technical_specs
ADD COLUMN IF NOT EXISTS reference_sole_id UUID REFERENCES public.products(id),
ADD COLUMN IF NOT EXISTS reference_date TIMESTAMP WITH TIME ZONE;