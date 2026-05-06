
-- Create profiles for any existing users that don't have one yet
INSERT INTO public.profiles (id, email, full_name, approved)
SELECT id, COALESCE(email, ''), '', true
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- Give admin role to first existing user if no admins exist
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role
FROM auth.users
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin')
LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;
