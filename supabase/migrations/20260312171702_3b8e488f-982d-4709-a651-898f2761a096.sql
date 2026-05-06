ALTER TABLE public.technical_sheets
  ADD COLUMN upper_consumption numeric DEFAULT 0,
  ADD COLUMN lining_consumption numeric DEFAULT 0,
  ADD COLUMN insole_consumption numeric DEFAULT 0,
  ADD COLUMN sole_consumption numeric DEFAULT 0;