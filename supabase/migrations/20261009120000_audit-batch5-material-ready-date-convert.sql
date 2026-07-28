-- Batch 5-SQL (tema T2): compute_material_ready_date convertia dm² cru contra
-- estoque físico → falta falsa ~100× empurrava a data de prontidão do material.
-- JÁ APLICADA via MCP. O corpo completo está no MCP; aqui fica o registro.
-- Fix: no 2º loop, needed é dividido por dm2_per_unit (get_material_conversion_info,
-- largura da ficha), igual get_wave_material_needs_core. ÷1 quando não-área.
-- (Função recriada por completo via apply_migration audit_batch5_material_ready_date_convert_area.)
SELECT 'compute_material_ready_date convertida — ver função viva no banco' AS nota;
