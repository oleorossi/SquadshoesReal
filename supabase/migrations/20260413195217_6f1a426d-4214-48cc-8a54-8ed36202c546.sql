-- care_instructions: add INSERT and DELETE
DROP POLICY IF EXISTS "Approved users can insert care_instructions" ON public.care_instructions;
CREATE POLICY "Approved users can insert care_instructions"
ON public.care_instructions FOR INSERT
TO authenticated
WITH CHECK (is_approved_user());

DROP POLICY IF EXISTS "Approved users can delete care_instructions" ON public.care_instructions;
CREATE POLICY "Approved users can delete care_instructions"
ON public.care_instructions FOR DELETE
TO authenticated
USING (is_approved_user());

-- label_templates: add INSERT and DELETE
DROP POLICY IF EXISTS "Approved users can insert label_templates" ON public.label_templates;
CREATE POLICY "Approved users can insert label_templates"
ON public.label_templates FOR INSERT
TO authenticated
WITH CHECK (is_approved_user());

DROP POLICY IF EXISTS "Approved users can delete label_templates" ON public.label_templates;
CREATE POLICY "Approved users can delete label_templates"
ON public.label_templates FOR DELETE
TO authenticated
USING (is_approved_user());

-- economic_group_representatives: add UPDATE
DROP POLICY IF EXISTS "Approved users can update economic_group_representatives" ON public.economic_group_representatives;
CREATE POLICY "Approved users can update economic_group_representatives"
ON public.economic_group_representatives FOR UPDATE
TO authenticated
USING (is_approved_user())
WITH CHECK (is_approved_user());