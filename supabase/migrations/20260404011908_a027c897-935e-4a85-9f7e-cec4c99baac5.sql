
-- Fix views
DROP VIEW IF EXISTS public.vw_production_labels CASCADE;
CREATE OR REPLACE VIEW public.vw_production_labels
WITH (security_invoker = true)
AS
SELECT v.id AS variant_id, v.sku, v.color_name, v.size,
    COALESCE(v.variant_image_url, m.main_image_url) AS display_image,
    m.name AS product_name
FROM product_variants v JOIN product_masters m ON v.master_id = m.id;

DROP VIEW IF EXISTS public.vw_material_projected_availability CASCADE;
CREATE OR REPLACE VIEW public.vw_material_projected_availability
WITH (security_invoker = true)
AS
SELECT mat.id, mat.name, mat.stock_actual, mat.stock_min,
    COALESCE(reserved.total_reserved, 0::numeric) AS total_reserved,
    mat.stock_actual - COALESCE(reserved.total_reserved, 0::numeric) AS projected_availability
FROM materials mat
LEFT JOIN (
    SELECT bom.material_id, sum(bom.quantity_required * po.quantity::numeric) AS total_reserved
    FROM bill_of_materials bom
    JOIN product_variants v ON bom.master_id = v.master_id
    JOIN production_orders po ON v.id = po.variant_id
    WHERE po.status::text <> 'Finalizado'::text
    GROUP BY bom.material_id
) reserved ON mat.id = reserved.material_id;

-- Fix function search_path
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.finalize_production_sector(uuid, text) SET search_path = public;
ALTER FUNCTION public.hybrid_debit_stock_for_order(uuid, integer, text, uuid) SET search_path = public;
ALTER FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid) SET search_path = public;
