-- Add is_standard_sole_item column to products table
ALTER TABLE public.products 
ADD COLUMN is_standard_sole_item BOOLEAN NOT NULL DEFAULT false;

-- Add an index for performance
CREATE INDEX idx_products_standard_sole_item ON public.products (is_standard_sole_item) WHERE is_standard_sole_item = true;

-- Update RLS policies (handled by existing broad policies, but adding a specific comment for clarity)
-- Existing policies like "Approved users can update products" will already cover this.
