DROP FUNCTION IF EXISTS public.check_grade_quantity_coherence() CASCADE;
CREATE OR REPLACE FUNCTION public.check_grade_quantity_coherence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_grade_sum numeric := 0;
BEGIN
  IF NEW.stock_grade IS NULL OR jsonb_typeof(NEW.stock_grade) <> 'object' THEN RETURN NEW; END IF;
  
  -- Sum only keys that do not start with underscore
  SELECT COALESCE(SUM(GREATEST(0, value::numeric)), 0) 
  INTO v_grade_sum 
  FROM jsonb_each_text(NEW.stock_grade)
  WHERE key NOT LIKE '_%';
  
  IF ABS(v_grade_sum - COALESCE(NEW.quantity, 0)) > 0.01 THEN
    RAISE EXCEPTION 'Inconsistência de grade no produto %: soma % != saldo %', NEW.id, v_grade_sum, NEW.quantity;
  END IF;
  RETURN NEW;
END;
$function$;