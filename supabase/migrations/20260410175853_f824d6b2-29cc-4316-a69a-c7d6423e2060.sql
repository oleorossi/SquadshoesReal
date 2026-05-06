-- Fix search path
ALTER FUNCTION public.handle_updated_at() SET search_path = public;

-- Fix permissive RLS (limiting to authenticated users instead of using true)
DROP POLICY "Authenticated users can manage sole structures" ON public.sole_structures;

DROP POLICY IF EXISTS "Allow authenticated users to view sole structures" ON public.sole_structures;
CREATE POLICY "Allow authenticated users to view sole structures"
ON public.sole_structures FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert sole structures" ON public.sole_structures;
CREATE POLICY "Allow authenticated users to insert sole structures"
ON public.sole_structures FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update sole structures" ON public.sole_structures;
CREATE POLICY "Allow authenticated users to update sole structures"
ON public.sole_structures FOR UPDATE
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete sole structures" ON public.sole_structures;
CREATE POLICY "Allow authenticated users to delete sole structures"
ON public.sole_structures FOR DELETE
TO authenticated
USING (true);