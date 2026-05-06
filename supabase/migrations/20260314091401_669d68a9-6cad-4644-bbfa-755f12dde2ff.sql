
ALTER TABLE public.order_stages 
  ADD COLUMN IF NOT EXISTS standard_time_minutes numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_hour numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_time_minutes numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_pair numeric DEFAULT 0;
