SELECT
  po.id,
  po.order_number,
  po.status,
  po.approval_status,
  po.created_at,
  poi.id AS item_id,
  poi.quantity,
  poi.received_quantity,
  poi.received_at,
  poi.unit,
  poi.unit_price
FROM public.purchase_order_items poi
JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
JOIN public.products p ON p.id = poi.product_id
WHERE p.sku = 'NAPA-SUDANI-OURO-LIGHT'
ORDER BY po.created_at DESC;
