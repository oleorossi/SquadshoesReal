-- 1. Remover dependências e a função
DROP VIEW IF EXISTS public.v_mrp_needs;
DROP FUNCTION IF EXISTS public.fn_projected_demand() CASCADE;

-- 2. Recriar a função com o tipo de retorno correto (date)
CREATE OR REPLACE FUNCTION public.fn_projected_demand()
RETURNS TABLE (
  product_id       uuid,
  product_name     text,
  total_required   numeric,
  earliest_deadline date,
  orders_count     integer,
  order_ids        uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT
      so.id AS sale_order_id,
      so.delivery_deadline,
      soi.id AS sale_order_item_id,
      (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
         FROM public.calculate_order_consumption(
           soi.reference_id, soi.quantity, COALESCE(soi.color,''),
           (SELECT (key)::integer FROM jsonb_each_text(soi.grade)
              WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
         ) c) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE LOWER(COALESCE(so.status, '')) NOT IN (
            'cancelado', 'cancelada', 'cancelled',
            'entregue', 'delivered',
            'finalizado', 'finalizada', 'finished', 'completed',
            'faturado', 'faturada', 'invoiced'
          )
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT
      sale_order_id,
      delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')      AS product_name,
      (line ->> 'required')::numeric AS required
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  )
  SELECT
    e.product_id,
    MAX(e.product_name) AS product_name,
    SUM(e.required)     AS total_required,
    MIN(e.delivery_deadline) AS earliest_deadline,
    COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
    array_agg(DISTINCT e.sale_order_id) AS order_ids
  FROM exploded e
  WHERE e.product_id IS NOT NULL
  GROUP BY e.product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_projected_demand() TO authenticated;

-- 3. Recriar a view v_mrp_needs
DROP VIEW IF EXISTS public.v_mrp_needs CASCADE;
CREATE OR REPLACE VIEW public.v_mrp_needs AS
SELECT
    pd.product_id,
    pd.product_name,
    pd.total_required,
    p.quantity AS current_stock,
    (pd.total_required - COALESCE(p.quantity, 0)) AS balance,
    pd.earliest_deadline,
    pd.orders_count,
    pd.order_ids
FROM public.fn_projected_demand() pd
LEFT JOIN public.products p ON p.id = pd.product_id;