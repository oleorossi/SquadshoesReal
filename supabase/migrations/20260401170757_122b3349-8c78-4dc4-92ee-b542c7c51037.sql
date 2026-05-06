
-- Auto-generate sequential client_number on insert
DROP FUNCTION IF EXISTS public.auto_assign_client_number() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_assign_client_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num integer;
BEGIN
  IF NEW.client_number IS NULL OR NEW.client_number = '' THEN
    SELECT COALESCE(MAX(NULLIF(client_number, '')::integer), 0) + 1
    INTO next_num
    FROM public.clients
    WHERE client_number ~ '^\d+$';
    
    NEW.client_number := next_num::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_client_number ON public.clients;
CREATE TRIGGER trg_auto_client_number
  BEFORE INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_client_number();

-- Backfill existing clients that have no client_number
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
  FROM public.clients
  WHERE client_number IS NULL OR client_number = ''
)
UPDATE public.clients c
SET client_number = (
  SELECT (COALESCE((SELECT MAX(NULLIF(client_number, '')::integer) FROM public.clients WHERE client_number ~ '^\d+$'), 0) + numbered.rn)::text
  FROM numbered WHERE numbered.id = c.id
)
FROM numbered
WHERE numbered.id = c.id;
