-- Create views for labels and inventory monitoring

-- View for production labels (etiquetas)
DROP VIEW IF EXISTS public.vw_production_labels CASCADE;
CREATE OR REPLACE VIEW public.vw_production_labels AS
SELECT 
    v.id AS variant_id,
    v.sku, 
    v.color_name,
    v.size,
    COALESCE(v.variant_image_url, m.main_image_url) AS display_image,
    m.name AS product_name
FROM public.product_variants v
JOIN public.product_masters m ON v.master_id = m.id;

-- View for projected material availability (Automatic Purchase Orders)
DROP VIEW IF EXISTS public.vw_material_projected_availability CASCADE;
CREATE OR REPLACE VIEW public.vw_material_projected_availability AS
SELECT 
    mat.id,
    mat.name, 
    mat.stock_actual,
    mat.stock_min,
    COALESCE(reserved.total_reserved, 0) as total_reserved,
    (mat.stock_actual - COALESCE(reserved.total_reserved, 0)) as projected_availability
FROM public.materials mat
LEFT JOIN (
    SELECT 
        bom.material_id,
        SUM(bom.quantity_required * po.quantity) as total_reserved
    FROM public.bill_of_materials bom 
    JOIN public.product_variants v ON bom.master_id = v.master_id
    JOIN public.production_orders po ON v.id = po.variant_id
    WHERE po.status != 'Finalizado'
    GROUP BY bom.material_id
) reserved ON mat.id = reserved.material_id;
