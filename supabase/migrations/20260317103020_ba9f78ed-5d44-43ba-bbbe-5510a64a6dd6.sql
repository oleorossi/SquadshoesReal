-- Fix remaining policies with different names

-- economic_group_representatives (different policy names)
DROP POLICY IF EXISTS "Auth users can delete eg_representatives" ON public.economic_group_representatives;
DROP POLICY IF EXISTS "Auth users can insert eg_representatives" ON public.economic_group_representatives;

-- employee_advances (different policy names)
DROP POLICY IF EXISTS "Auth users can delete advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Auth users can insert advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Auth users can update advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Approved users can insert advances" ON public.employee_advances;
CREATE POLICY "Approved users can insert advances" ON public.employee_advances FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update advances" ON public.employee_advances;
CREATE POLICY "Approved users can update advances" ON public.employee_advances FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete advances" ON public.employee_advances;
CREATE POLICY "Approved users can delete advances" ON public.employee_advances FOR DELETE TO authenticated USING (public.is_approved_user());

-- product_groups (different policy names)
DROP POLICY IF EXISTS "Auth users can delete groups" ON public.product_groups;
DROP POLICY IF EXISTS "Auth users can insert groups" ON public.product_groups;
DROP POLICY IF EXISTS "Auth users can update groups" ON public.product_groups;

-- product_references (different policy names)
DROP POLICY IF EXISTS "Auth users can delete references" ON public.product_references;
DROP POLICY IF EXISTS "Auth users can insert references" ON public.product_references;
DROP POLICY IF EXISTS "Auth users can update references" ON public.product_references;

-- products (different policy names)
DROP POLICY IF EXISTS "Authenticated users can delete products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can insert products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can update products" ON public.products;

-- profiles (system insert policy)
DROP POLICY IF EXISTS "System can insert profiles" ON public.profiles;

-- reference_materials (different policy names)
DROP POLICY IF EXISTS "Auth users can delete ref materials" ON public.reference_materials;
DROP POLICY IF EXISTS "Auth users can insert ref materials" ON public.reference_materials;
DROP POLICY IF EXISTS "Auth users can update ref materials" ON public.reference_materials;

-- stock_movements (different policy name)
DROP POLICY IF EXISTS "Auth users can insert movements" ON public.stock_movements;