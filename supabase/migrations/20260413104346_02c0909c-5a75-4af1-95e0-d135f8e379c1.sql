
-- 1. economic_groups: restringir SELECT
DROP POLICY IF EXISTS "Anyone can view groups" ON public.economic_groups;
DROP POLICY IF EXISTS "Authenticated users can view economic groups" ON public.economic_groups;
CREATE POLICY "Approved users can view economic groups"
  ON public.economic_groups FOR SELECT TO authenticated
  USING (public.is_approved_user());

-- 2. nfe_emitidas: restringir SELECT
DROP POLICY IF EXISTS "Authenticated users can view nfe" ON public.nfe_emitidas;
DROP POLICY IF EXISTS "Anyone can view nfe_emitidas" ON public.nfe_emitidas;
DROP POLICY IF EXISTS "Approved users can view nfe_emitidas" ON public.nfe_emitidas;
DO $$ 
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'nfe_emitidas' AND cmd = 'r' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.nfe_emitidas', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "Approved users can view nfe_emitidas"
  ON public.nfe_emitidas FOR SELECT TO authenticated
  USING (public.is_approved_user());

-- 3. time_exceptions: restringir SELECT
DO $$ 
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'time_exceptions' AND cmd = 'r' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.time_exceptions', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "Approved users can view time_exceptions"
  ON public.time_exceptions FOR SELECT TO authenticated
  USING (public.is_approved_user());
