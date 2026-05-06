DROP FUNCTION IF EXISTS public.normalize_product_unit() CASCADE;
CREATE OR REPLACE FUNCTION public.normalize_product_unit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_norm text;
BEGIN
  IF NEW.unit IS NULL OR trim(NEW.unit) = '' THEN
    RETURN NEW;
  END IF;

  v_norm := lower(trim(NEW.unit));

  -- length / linear
  IF v_norm IN ('metros','metro','mt','m linear','m. linear','m.linear') THEN
    NEW.unit := 'm';
  ELSIF v_norm IN ('centimetro','centímetro','centimetros','centímetros','cm linear','cm. linear') THEN
    NEW.unit := 'cm';
  ELSIF v_norm IN ('milimetro','milímetro','milimetros','milímetros') THEN
    NEW.unit := 'mm';
  -- mass
  ELSIF v_norm IN ('kilo','kilos','quilo','quilos','quilograma','kilograma','quilogramas','kilogramas') THEN
    NEW.unit := 'kg';
  ELSIF v_norm IN ('grama','gramas','gr','grs') THEN
    NEW.unit := 'g';
  -- volume
  ELSIF v_norm IN ('litro','litros') THEN
    NEW.unit := 'L';
  ELSIF v_norm IN ('mililitro','mililitros') THEN
    NEW.unit := 'ml';
  -- count
  ELSIF v_norm IN ('unidade','unidades','unid','unids') THEN
    NEW.unit := 'un';
  ELSIF v_norm = 'pares' THEN
    NEW.unit := 'par';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_product_unit ON public.products;
CREATE TRIGGER trg_normalize_product_unit
BEFORE INSERT OR UPDATE OF unit ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.normalize_product_unit();

COMMENT ON FUNCTION public.normalize_product_unit IS
  'Normaliza products.unit para formas curtas canônicas (m, cm, kg, g, L, ml, un, par) reconhecidas pelo frontend.';