-- Add can_rework and cost to quality_records
ALTER TABLE public.quality_records 
ADD COLUMN IF NOT EXISTS can_rework BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS cost NUMERIC(10, 2) DEFAULT 0;
