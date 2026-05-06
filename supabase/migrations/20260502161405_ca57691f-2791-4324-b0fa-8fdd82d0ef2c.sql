-- Add columns for product-based mapping in palmilha colors
ALTER TABLE public.technical_sheet_palmilha_colors 
ADD COLUMN IF NOT EXISTS palmilha_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS palmilha_group_id UUID REFERENCES public.product_groups(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_technical_sheet_palmilha_colors_product_id ON public.technical_sheet_palmilha_colors(palmilha_product_id);
