-- Regra padrão: toda ficha que define um sole_material consome 1 par de solado por par produzido
-- 1) Backfill: corrige fichas existentes
UPDATE public.technical_sheets
SET sole_consumption = 1
WHERE sole_material IS NOT NULL
  AND sole_material <> ''
  AND (sole_consumption IS NULL OR sole_consumption <> 1);

-- 2) Default na coluna para novas fichas
ALTER TABLE public.technical_sheets
  ALTER COLUMN sole_consumption SET DEFAULT 1;

-- 3) Trigger para forçar sempre 1 quando sole_material definido
CREATE OR REPLACE FUNCTION public.enforce_sole_consumption_one()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.sole_material IS NOT NULL AND NEW.sole_material <> '' THEN
    NEW.sole_consumption := 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sole_consumption_one ON public.technical_sheets;
CREATE TRIGGER trg_enforce_sole_consumption_one
BEFORE INSERT OR UPDATE OF sole_material, sole_consumption
ON public.technical_sheets
FOR EACH ROW
EXECUTE FUNCTION public.enforce_sole_consumption_one();