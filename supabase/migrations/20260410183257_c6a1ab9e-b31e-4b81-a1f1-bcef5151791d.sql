-- Add missing columns to support the view if they don't exist
ALTER TABLE public.sale_order_items ADD COLUMN IF NOT EXISTS item_size INTEGER;
ALTER TABLE public.sole_technical_specs ADD COLUMN IF NOT EXISTS consumption NUMERIC DEFAULT 0;

-- Create the view adapted to the current database schema
CREATE OR REPLACE VIEW public.report_material_needs_by_group AS
SELECT 
    mg.name AS group_name,
    m.name AS material_name,
    m.current_stock AS current_stock,
    SUM(oi.quantity * COALESCE(specs.consumption, 1)) AS total_needed,
    (SUM(oi.quantity * COALESCE(specs.consumption, 1)) - m.current_stock) AS missing_qty,
    m.unit AS unit
FROM public.sale_order_items oi
JOIN public.orders o ON o.id = oi.sale_order_id
JOIN public.technical_sheets ts ON ts.id = oi.reference_id
LEFT JOIN public.sole_technical_specs specs ON specs.sole_id = ts.sole_group_id AND specs.size = oi.item_size
LEFT JOIN public.bill_of_materials bom ON bom.master_id = ts.id
JOIN public.products m ON m.id = bom.material_id -- Joining materials from BOM
JOIN public.product_groups mg ON mg.id = m.group_id -- Getting material group
WHERE o.status = 'confirmed' -- Adapting oi.status to o.status
GROUP BY mg.name, m.name, m.current_stock, m.unit
HAVING (SUM(oi.quantity * COALESCE(specs.consumption, 1)) - m.current_stock) > 0;
