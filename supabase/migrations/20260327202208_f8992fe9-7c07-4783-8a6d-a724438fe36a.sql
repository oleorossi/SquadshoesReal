
ALTER TABLE public.service_orders 
  ADD COLUMN IF NOT EXISTS material_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS material_meters numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS material_color text DEFAULT '',
  ADD COLUMN IF NOT EXISTS receipt_number text DEFAULT '',
  ADD COLUMN IF NOT EXISTS receipt_generated_at timestamptz;

-- Auto-generate receipt number
CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF (NEW.status = 'Concluído' AND (OLD.status IS NULL OR OLD.status <> 'Concluído')) THEN
    IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
      NEW.receipt_number := 'REC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('so_number_seq')::text, 5, '0');
      NEW.receipt_generated_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_receipt ON public.service_orders;
CREATE TRIGGER trg_generate_receipt
  BEFORE INSERT OR UPDATE ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_receipt_number();
