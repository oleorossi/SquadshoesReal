-- Add registered_by to quality_records
ALTER TABLE public.quality_records 
ADD COLUMN IF NOT EXISTS registered_by TEXT;
