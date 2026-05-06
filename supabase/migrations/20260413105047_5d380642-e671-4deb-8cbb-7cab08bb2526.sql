
-- Fix: Remove public read policy from label_templates
DROP POLICY IF EXISTS "Public read templates" ON public.label_templates;

-- Fix: Remove public read policy from care_instructions
DROP POLICY IF EXISTS "Public read care_instructions" ON public.care_instructions;

-- Ensure authenticated-only policies exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'label_templates' AND policyname = 'Approved users can view templates') THEN
    DROP POLICY IF EXISTS "Approved users can view templates" ON public.label_templates;
CREATE POLICY "Approved users can view templates"
      ON public.label_templates FOR SELECT TO authenticated
      USING (public.is_approved_user());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'care_instructions' AND policyname = 'Approved users can view care_instructions') THEN
    DROP POLICY IF EXISTS "Approved users can view care_instructions" ON public.care_instructions;
CREATE POLICY "Approved users can view care_instructions"
      ON public.care_instructions FOR SELECT TO authenticated
      USING (public.is_approved_user());
  END IF;
END $$;
