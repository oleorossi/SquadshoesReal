CREATE POLICY "Allow authenticated select artisanal_recipes" ON public.artisanal_recipes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert artisanal_recipes" ON public.artisanal_recipes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update artisanal_recipes" ON public.artisanal_recipes FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated delete artisanal_recipes" ON public.artisanal_recipes FOR DELETE TO authenticated USING (true);
