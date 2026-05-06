
CREATE TABLE public.reference_color_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  color text NOT NULL DEFAULT '',
  sku text NOT NULL DEFAULT '',
  barcode text NOT NULL DEFAULT '',
  image_url text DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reference_id, color)
);

ALTER TABLE public.reference_color_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view reference_color_variants" ON public.reference_color_variants;
CREATE POLICY "Auth users can view reference_color_variants" ON public.reference_color_variants FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert reference_color_variants" ON public.reference_color_variants;
CREATE POLICY "Auth users can insert reference_color_variants" ON public.reference_color_variants FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update reference_color_variants" ON public.reference_color_variants;
CREATE POLICY "Auth users can update reference_color_variants" ON public.reference_color_variants FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete reference_color_variants" ON public.reference_color_variants;
CREATE POLICY "Auth users can delete reference_color_variants" ON public.reference_color_variants FOR DELETE TO authenticated USING (true);

-- Sequence for variant barcodes
CREATE SEQUENCE IF NOT EXISTS variant_barcode_seq START 100000;

-- Auto-generate barcode for color variants
DROP FUNCTION IF EXISTS public.generate_variant_barcode() CASCADE;
CREATE OR REPLACE FUNCTION public.generate_variant_barcode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_seq bigint;
  v_barcode text;
  i integer;
  total integer := 0;
  digit integer;
BEGIN
  IF NEW.barcode IS NULL OR NEW.barcode = '' THEN
    v_seq := nextval('variant_barcode_seq');
    v_barcode := '789' || lpad(v_seq::text, 9, '0');
    FOR i IN 1..12 LOOP
      digit := substring(v_barcode from i for 1)::integer;
      IF i % 2 = 1 THEN
        total := total + digit;
      ELSE
        total := total + digit * 3;
      END IF;
    END LOOP;
    NEW.barcode := v_barcode || ((10 - (total % 10)) % 10)::text;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trigger_generate_variant_barcode
  BEFORE INSERT ON public.reference_color_variants
  FOR EACH ROW EXECUTE FUNCTION public.generate_variant_barcode();

-- Auto-generate SKU for color variants
DROP FUNCTION IF EXISTS public.generate_variant_sku() CASCADE;
CREATE OR REPLACE FUNCTION public.generate_variant_sku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_ref_code text;
  v_color_slug text;
BEGIN
  IF NEW.sku IS NULL OR NEW.sku = '' THEN
    SELECT code INTO v_ref_code FROM public.technical_sheets WHERE id = NEW.reference_id;
    v_color_slug := upper(regexp_replace(NEW.color, '[^A-Za-z0-9]', '', 'g'));
    IF length(v_color_slug) > 6 THEN
      v_color_slug := substring(v_color_slug from 1 for 6);
    END IF;
    NEW.sku := COALESCE(v_ref_code, 'REF') || '-' || v_color_slug;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trigger_generate_variant_sku
  BEFORE INSERT ON public.reference_color_variants
  FOR EACH ROW EXECUTE FUNCTION public.generate_variant_sku();
