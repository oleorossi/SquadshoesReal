
-- PART 1 — Tables with RLS enabled but missing policies

-- artisanal_recipes
DROP POLICY IF EXISTS "Approved users can view artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can insert artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can update artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can delete artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Authenticated users can view artisanal recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can view artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can view artisanal_recipes" ON public.artisanal_recipes FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can insert artisanal_recipes" ON public.artisanal_recipes FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can update artisanal_recipes" ON public.artisanal_recipes FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can delete artisanal_recipes" ON public.artisanal_recipes FOR DELETE TO authenticated USING (public.is_approved_user());

-- default_lead_times
DROP POLICY IF EXISTS "Approved users can view default_lead_times" ON public.default_lead_times;
DROP POLICY IF EXISTS "Approved users can insert default_lead_times" ON public.default_lead_times;
DROP POLICY IF EXISTS "Approved users can update default_lead_times" ON public.default_lead_times;
DROP POLICY IF EXISTS "Approved users can delete default_lead_times" ON public.default_lead_times;
DROP POLICY IF EXISTS "Approved users can view default_lead_times" ON public.default_lead_times;
CREATE POLICY "Approved users can view default_lead_times" ON public.default_lead_times FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert default_lead_times" ON public.default_lead_times;
CREATE POLICY "Approved users can insert default_lead_times" ON public.default_lead_times FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update default_lead_times" ON public.default_lead_times;
CREATE POLICY "Approved users can update default_lead_times" ON public.default_lead_times FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete default_lead_times" ON public.default_lead_times;
CREATE POLICY "Approved users can delete default_lead_times" ON public.default_lead_times FOR DELETE TO authenticated USING (public.is_approved_user());

-- employee_skills
DROP POLICY IF EXISTS "Approved users can view employee_skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Approved users can insert employee_skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Approved users can update employee_skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Approved users can delete employee_skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Approved users can view employee_skills" ON public.employee_skills;
CREATE POLICY "Approved users can view employee_skills" ON public.employee_skills FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert employee_skills" ON public.employee_skills;
CREATE POLICY "Approved users can insert employee_skills" ON public.employee_skills FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update employee_skills" ON public.employee_skills;
CREATE POLICY "Approved users can update employee_skills" ON public.employee_skills FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete employee_skills" ON public.employee_skills;
CREATE POLICY "Approved users can delete employee_skills" ON public.employee_skills FOR DELETE TO authenticated USING (public.is_approved_user());

-- equipment_downtime
DROP POLICY IF EXISTS "Approved users can view equipment_downtime" ON public.equipment_downtime;
DROP POLICY IF EXISTS "Approved users can insert equipment_downtime" ON public.equipment_downtime;
DROP POLICY IF EXISTS "Approved users can update equipment_downtime" ON public.equipment_downtime;
DROP POLICY IF EXISTS "Approved users can delete equipment_downtime" ON public.equipment_downtime;
DROP POLICY IF EXISTS "Approved users can view equipment_downtime" ON public.equipment_downtime;
CREATE POLICY "Approved users can view equipment_downtime" ON public.equipment_downtime FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert equipment_downtime" ON public.equipment_downtime;
CREATE POLICY "Approved users can insert equipment_downtime" ON public.equipment_downtime FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update equipment_downtime" ON public.equipment_downtime;
CREATE POLICY "Approved users can update equipment_downtime" ON public.equipment_downtime FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete equipment_downtime" ON public.equipment_downtime;
CREATE POLICY "Approved users can delete equipment_downtime" ON public.equipment_downtime FOR DELETE TO authenticated USING (public.is_approved_user());

-- inventory_transactions
DROP POLICY IF EXISTS "Allow full access for authenticated users to inventory transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can view inventory_transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can insert inventory_transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can update inventory_transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can delete inventory_transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can view inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "Approved users can view inventory_transactions" ON public.inventory_transactions FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "Approved users can insert inventory_transactions" ON public.inventory_transactions FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "Approved users can update inventory_transactions" ON public.inventory_transactions FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "Approved users can delete inventory_transactions" ON public.inventory_transactions FOR DELETE TO authenticated USING (public.is_approved_user());

