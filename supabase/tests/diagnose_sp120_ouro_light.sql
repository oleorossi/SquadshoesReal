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
  'a_technical_sheets', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'name', r.name,
      'upper_material', r.upper_material,
      'upper_material_group_id', r.upper_material_group_id,
      'upper_material_product_id', r.upper_material_product_id,
      'has_straps', r.has_straps,
      'strap_colors', r.strap_colors,
      'lining_material', r.lining_material,
      'lining_accessories', r.lining_accessories,
      'insole_material', r.insole_material,
      'variant_drives_upper', r.variant_drives_upper,
      'variant_drives_lining', r.variant_drives_lining,
      'colors', r.colors,
      'status', r.status,
      'status_ficha', r.status_ficha
    )) FROM refs r
  ), '[]'::jsonb),
  'b_material_variants', coalesce((
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
  'b2_sheet_materials', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', sm.id,
      'part_name', sm.part_name,
      'sector', sm.sector,
      'group_id', coalesce(sm.group_id, p.group_id),
      'group', pg.name,
      'product_id', sm.product_id,
      'product', p.name,
      'product_color', p.color,
      'quantity_per_unit', sm.quantity_per_unit,
      'material_variant_id', sm.material_variant_id
    ) ORDER BY sm.sector, sm.part_name)
    FROM public.sheet_materials sm
    LEFT JOIN public.products p ON p.id = sm.product_id
    LEFT JOIN public.product_groups pg ON pg.id = coalesce(sm.group_id, p.group_id)
    WHERE sm.sheet_id IN (SELECT id FROM refs)
  ), '[]'::jsonb),
  'b3_other_glow_variants', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'sheet', ts.name,
      'sheet_id', ts.id,
      'variant_id', v.id,
      'material_name', v.material_name,
      'sku', v.sku,
      'active', v.active,
      'main_material_group_id', v.main_material_group_id,
      'upper_material_group_id', v.upper_material_group_id,
      'lining_material_group_id', v.lining_material_group_id,
      'variant_drives_upper', ts.variant_drives_upper,
      'variant_drives_lining', ts.variant_drives_lining
    ) ORDER BY ts.name, v.display_order)
    FROM public.reference_material_variants v
    JOIN public.technical_sheets ts ON ts.id = v.reference_id
    JOIN public.product_groups g ON g.id = coalesce(v.main_material_group_id, v.upper_material_group_id, v.lining_material_group_id)
    WHERE upper(g.name) LIKE '%GLOW%METAL%'
  ), '[]'::jsonb),
  'c_relevant_groups', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'sector', g.sector,
      'active_products', (
        SELECT count(*) FROM public.products p WHERE p.group_id = g.id AND p.active
      )
    ) ORDER BY g.name) FROM relevant_groups g
  ), '[]'::jsonb),
  'd_gold_products', coalesce((
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
    WHERE (p.group_id IN (
             SELECT id FROM relevant_groups WHERE upper(name) LIKE '%GLOW%METAL%'
           ))
       OR upper(coalesce(p.color, '')) LIKE '%OURO%LIGHT%'
       OR upper(p.name) LIKE '%OURO%LIGHT%'
  ), '[]'::jsonb),
  'e_recent_sp120_items', coalesce((
    SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at DESC) FROM recent_items i
  ), '[]'::jsonb),
  'f_wrong_sudani_gold_usage', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'sku', p.sku,
      'name', p.name,
      'color', p.color,
      'active', p.active,
      'quantity', p.quantity,
      'reserved_stock', p.reserved_stock,
      'stock_movements', (SELECT count(*) FROM public.stock_movements sm WHERE sm.product_id = p.id),
      'reservations', (SELECT count(*) FROM public.material_reservations mr WHERE mr.product_id = p.id),
      'open_reservations', (SELECT count(*) FROM public.material_reservations mr WHERE mr.product_id = p.id AND mr.status IN ('reserved', 'partially_consumed')),
      'purchase_items', (SELECT count(*) FROM public.purchase_order_items poi WHERE poi.product_id = p.id),
      'bom_lines', (SELECT count(*) FROM public.sheet_materials sm WHERE sm.product_id = p.id),
      'variant_pins', (SELECT count(*) FROM public.reference_material_variants v WHERE v.upper_material_product_id = p.id OR v.lining_material_product_id = p.id OR v.insole_material_product_id = p.id)
    ))
    FROM public.products p
    WHERE p.sku = 'NAPA-SUDANI-OURO-LIGHT'
  ), '[]'::jsonb)
)) AS diagnostico;
