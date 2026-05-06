-- Prevent users from self-approving by changing the 'approved' field on their own profile.
-- A trigger blocks any attempt to alter `approved` unless the caller is an admin.

DROP FUNCTION IF EXISTS public.prevent_self_approval() CASCADE;
CREATE OR REPLACE FUNCTION public.prevent_self_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If the approved column is being changed
  IF NEW.approved IS DISTINCT FROM OLD.approved THEN
    -- Only admins are allowed to change approval status
    IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'Apenas administradores podem alterar o status de aprovação do perfil.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_approval ON public.profiles;

CREATE TRIGGER trg_prevent_self_approval
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_approval();