-- material_audit_log
DROP POLICY IF EXISTS "Approved users can view material_audit_log" ON public.material_audit_log;
DROP POLICY IF EXISTS "Approved users can insert material_audit_log" ON public.material_audit_log;
DROP POLICY IF EXISTS "Approved users can update material_audit_log" ON public.material_audit_log;
DROP POLICY IF EXISTS "Approved users can delete material_audit_log" ON public.material_audit_log;
DROP POLICY IF EXISTS "Approved users can view material_audit_log" ON public.material_audit_log;
CREATE POLICY "Approved users can view material_audit_log" ON public.material_audit_log FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert material_audit_log" ON public.material_audit_log;
CREATE POLICY "Approved users can insert material_audit_log" ON public.material_audit_log FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());

-- product_technical_sheets
DROP POLICY IF EXISTS "Allow full access for authenticated users to technical sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can view product_technical_sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can insert product_technical_sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can update product_technical_sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can delete product_technical_sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can view product_technical_sheets" ON public.product_technical_sheets;
CREATE POLICY "Approved users can view product_technical_sheets" ON public.product_technical_sheets FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert product_technical_sheets" ON public.product_technical_sheets;
CREATE POLICY "Approved users can insert product_technical_sheets" ON public.product_technical_sheets FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update product_technical_sheets" ON public.product_technical_sheets;
CREATE POLICY "Approved users can update product_technical_sheets" ON public.product_technical_sheets FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete product_technical_sheets" ON public.product_technical_sheets;
CREATE POLICY "Approved users can delete product_technical_sheets" ON public.product_technical_sheets FOR DELETE TO authenticated USING (public.is_approved_user());

-- production_equipment
DROP POLICY IF EXISTS "Approved users can view production_equipment" ON public.production_equipment;
DROP POLICY IF EXISTS "Approved users can insert production_equipment" ON public.production_equipment;
DROP POLICY IF EXISTS "Approved users can update production_equipment" ON public.production_equipment;
DROP POLICY IF EXISTS "Approved users can delete production_equipment" ON public.production_equipment;
DROP POLICY IF EXISTS "Approved users can view production_equipment" ON public.production_equipment;
CREATE POLICY "Approved users can view production_equipment" ON public.production_equipment FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert production_equipment" ON public.production_equipment;
CREATE POLICY "Approved users can insert production_equipment" ON public.production_equipment FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update production_equipment" ON public.production_equipment;
CREATE POLICY "Approved users can update production_equipment" ON public.production_equipment FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete production_equipment" ON public.production_equipment;
CREATE POLICY "Approved users can delete production_equipment" ON public.production_equipment FOR DELETE TO authenticated USING (public.is_approved_user());

-- quality_checklists
DROP POLICY IF EXISTS "Approved users can view quality_checklists" ON public.quality_checklists;
DROP POLICY IF EXISTS "Approved users can insert quality_checklists" ON public.quality_checklists;
DROP POLICY IF EXISTS "Approved users can update quality_checklists" ON public.quality_checklists;
DROP POLICY IF EXISTS "Approved users can delete quality_checklists" ON public.quality_checklists;
DROP POLICY IF EXISTS "Approved users can view quality_checklists" ON public.quality_checklists;
CREATE POLICY "Approved users can view quality_checklists" ON public.quality_checklists FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert quality_checklists" ON public.quality_checklists;
CREATE POLICY "Approved users can insert quality_checklists" ON public.quality_checklists FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update quality_checklists" ON public.quality_checklists;
CREATE POLICY "Approved users can update quality_checklists" ON public.quality_checklists FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete quality_checklists" ON public.quality_checklists;
CREATE POLICY "Approved users can delete quality_checklists" ON public.quality_checklists FOR DELETE TO authenticated USING (public.is_approved_user());

-- quality_inspections
DROP POLICY IF EXISTS "Approved users can view quality_inspections" ON public.quality_inspections;
DROP POLICY IF EXISTS "Approved users can insert quality_inspections" ON public.quality_inspections;
DROP POLICY IF EXISTS "Approved users can update quality_inspections" ON public.quality_inspections;
DROP POLICY IF EXISTS "Approved users can delete quality_inspections" ON public.quality_inspections;
DROP POLICY IF EXISTS "Approved users can view quality_inspections" ON public.quality_inspections;
CREATE POLICY "Approved users can view quality_inspections" ON public.quality_inspections FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert quality_inspections" ON public.quality_inspections;
CREATE POLICY "Approved users can insert quality_inspections" ON public.quality_inspections FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update quality_inspections" ON public.quality_inspections;
CREATE POLICY "Approved users can update quality_inspections" ON public.quality_inspections FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete quality_inspections" ON public.quality_inspections;
CREATE POLICY "Approved users can delete quality_inspections" ON public.quality_inspections FOR DELETE TO authenticated USING (public.is_approved_user());

