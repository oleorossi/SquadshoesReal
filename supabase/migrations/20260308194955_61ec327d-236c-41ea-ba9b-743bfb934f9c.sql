
-- Add barcode column to product_references
ALTER TABLE public.product_references ADD COLUMN IF NOT EXISTS barcode text DEFAULT '';

-- Create a function to auto-generate EAN-13 style barcodes for references
DROP FUNCTION IF EXISTS public.generate_reference_barcode() CASCADE;
CREATE OR REPLACE FUNCTION public.generate_reference_barcode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_seq bigint;
  v_barcode text;
BEGIN
  IF NEW.barcode IS NULL OR NEW.barcode = '' THEN
    -- Use a sequence-based approach: 789 (Brazil prefix) + 0000 (company) + 00000 (product) + check
    v_seq := nextval('reference_barcode_seq');
    v_barcode := '789' || lpad(v_seq::text, 9, '0');
    -- Calculate EAN-13 check digit
    DECLARE
      i integer;
      total integer := 0;
      digit integer;
    BEGIN
      FOR i IN 1..12 LOOP
        digit := substring(v_barcode from i for 1)::integer;
        IF i % 2 = 1 THEN
          total := total + digit;
        ELSE
          total := total + digit * 3;
        END IF;
      END LOOP;
      NEW.barcode := v_barcode || ((10 - (total % 10)) % 10)::text;
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Create sequence for barcode generation
CREATE SEQUENCE IF NOT EXISTS public.reference_barcode_seq START WITH 1;

-- Create trigger
DROP TRIGGER IF EXISTS trg_generate_barcode ON public.product_references;
CREATE TRIGGER trg_generate_barcode
  BEFORE INSERT ON public.product_references
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_reference_barcode();
