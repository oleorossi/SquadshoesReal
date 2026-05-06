-- 1. Fix finance-attachments storage SELECT: restrict to approved users
DROP POLICY IF EXISTS "Authenticated users can view finance attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can view finance attachments" ON storage.objects;

DROP POLICY IF EXISTS "Approved users can view finance attachments" ON storage.objects;
CREATE POLICY "Approved users can view finance attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'finance-attachments' AND public.is_approved_user());

-- 2. Fix finance_attachments table SELECT: restrict to approved users  
DROP POLICY IF EXISTS "Authenticated users can view finance attachments" ON public.finance_attachments;
DROP POLICY IF EXISTS "Users can view finance attachments" ON public.finance_attachments;
DROP POLICY IF EXISTS "finance_attachments_select" ON public.finance_attachments;

DROP POLICY IF EXISTS "Approved users can view finance attachments" ON public.finance_attachments;
CREATE POLICY "Approved users can view finance attachments"
  ON public.finance_attachments FOR SELECT
  TO authenticated
  USING (public.is_approved_user());