-- sales_targets
DROP POLICY IF EXISTS "Approved users can view sales_targets" ON public.sales_targets;
DROP POLICY IF EXISTS "Approved users can insert sales_targets" ON public.sales_targets;
DROP POLICY IF EXISTS "Approved users can update sales_targets" ON public.sales_targets;
DROP POLICY IF EXISTS "Approved users can delete sales_targets" ON public.sales_targets;
DROP POLICY IF EXISTS "Approved users can view sales_targets" ON public.sales_targets;
CREATE POLICY "Approved users can view sales_targets" ON public.sales_targets FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert sales_targets" ON public.sales_targets;
CREATE POLICY "Approved users can insert sales_targets" ON public.sales_targets FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update sales_targets" ON public.sales_targets;
CREATE POLICY "Approved users can update sales_targets" ON public.sales_targets FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete sales_targets" ON public.sales_targets;
CREATE POLICY "Approved users can delete sales_targets" ON public.sales_targets FOR DELETE TO authenticated USING (public.is_approved_user());

-- sheet_catalog_models
DROP POLICY IF EXISTS "Approved users can manage catalog models" ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can view sheet_catalog_models" ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can insert sheet_catalog_models" ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can update sheet_catalog_models" ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can delete sheet_catalog_models" ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can view sheet_catalog_models" ON public.sheet_catalog_models;
CREATE POLICY "Approved users can view sheet_catalog_models" ON public.sheet_catalog_models FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert sheet_catalog_models" ON public.sheet_catalog_models;
CREATE POLICY "Approved users can insert sheet_catalog_models" ON public.sheet_catalog_models FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update sheet_catalog_models" ON public.sheet_catalog_models;
CREATE POLICY "Approved users can update sheet_catalog_models" ON public.sheet_catalog_models FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete sheet_catalog_models" ON public.sheet_catalog_models;
CREATE POLICY "Approved users can delete sheet_catalog_models" ON public.sheet_catalog_models FOR DELETE TO authenticated USING (public.is_approved_user());

-- sheet_material_grading
DROP POLICY IF EXISTS "Approved users can view sheet_material_grading" ON public.sheet_material_grading;
DROP POLICY IF EXISTS "Approved users can insert sheet_material_grading" ON public.sheet_material_grading;
DROP POLICY IF EXISTS "Approved users can update sheet_material_grading" ON public.sheet_material_grading;
DROP POLICY IF EXISTS "Approved users can delete sheet_material_grading" ON public.sheet_material_grading;
DROP POLICY IF EXISTS "Approved users can view sheet_material_grading" ON public.sheet_material_grading;
CREATE POLICY "Approved users can view sheet_material_grading" ON public.sheet_material_grading FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert sheet_material_grading" ON public.sheet_material_grading;
CREATE POLICY "Approved users can insert sheet_material_grading" ON public.sheet_material_grading FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update sheet_material_grading" ON public.sheet_material_grading;
CREATE POLICY "Approved users can update sheet_material_grading" ON public.sheet_material_grading FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete sheet_material_grading" ON public.sheet_material_grading;
CREATE POLICY "Approved users can delete sheet_material_grading" ON public.sheet_material_grading FOR DELETE TO authenticated USING (public.is_approved_user());

-- sole_silk_registrations
DROP POLICY IF EXISTS "Approved users can view sole_silk_registrations" ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Approved users can insert sole_silk_registrations" ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Approved users can update sole_silk_registrations" ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Approved users can delete sole_silk_registrations" ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Approved users can view sole_silk_registrations" ON public.sole_silk_registrations;
CREATE POLICY "Approved users can view sole_silk_registrations" ON public.sole_silk_registrations FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert sole_silk_registrations" ON public.sole_silk_registrations;
CREATE POLICY "Approved users can insert sole_silk_registrations" ON public.sole_silk_registrations FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update sole_silk_registrations" ON public.sole_silk_registrations;
CREATE POLICY "Approved users can update sole_silk_registrations" ON public.sole_silk_registrations FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete sole_silk_registrations" ON public.sole_silk_registrations;
CREATE POLICY "Approved users can delete sole_silk_registrations" ON public.sole_silk_registrations FOR DELETE TO authenticated USING (public.is_approved_user());

