-- Fix #2 (auditoria 2026-06-06): calculate_order_consumption devolve, p/ o mesmo material
-- de área, linhas em DUAS unidades: BOM cru em dm² (unit NULL) e ficha já convertida em
-- metros (unit='m'). fn_projected_demand dividia o SUM INTEIRO por dm2_per_unit → as linhas
-- já em metros encolhiam ~137×, subcontando a demanda. Agora divide SÓ as linhas dm² cru.
CREATE OR REPLACE FUNCTION public.fn_projected_demand()
 RETURNS TABLE(product_id uuid, product_name text, total_required numeric, earliest_deadline date, orders_count integer, order_ids uuid[])
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT so.id AS sale_order_id, so.delivery_deadline, soi.id AS sale_order_item_id,
      COALESCE(public.calculate_order_consumption(
        soi.reference_id, soi.quantity, COALESCE(soi.color, ''),
        (SELECT key::integer FROM jsonb_each_text(soi.grade) WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
      ), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE so.status NOT IN ('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado')
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT sale_order_id, delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name') AS product_name,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit') AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  )
  SELECT
    e.product_id,
    MAX(e.product_name) AS product_name,
    COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL), 0)
      / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(e.product_id) conv LIMIT 1), 1), 1)
    + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL), 0) AS total_required,
    MIN(e.delivery_deadline) AS earliest_deadline,
    COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
    array_agg(DISTINCT e.sale_order_id) AS order_ids
  FROM exploded e
  WHERE e.product_id IS NOT NULL
  GROUP BY e.product_id;
END;
$function$;
