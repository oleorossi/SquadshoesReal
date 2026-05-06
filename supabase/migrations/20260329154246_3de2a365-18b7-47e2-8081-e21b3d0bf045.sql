
-- Add stock management fields to products
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS reserved_stock numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS safety_stock numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_days integer DEFAULT 7;

-- Add size multipliers (JSONB) to technical_sheets for grade-based consumption
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS size_multipliers jsonb DEFAULT '{"33":0.94,"34":0.96,"35":0.98,"36":1.00,"37":1.02,"38":1.04,"39":1.06,"40":1.08}'::jsonb;