-- sole_size_conjugations
DROP POLICY IF EXISTS "Approved users can view sole_size_conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Approved users can insert sole_size_conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Approved users can update sole_size_conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Approved users can delete sole_size_conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Approved users can view sole_size_conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Approved users can view sole_size_conjugations" ON public.sole_size_conjugations FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert sole_size_conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Approved users can insert sole_size_conjugations" ON public.sole_size_conjugations FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update sole_size_conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Approved users can update sole_size_conjugations" ON public.sole_size_conjugations FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete sole_size_conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Approved users can delete sole_size_conjugations" ON public.sole_size_conjugations FOR DELETE TO authenticated USING (public.is_approved_user());

-- sole_standard_items_consumption
DROP POLICY IF EXISTS "Approved users can view sole_standard_items_consumption" ON public.sole_standard_items_consumption;
DROP POLICY IF EXISTS "Approved users can insert sole_standard_items_consumption" ON public.sole_standard_items_consumption;
DROP POLICY IF EXISTS "Approved users can update sole_standard_items_consumption" ON public.sole_standard_items_consumption;
DROP POLICY IF EXISTS "Approved users can delete sole_standard_items_consumption" ON public.sole_standard_items_consumption;
DROP POLICY IF EXISTS "Approved users can view sole_standard_items_consumption" ON public.sole_standard_items_consumption;
CREATE POLICY "Approved users can view sole_standard_items_consumption" ON public.sole_standard_items_consumption FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert sole_standard_items_consumption" ON public.sole_standard_items_consumption;
CREATE POLICY "Approved users can insert sole_standard_items_consumption" ON public.sole_standard_items_consumption FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update sole_standard_items_consumption" ON public.sole_standard_items_consumption;
CREATE POLICY "Approved users can update sole_standard_items_consumption" ON public.sole_standard_items_consumption FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete sole_standard_items_consumption" ON public.sole_standard_items_consumption;
CREATE POLICY "Approved users can delete sole_standard_items_consumption" ON public.sole_standard_items_consumption FOR DELETE TO authenticated USING (public.is_approved_user());

-- technical_sheet_insole_colors
DROP POLICY IF EXISTS "Approved users can view technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
DROP POLICY IF EXISTS "Approved users can view technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
CREATE POLICY "Approved users can view technical_sheet_insole_colors" ON public.technical_sheet_insole_colors FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
CREATE POLICY "Approved users can insert technical_sheet_insole_colors" ON public.technical_sheet_insole_colors FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
CREATE POLICY "Approved users can update technical_sheet_insole_colors" ON public.technical_sheet_insole_colors FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
CREATE POLICY "Approved users can delete technical_sheet_insole_colors" ON public.technical_sheet_insole_colors FOR DELETE TO authenticated USING (public.is_approved_user());

-- technical_sheet_overhead_history
DROP POLICY IF EXISTS "Users can view history of sheets they can access" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can view technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can view technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
CREATE POLICY "Approved users can view technical_sheet_overhead_history" ON public.technical_sheet_overhead_history FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
CREATE POLICY "Approved users can insert technical_sheet_overhead_history" ON public.technical_sheet_overhead_history FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());

-- technical_sheet_palmilha_colors
DROP POLICY IF EXISTS "allow_all_palmilha_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can view technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can view technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
CREATE POLICY "Approved users can view technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
CREATE POLICY "Approved users can insert technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
CREATE POLICY "Approved users can update technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
CREATE POLICY "Approved users can delete technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors FOR DELETE TO authenticated USING (public.is_approved_user());

-- PART 2 — Tables with policies but RLS not enabled
ALTER TABLE public.baus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.box_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_company_rates ENABLE ROW LEVEL SECURITY;

