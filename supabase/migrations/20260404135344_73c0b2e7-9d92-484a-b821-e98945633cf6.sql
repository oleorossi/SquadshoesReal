
-- 1. Fix fiscal_config: restrict SELECT to approved users only
DROP POLICY IF EXISTS "Auth users can view fiscal_config" ON public.fiscal_config;
DROP POLICY IF EXISTS "Approved users can view fiscal_config" ON public.fiscal_config;
CREATE POLICY "Approved users can view fiscal_config" ON public.fiscal_config
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

-- 2. Fix label_templates: restrict SELECT to authenticated (remove public access)
DROP POLICY IF EXISTS "Public read label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "Anyone can view label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "Auth users can view label_templates" ON public.label_templates;
CREATE POLICY "Auth users can view label_templates" ON public.label_templates
  FOR SELECT TO authenticated
  USING (true);

-- 3. Fix technical_sheet_sole_colors: remove anon SELECT
DROP POLICY IF EXISTS "Anyone can read sole color mappings" ON public.technical_sheet_sole_colors;
DROP POLICY IF EXISTS "Public read sole_colors" ON public.technical_sheet_sole_colors;
-- Ensure authenticated policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'technical_sheet_sole_colors' 
    AND policyname = 'Auth users can view sole_colors'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Auth users can view sole_colors" ON public.technical_sheet_sole_colors;
CREATE POLICY "Auth users can view sole_colors" ON public.technical_sheet_sole_colors FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- 4. Fix certificates storage bucket: restrict to approved users
DROP POLICY IF EXISTS "Authenticated users can read certificates" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated read certificates" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can read certificates" ON storage.objects;
CREATE POLICY "Approved users can read certificates" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'certificates' AND public.is_approved_user());

-- 5. Fix employee-receipts storage bucket: restrict to approved users
DROP POLICY IF EXISTS "Authenticated users can read employee-receipts" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated read employee-receipts" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can read employee-receipts" ON storage.objects;
CREATE POLICY "Approved users can read employee-receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'employee-receipts' AND public.is_approved_user());
