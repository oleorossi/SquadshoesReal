-- FASE 9: correções aplicadas durante auditoria
--
-- 1. check_grade_quantity_coherence ignorava _size_from/_size_to do JSONB,
--    somando esses números como qty e bloqueando UPDATEs legítimos.
-- 2. resolve_palmilha_color usava unaccent() que pode não estar habilitado
--    em todos os ambientes — simplificado pra lower+trim.

CREATE OR REPLACE FUNCTION public.check_grade_quantity_coherence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_grade_sum numeric := 0;
BEGIN
  IF NEW.stock_grade IS NULL OR jsonb_typeof(NEW.stock_grade) <> 'object' THEN
    RETURN NEW;
  END IF;

  IF (SELECT COUNT(*) FROM jsonb_each_text(NEW.stock_grade)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Ignora keys de metadata com prefixo underscore (_size_from, _size_to)
  SELECT COALESCE(SUM(GREATEST(0, value::numeric)), 0)
    INTO v_grade_sum
    FROM jsonb_each_text(NEW.stock_grade)
   WHERE NOT (key LIKE '\_%' ESCAPE '\');

  IF ABS(v_grade_sum - COALESCE(NEW.quantity, 0)) > 0.01 THEN
    RAISE EXCEPTION 'Inconsistência: SUM(stock_grade) = % difere de quantity = % no produto %',
      v_grade_sum, NEW.quantity, NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_palmilha_color(
  p_sheet_id uuid,
  p_cabedal_color text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_palm text;
BEGIN
  IF p_sheet_id IS NULL OR p_cabedal_color IS NULL THEN
    RETURN '';
  END IF;

  SELECT palmilha_color INTO v_palm
    FROM public.technical_sheet_palmilha_colors
   WHERE sheet_id = p_sheet_id
     AND lower(trim(cabedal_color)) = lower(trim(p_cabedal_color))
   LIMIT 1;

  RETURN COALESCE(v_palm, '');
END;
$$;
