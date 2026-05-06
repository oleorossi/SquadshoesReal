
-- Drop old always-true write policies
DROP POLICY IF EXISTS "Auth users can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can manage factoring_config" ON public.factoring_config;
DROP POLICY IF EXISTS "Authenticated users can delete finance attachments" ON public.finance_attachments;
DROP POLICY IF EXISTS "Authenticated users can insert finance attachments" ON public.finance_attachments;
DROP POLICY IF EXISTS "Authenticated users can delete group_colors" ON public.group_colors;
DROP POLICY IF EXISTS "Authenticated users can insert group_colors" ON public.group_colors;
DROP POLICY IF EXISTS "Anyone can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can manage packaging_configs" ON public.packaging_configs;
DROP POLICY IF EXISTS "Authenticated users can manage reservation batches" ON public.reservation_batches;
DROP POLICY IF EXISTS "Authenticated users can delete technical_reference_materials" ON public.technical_reference_materials;
DROP POLICY IF EXISTS "Authenticated users can insert technical_reference_materials" ON public.technical_reference_materials;
DROP POLICY IF EXISTS "Authenticated users can update technical_reference_materials" ON public.technical_reference_materials;
DROP POLICY IF EXISTS "Authenticated users can delete technical_references" ON public.technical_references;
DROP POLICY IF EXISTS "Authenticated users can insert technical_references" ON public.technical_references;
DROP POLICY IF EXISTS "Authenticated users can update technical_references" ON public.technical_references;
DROP POLICY IF EXISTS "Allow all access to technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
DROP POLICY IF EXISTS "Allow authenticated users full access to time_exceptions" ON public.time_exceptions;
DROP POLICY IF EXISTS "Authenticated users can manage variant group images" ON public.variant_group_images;

-- Also drop any previously created approved policies to avoid conflicts
DROP POLICY IF EXISTS "Approved users can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Approved users can insert factoring_config" ON public.factoring_config;
DROP POLICY IF EXISTS "Approved users can update factoring_config" ON public.factoring_config;
DROP POLICY IF EXISTS "Approved users can delete factoring_config" ON public.factoring_config;
DROP POLICY IF EXISTS "Approved users can insert finance attachments" ON public.finance_attachments;
DROP POLICY IF EXISTS "Approved users can delete finance attachments" ON public.finance_attachments;
DROP POLICY IF EXISTS "Approved users can insert group_colors" ON public.group_colors;
DROP POLICY IF EXISTS "Approved users can delete group_colors" ON public.group_colors;
DROP POLICY IF EXISTS "Approved users can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Auth users can read reservation_batches" ON public.reservation_batches;
DROP POLICY IF EXISTS "Approved users can insert reservation_batches" ON public.reservation_batches;
DROP POLICY IF EXISTS "Approved users can update reservation_batches" ON public.reservation_batches;
DROP POLICY IF EXISTS "Approved users can delete reservation_batches" ON public.reservation_batches;
DROP POLICY IF EXISTS "Approved users can insert technical_reference_materials" ON public.technical_reference_materials;
DROP POLICY IF EXISTS "Approved users can update technical_reference_materials" ON public.technical_reference_materials;
DROP POLICY IF EXISTS "Approved users can delete technical_reference_materials" ON public.technical_reference_materials;
DROP POLICY IF EXISTS "Approved users can insert technical_references" ON public.technical_references;
DROP POLICY IF EXISTS "Approved users can update technical_references" ON public.technical_references;
DROP POLICY IF EXISTS "Approved users can delete technical_references" ON public.technical_references;
DROP POLICY IF EXISTS "Auth users can read technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
DROP POLICY IF EXISTS "Auth users can read time_exceptions" ON public.time_exceptions;
DROP POLICY IF EXISTS "Approved users can insert time_exceptions" ON public.time_exceptions;
DROP POLICY IF EXISTS "Approved users can update time_exceptions" ON public.time_exceptions;
DROP POLICY IF EXISTS "Approved users can delete time_exceptions" ON public.time_exceptions;
DROP POLICY IF EXISTS "Auth users can read variant_group_images" ON public.variant_group_images;
DROP POLICY IF EXISTS "Approved users can insert variant_group_images" ON public.variant_group_images;
DROP POLICY IF EXISTS "Approved users can update variant_group_images" ON public.variant_group_images;
DROP POLICY IF EXISTS "Approved users can delete variant_group_images" ON public.variant_group_images;

-- Now create all the proper policies

-- audit_logs
DROP POLICY IF EXISTS "Approved users can insert audit logs" ON public.audit_logs;
CREATE POLICY "Approved users can insert audit logs" ON public.audit_logs
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());

-- factoring_config
DROP POLICY IF EXISTS "Approved users can insert factoring_config" ON public.factoring_config;
CREATE POLICY "Approved users can insert factoring_config" ON public.factoring_config
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update factoring_config" ON public.factoring_config;
CREATE POLICY "Approved users can update factoring_config" ON public.factoring_config
FOR UPDATE TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete factoring_config" ON public.factoring_config;
CREATE POLICY "Approved users can delete factoring_config" ON public.factoring_config
FOR DELETE TO authenticated USING (public.is_approved_user());

