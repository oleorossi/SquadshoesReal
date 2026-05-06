
-- Update group number function: G + 3 digits
DROP FUNCTION IF EXISTS public.generate_group_number() CASCADE;
CREATE OR REPLACE FUNCTION public.generate_group_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.group_number IS NULL OR NEW.group_number = '' THEN
    NEW.group_number := 'G' || lpad(nextval('economic_group_number_seq')::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$function$;

-- Update client number function: L + 3 digits
DROP FUNCTION IF EXISTS public.generate_client_number() CASCADE;
CREATE OR REPLACE FUNCTION public.generate_client_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.client_number IS NULL OR NEW.client_number = '' THEN
    NEW.client_number := 'L' || lpad(nextval('client_number_seq')::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$function$;

-- Migrate existing group numbers from GRP-XXXX to GXXX
UPDATE economic_groups
SET group_number = 'G' || lpad(regexp_replace(group_number, '^GRP-0*', ''), 3, '0')
WHERE group_number LIKE 'GRP-%';

-- Migrate existing client numbers from CLI-XXXXX to LXXX
UPDATE clients
SET client_number = 'L' || lpad(regexp_replace(client_number, '^CLI-0*', ''), 3, '0')
WHERE client_number LIKE 'CLI-%';
