-- ---------------------------------------------------------------
-- 20260504150000_normalize-mrp-status-filter.sql
--
-- Corrige `fn_projected_demand()` para filtrar status de pedido
-- de forma case-insensitive.
--
-- Bug:
--   WHERE so.status NOT IN ('Cancelado', 'Entregue', 'Finalizado', 'Faturado')
--
-- Se uma migração futura ou import de dados gravar status em
-- minúsculas (`'cancelado'`, `'entregue'`) ou em UPPERCASE, o
-- filtro NÃO exclui esses pedidos, e o MRP soma demanda de
-- pedidos já finalizados/cancelados na projeção. Resultado:
-- compra excessiva de matéria-prima.
--
-- Esta migration usa `LOWER()` em ambos os lados do IN para
-- absorver qualquer variação de capitalização.
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_projected_demand()
RETURNS TABLE (
  product_id uuid,
  product_name text,
  total_required numeric,
  earliest_deadline date,
  orders_count integer,
  order_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
           (SELECT key::integer FROM jsonb_each_text(soi.grade)
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
