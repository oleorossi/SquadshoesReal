
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Anyone can delete products" ON public.products;
DROP POLICY IF EXISTS "Anyone can insert products" ON public.products;
DROP POLICY IF EXISTS "Anyone can update products" ON public.products;
DROP POLICY IF EXISTS "Anyone can view products" ON public.products;

-- Create permissive policies for authenticated users only
DROP POLICY IF EXISTS "Authenticated users can view products" ON public.products;
CREATE POLICY "Authenticated users can view products"
ON public.products FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert products" ON public.products;
CREATE POLICY "Authenticated users can insert products"
ON public.products FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update products" ON public.products;
CREATE POLICY "Authenticated users can update products"
ON public.products FOR UPDATE TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can delete products" ON public.products;
CREATE POLICY "Authenticated users can delete products"
ON public.products FOR DELETE TO authenticated
USING (true);
