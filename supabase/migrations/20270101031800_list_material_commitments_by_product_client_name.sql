-- Lista de reservas por produto na UI de estoque: precisa do cliente na linha do PV.
-- Extende list_material_commitments_by_product com client_name (sale_orders.client_name).
-- DROP obrigatório: mudar OUT params muda o tipo de retorno (42P13).

DROP FUNCTION IF EXISTS public.list_material_commitments_by_product(uuid);

CREATE OR REPLACE FUNCTION public.list_material_commitments_by_product(p_product_id uuid)
RETURNS TABLE (
  reservation_id uuid,
  sale_order_id uuid,
  sale_order_number text,
  client_name text,
  quantity_reserved numeric,
  quantity_consumed numeric,
  open_qty numeric,
  status text,
  kind text,
  order_id uuid,
  order_number text,
  priority_score numeric,
  billing_week text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mr.id,
         mr.sale_order_id,
         so.order_number,
         so.client_name,
         mr.quantity_reserved,
         COALESCE(mr.quantity_consumed, 0),
         mr.quantity_reserved - COALESCE(mr.quantity_consumed, 0),
         mr.status,
         COALESCE(mr.metadata ->> 'kind', 'component'),
         mr.order_id,
         o.order_number,
         CASE WHEN mr.sale_order_id IS NOT NULL
              THEN public.commitment_cover_priority(mr.sale_order_id)
              ELSE NULL END,
         so.billing_week
    FROM public.material_reservations mr
    LEFT JOIN public.sale_orders so ON so.id = mr.sale_order_id
    LEFT JOIN public.orders o ON o.id = mr.order_id
   WHERE mr.product_id = p_product_id
     AND mr.status IN ('reserved', 'partially_consumed')
   ORDER BY
     CASE WHEN mr.sale_order_id IS NOT NULL
          THEN public.commitment_cover_priority(mr.sale_order_id)
          ELSE 9000000000 END,
     mr.created_at;
$$;

GRANT EXECUTE ON FUNCTION public.list_material_commitments_by_product(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_material_commitments_by_product(uuid) IS
  'Reservas abertas (reserved/partially_consumed) de um produto, com PV/cliente/OP para a UI de estoque.';
