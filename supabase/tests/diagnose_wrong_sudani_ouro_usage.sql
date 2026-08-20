SELECT
  p.id,
  p.sku,
  p.name,
  p.color,
  p.active,
  p.quantity,
  p.reserved_stock,
  (SELECT count(*) FROM public.stock_movements sm WHERE sm.product_id = p.id) AS stock_movements,
  (SELECT count(*) FROM public.material_reservations mr WHERE mr.product_id = p.id) AS reservations,
  (SELECT count(*) FROM public.material_reservations mr WHERE mr.product_id = p.id AND mr.status IN ('reserved', 'partially_consumed')) AS open_reservations,
  (SELECT count(*) FROM public.purchase_order_items poi WHERE poi.product_id = p.id) AS purchase_items,
  (SELECT count(*) FROM public.sheet_materials sm WHERE sm.product_id = p.id) AS bom_lines,
  (SELECT count(*) FROM public.reference_material_variants v WHERE v.upper_material_product_id = p.id OR v.lining_material_product_id = p.id OR v.insole_material_product_id = p.id) AS variant_pins
FROM public.products p
WHERE p.sku = 'NAPA-SUDANI-OURO-LIGHT';
