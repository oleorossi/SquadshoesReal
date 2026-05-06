ALTER TABLE public.economic_groups
  ADD COLUMN IF NOT EXISTS silk_url TEXT,
  ADD COLUMN IF NOT EXISTS billing_email TEXT,
  ADD COLUMN IF NOT EXISTS finance_contact_name TEXT;