-- finance_attachments
DROP POLICY IF EXISTS "Approved users can insert finance attachments" ON public.finance_attachments;
CREATE POLICY "Approved users can insert finance attachments" ON public.finance_attachments
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete finance attachments" ON public.finance_attachments;
CREATE POLICY "Approved users can delete finance attachments" ON public.finance_attachments
FOR DELETE TO authenticated USING (public.is_approved_user());

-- group_colors
DROP POLICY IF EXISTS "Approved users can insert group_colors" ON public.group_colors;
CREATE POLICY "Approved users can insert group_colors" ON public.group_colors
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete group_colors" ON public.group_colors;
CREATE POLICY "Approved users can delete group_colors" ON public.group_colors
FOR DELETE TO authenticated USING (public.is_approved_user());

-- notifications
DROP POLICY IF EXISTS "Approved users can create notifications" ON public.notifications;
CREATE POLICY "Approved users can create notifications" ON public.notifications
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());

-- reservation_batches
DROP POLICY IF EXISTS "Auth users can read reservation_batches" ON public.reservation_batches;
CREATE POLICY "Auth users can read reservation_batches" ON public.reservation_batches
FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Approved users can insert reservation_batches" ON public.reservation_batches;
CREATE POLICY "Approved users can insert reservation_batches" ON public.reservation_batches
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update reservation_batches" ON public.reservation_batches;
CREATE POLICY "Approved users can update reservation_batches" ON public.reservation_batches
FOR UPDATE TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete reservation_batches" ON public.reservation_batches;
CREATE POLICY "Approved users can delete reservation_batches" ON public.reservation_batches
FOR DELETE TO authenticated USING (public.is_approved_user());

-- technical_reference_materials
DROP POLICY IF EXISTS "Approved users can insert technical_reference_materials" ON public.technical_reference_materials;
CREATE POLICY "Approved users can insert technical_reference_materials" ON public.technical_reference_materials
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update technical_reference_materials" ON public.technical_reference_materials;
CREATE POLICY "Approved users can update technical_reference_materials" ON public.technical_reference_materials
FOR UPDATE TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete technical_reference_materials" ON public.technical_reference_materials;
CREATE POLICY "Approved users can delete technical_reference_materials" ON public.technical_reference_materials
FOR DELETE TO authenticated USING (public.is_approved_user());

-- technical_references
DROP POLICY IF EXISTS "Approved users can insert technical_references" ON public.technical_references;
CREATE POLICY "Approved users can insert technical_references" ON public.technical_references
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update technical_references" ON public.technical_references;
CREATE POLICY "Approved users can update technical_references" ON public.technical_references
FOR UPDATE TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete technical_references" ON public.technical_references;
CREATE POLICY "Approved users can delete technical_references" ON public.technical_references
FOR DELETE TO authenticated USING (public.is_approved_user());

-- technical_sheet_sole_colors
DROP POLICY IF EXISTS "Auth users can read technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
CREATE POLICY "Auth users can read technical_sheet_sole_colors" ON public.technical_sheet_sole_colors
FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
CREATE POLICY "Approved users can insert technical_sheet_sole_colors" ON public.technical_sheet_sole_colors
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
CREATE POLICY "Approved users can update technical_sheet_sole_colors" ON public.technical_sheet_sole_colors
FOR UPDATE TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
CREATE POLICY "Approved users can delete technical_sheet_sole_colors" ON public.technical_sheet_sole_colors
FOR DELETE TO authenticated USING (public.is_approved_user());

-- time_exceptions
DROP POLICY IF EXISTS "Auth users can read time_exceptions" ON public.time_exceptions;
CREATE POLICY "Auth users can read time_exceptions" ON public.time_exceptions
FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Approved users can insert time_exceptions" ON public.time_exceptions;
CREATE POLICY "Approved users can insert time_exceptions" ON public.time_exceptions
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update time_exceptions" ON public.time_exceptions;
CREATE POLICY "Approved users can update time_exceptions" ON public.time_exceptions
FOR UPDATE TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete time_exceptions" ON public.time_exceptions;
CREATE POLICY "Approved users can delete time_exceptions" ON public.time_exceptions
FOR DELETE TO authenticated USING (public.is_approved_user());

-- variant_group_images
DROP POLICY IF EXISTS "Auth users can read variant_group_images" ON public.variant_group_images;
CREATE POLICY "Auth users can read variant_group_images" ON public.variant_group_images
FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Approved users can insert variant_group_images" ON public.variant_group_images;
CREATE POLICY "Approved users can insert variant_group_images" ON public.variant_group_images
FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update variant_group_images" ON public.variant_group_images;
CREATE POLICY "Approved users can update variant_group_images" ON public.variant_group_images
FOR UPDATE TO authenticated USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete variant_group_images" ON public.variant_group_images;
CREATE POLICY "Approved users can delete variant_group_images" ON public.variant_group_images
FOR DELETE TO authenticated USING (public.is_approved_user());
