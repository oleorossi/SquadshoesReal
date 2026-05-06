ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS lot_number text,
  ADD COLUMN IF NOT EXISTS expiration_date date,
  ADD COLUMN IF NOT EXISTS is_chemical boolean NOT NULL DEFAULT false;