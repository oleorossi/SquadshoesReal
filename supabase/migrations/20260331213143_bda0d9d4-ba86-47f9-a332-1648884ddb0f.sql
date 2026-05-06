
-- Sequences for auto-numbering
CREATE SEQUENCE IF NOT EXISTS client_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS economic_group_number_seq START 1;

-- Add columns
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS client_number text;
ALTER TABLE public.economic_groups ADD COLUMN IF NOT EXISTS group_number text;

-- Populate existing clients
UPDATE public.clients SET client_number = 'CLI-' || lpad(nextval('client_number_seq')::text, 5, '0') WHERE client_number IS NULL;
UPDATE public.economic_groups SET group_number = 'GRP-' || lpad(nextval('economic_group_number_seq')::text, 4, '0') WHERE group_number IS NULL;

-- Auto-generate on insert for clients
DROP FUNCTION IF EXISTS public.generate_client_number() CASCADE;
CREATE OR REPLACE FUNCTION public.generate_client_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.client_number IS NULL OR NEW.client_number = '' THEN
    NEW.client_number := 'CLI-' || lpad(nextval('client_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_client_number ON public.clients;
CREATE TRIGGER trg_generate_client_number
  BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.generate_client_number();

-- Auto-generate on insert for economic_groups
DROP FUNCTION IF EXISTS public.generate_group_number() CASCADE;
CREATE OR REPLACE FUNCTION public.generate_group_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.group_number IS NULL OR NEW.group_number = '' THEN
    NEW.group_number := 'GRP-' || lpad(nextval('economic_group_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_group_number ON public.economic_groups;
CREATE TRIGGER trg_generate_group_number
  BEFORE INSERT ON public.economic_groups
  FOR EACH ROW EXECUTE FUNCTION public.generate_group_number();
