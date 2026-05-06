ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS assembly_time_minutes numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS process_difficulty text DEFAULT 'medio',
  ADD COLUMN IF NOT EXISTS daily_capacity_pairs integer DEFAULT 0;