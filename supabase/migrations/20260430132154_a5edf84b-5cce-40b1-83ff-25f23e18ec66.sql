DROP POLICY IF EXISTS "Allow authenticated select artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Allow authenticated select artisanal_recipes" ON public.artisanal_recipes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Allow authenticated insert artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Allow authenticated insert artisanal_recipes" ON public.artisanal_recipes FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Allow authenticated update artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Allow authenticated update artisanal_recipes" ON public.artisanal_recipes FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Allow authenticated delete artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Allow authenticated delete artisanal_recipes" ON public.artisanal_recipes FOR DELETE TO authenticated USING (true);
