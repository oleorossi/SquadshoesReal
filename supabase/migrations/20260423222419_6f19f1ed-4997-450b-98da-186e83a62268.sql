-- Fix RLS for sole_silk_registrations
DROP POLICY IF EXISTS "Allow authenticated users to insert silk registrations" ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Allow authenticated users to update silk registrations" ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Allow authenticated users to delete silk registrations" ON public.sole_silk_registrations;

DROP POLICY IF EXISTS "Approved users can insert silk registrations" ON public.sole_silk_registrations;
CREATE POLICY "Approved users can insert silk registrations" 
ON public.sole_silk_registrations FOR INSERT 
WITH CHECK (is_approved_user());

DROP POLICY IF EXISTS "Approved users can update silk registrations" ON public.sole_silk_registrations;
CREATE POLICY "Approved users can update silk registrations" 
ON public.sole_silk_registrations FOR UPDATE 
USING (is_approved_user());

DROP POLICY IF EXISTS "Approved users can delete silk registrations" ON public.sole_silk_registrations;
CREATE POLICY "Approved users can delete silk registrations" 
ON public.sole_silk_registrations FOR DELETE 
USING (is_approved_user());

-- Performance Indexes (if they don't exist)
CREATE INDEX IF NOT EXISTS idx_products_updated_at ON public.products (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_sale_orders_created_at ON public.sale_orders (created_at DESC);

-- Fix search_path for common functions to improve security
ALTER FUNCTION public.is_approved_user() SET search_path = public, auth;
ALTER FUNCTION public.has_role(uuid, app_role) SET search_path = public, auth;