-- baus
DROP POLICY IF EXISTS "Approved users can view baus" ON public.baus;
DROP POLICY IF EXISTS "Approved users can insert baus" ON public.baus;
DROP POLICY IF EXISTS "Approved users can update baus" ON public.baus;
DROP POLICY IF EXISTS "Approved users can delete baus" ON public.baus;
CREATE POLICY "Approved users can view baus" ON public.baus FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert baus" ON public.baus;
CREATE POLICY "Approved users can insert baus" ON public.baus FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update baus" ON public.baus;
CREATE POLICY "Approved users can update baus" ON public.baus FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete baus" ON public.baus;
CREATE POLICY "Approved users can delete baus" ON public.baus FOR DELETE TO authenticated USING (public.is_approved_user());

-- box_types
DROP POLICY IF EXISTS "Approved users can view box_types" ON public.box_types;
DROP POLICY IF EXISTS "Approved users can insert box_types" ON public.box_types;
DROP POLICY IF EXISTS "Approved users can update box_types" ON public.box_types;
DROP POLICY IF EXISTS "Approved users can delete box_types" ON public.box_types;
DROP POLICY IF EXISTS "Approved users can view box_types" ON public.box_types;
CREATE POLICY "Approved users can view box_types" ON public.box_types FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert box_types" ON public.box_types;
CREATE POLICY "Approved users can insert box_types" ON public.box_types FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update box_types" ON public.box_types;
CREATE POLICY "Approved users can update box_types" ON public.box_types FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete box_types" ON public.box_types;
CREATE POLICY "Approved users can delete box_types" ON public.box_types FOR DELETE TO authenticated USING (public.is_approved_user());

-- item_types
DROP POLICY IF EXISTS "Approved users can view item_types" ON public.item_types;
DROP POLICY IF EXISTS "Approved users can insert item_types" ON public.item_types;
DROP POLICY IF EXISTS "Approved users can update item_types" ON public.item_types;
DROP POLICY IF EXISTS "Approved users can delete item_types" ON public.item_types;
DROP POLICY IF EXISTS "Approved users can view item_types" ON public.item_types;
CREATE POLICY "Approved users can view item_types" ON public.item_types FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert item_types" ON public.item_types;
CREATE POLICY "Approved users can insert item_types" ON public.item_types FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update item_types" ON public.item_types;
CREATE POLICY "Approved users can update item_types" ON public.item_types FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete item_types" ON public.item_types;
CREATE POLICY "Approved users can delete item_types" ON public.item_types FOR DELETE TO authenticated USING (public.is_approved_user());

-- transport_companies
DROP POLICY IF EXISTS "Approved users can view transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can insert transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can update transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can delete transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can view transport_companies" ON public.transport_companies;
CREATE POLICY "Approved users can view transport_companies" ON public.transport_companies FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert transport_companies" ON public.transport_companies;
CREATE POLICY "Approved users can insert transport_companies" ON public.transport_companies FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update transport_companies" ON public.transport_companies;
CREATE POLICY "Approved users can update transport_companies" ON public.transport_companies FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete transport_companies" ON public.transport_companies;
CREATE POLICY "Approved users can delete transport_companies" ON public.transport_companies FOR DELETE TO authenticated USING (public.is_approved_user());

-- transport_company_rates
DROP POLICY IF EXISTS "Approved users can view transport_company_rates" ON public.transport_company_rates;
DROP POLICY IF EXISTS "Approved users can insert transport_company_rates" ON public.transport_company_rates;
DROP POLICY IF EXISTS "Approved users can update transport_company_rates" ON public.transport_company_rates;
DROP POLICY IF EXISTS "Approved users can delete transport_company_rates" ON public.transport_company_rates;
DROP POLICY IF EXISTS "Approved users can view transport_company_rates" ON public.transport_company_rates;
CREATE POLICY "Approved users can view transport_company_rates" ON public.transport_company_rates FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can insert transport_company_rates" ON public.transport_company_rates;
CREATE POLICY "Approved users can insert transport_company_rates" ON public.transport_company_rates FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can update transport_company_rates" ON public.transport_company_rates;
CREATE POLICY "Approved users can update transport_company_rates" ON public.transport_company_rates FOR UPDATE TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete transport_company_rates" ON public.transport_company_rates;
CREATE POLICY "Approved users can delete transport_company_rates" ON public.transport_company_rates FOR DELETE TO authenticated USING (public.is_approved_user());
