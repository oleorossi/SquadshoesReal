-- Drop existing overly restrictive SELECT policy
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- Create a more permissive SELECT policy that allows all authenticated users 
-- to view profile summaries (essential for shared views and internal logic)
-- without relying on has_role('admin') which can cause recursion.
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "Profiles are viewable by authenticated users" 
ON public.profiles 
FOR SELECT 
TO authenticated 
USING (true);

-- Ensure user_roles visibility is also stable
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;

DROP POLICY IF EXISTS "Roles are viewable by authenticated users" ON public.user_roles;
CREATE POLICY "Roles are viewable by authenticated users" 
ON public.user_roles 
FOR SELECT 
TO authenticated 
USING (true);