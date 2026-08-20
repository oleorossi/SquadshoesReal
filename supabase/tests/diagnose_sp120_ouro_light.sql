WITH refs AS (
  SELECT ts.*
  FROM public.technical_sheets ts
  WHERE upper(btrim(coalesce(ts.code, ''))) = 'SP120'
     OR upper(btrim(ts.name)) = 'SP120'
), relevant_groups AS (
  SELECT pg.*
  FROM public.product_groups pg
  WHERE upper(pg.name) LIKE '%GLOW%METAL%'
     OR upper(pg.name) IN ('NAPA SOFT', 'NAPA SUDANI', 'NAPA MADRID')
), recent_items AS (
  SELECT
    soi.id,
    soi.reference_id,
    soi.material_variant_id,
    soi.color,
    soi.quantity,
    soi.created_at,
    so.order_number,
    so.status AS order_status
  FROM public.sale_order_items soi
  JOIN public.sale_orders so ON so.id = soi.sale_order_id
  WHERE soi.reference_id IN (SELECT id FROM refs)
  ORDER BY soi.created_at DESC
  LIMIT 20
)
SELECT jsonb_pretty(jsonb_build_object(
  'technical_sheets', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'name', r.name,
      'upper_material', r.upper_material,
      'upper_material_group_id', r.upper_material_group_id,
      'upper_material_product_id', r.upper_material_product_id,
      'variant_drives_upper', r.variant_drives_upper,
      'variant_drives_lining', r.variant_drives_lining,
      'colors', r.colors,
      'status', r.status,
      'status_ficha', r.status_ficha
    )) FROM refs r
  ), '[]'::jsonb),
  'material_variants', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', v.id,
      'reference_id', v.reference_id,
      'material_name', v.material_name,
      'sku', v.sku,
      'active', v.active,
      'main_material_group_id', v.main_material_group_id,
      'main_material_group', mg.name,
      'upper_material_group_id', v.upper_material_group_id,
      'upper_material_group', ug.name,
      'upper_material_product_id', v.upper_material_product_id,
      'upper_material_product', up.name,
      'upper_material_product_color', up.color
    ) ORDER BY v.display_order)
    FROM public.reference_material_variants v
    LEFT JOIN public.product_groups mg ON mg.id = v.main_material_group_id
    LEFT JOIN public.product_groups ug ON ug.id = v.upper_material_group_id
    LEFT JOIN public.products up ON up.id = v.upper_material_product_id
    WHERE v.reference_id IN (SELECT id FROM refs)
  ), '[]'::jsonb),
  'relevant_groups', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'sector', g.sector,
      'active_products', (
        SELECT count(*) FROM public.products p WHERE p.group_id = g.id AND p.active
      )
    ) ORDER BY g.name) FROM relevant_groups g
  ), '[]'::jsonb),
  'gold_products', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'group_id', p.group_id,
      'group', pg.name,
      'name', p.name,
      'sku', p.sku,
      'color', p.color,
      'active', p.active,
      'category', p.category
    ) ORDER BY pg.name, p.name)
    FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id = p.group_id
    WHERE p.group_id IN (SELECT id FROM relevant_groups)
       OR upper(coalesce(p.color, '')) LIKE '%OURO%LIGHT%'
       OR upper(p.name) LIKE '%OURO%LIGHT%'
  ), '[]'::jsonb),
  'recent_sp120_items', coalesce((
    SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at DESC) FROM recent_items i
  ), '[]'::jsonb)
)) AS diagnostico;
