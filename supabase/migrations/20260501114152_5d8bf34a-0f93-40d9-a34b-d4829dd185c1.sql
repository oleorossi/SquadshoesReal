
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS mesa_daily_capacity integer NOT NULL DEFAULT 0;

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_ready_made boolean NOT NULL DEFAULT false;

ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS insole_included boolean NOT NULL DEFAULT false;
