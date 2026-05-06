-- Fix notifications: restrict SELECT to authenticated + scoped by user
DROP POLICY IF EXISTS "Users can view relevant notifications" ON public.notifications;

CREATE POLICY "Users can view relevant notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR user_id IS NULL);

-- Fix profiles: restrict DELETE to admin only
DROP POLICY IF EXISTS "Approved users can delete profiles" ON public.profiles;

DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
CREATE POLICY "Admins can delete profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));