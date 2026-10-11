-- Integração Estoque ↔ PV ↔ Compras — ajuste da etapa 1
-- Spec: specs/integracao-estoque-pv-compras.md
--
-- PV EXCLUÍDO (sale_orders.deleted_at) ou CANCELADO não é demanda: suas
-- reservas abertas ficam fora do motor de empenho/falta. Sem isso, a falta
-- desses PVs disputava a quitação da próxima entrada com os PVs reais.
--
-- Decisão do dono (11/10/2026): só esta parte. As reservas abertas dos PVs
-- excluídos NÃO são canceladas aqui — continuam empenhando o que empenham
-- (contam como "fixas" na realocação); só a falta delas é zerada.

CREATE OR REPLACE FUNCTION public.material_reservation_is_pv_managed(
  mr public.material_reservations
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT mr.status IN ('reserved', 'partially_consumed')
     AND COALESCE(mr.reservation_type, 'soft') = 'soft'
     AND COALESCE(mr.metadata ->> 'kind', 'component')
           IN ('pv_commitment', 'component', 'atelier_prep', 'sole_grade')
     AND mr.strap_variant_id IS NULL
     AND mr.sale_order_strap_demand_id IS NULL
     AND mr.strap_stock_floor_contribution_id IS NULL
     AND mr.strap_batch_item_id IS NULL
     AND mr.service_order_item_id IS NULL
     AND mr.base_product_id IS NULL
     AND mr.finished_product_id IS NULL
     AND mr.dublagem_demand_id IS NULL
     AND COALESCE(mr.source, '') NOT IN (
           'strap_engine_finished', 'strap_engine_base', 'strap_demand'
         )
     -- PV excluído ou cancelado não é demanda (nem pela OP, nem direto)
     AND NOT EXISTS (
           SELECT 1
             FROM public.sale_orders so
            WHERE so.id = COALESCE(
                    mr.sale_order_id,
                    (SELECT o.sale_order_id FROM public.orders o WHERE o.id = mr.order_id)
                  )
              AND (so.deleted_at IS NOT NULL OR so.status = 'Cancelado')
         );
$$;

-- Zera a falta já registrada desses PVs (o empenho fica como está).
UPDATE public.material_reservations mr
   SET quantity_short = 0,
       metadata = CASE
         WHEN COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'
           THEN COALESCE(mr.metadata, '{}'::jsonb) || jsonb_build_object('shortage_grade', '{}'::jsonb)
         ELSE mr.metadata
       END,
       updated_at = now()
  FROM public.sale_orders so
 WHERE mr.status IN ('reserved', 'partially_consumed')
   AND mr.quantity_short > 0
   AND so.id = COALESCE(
         mr.sale_order_id,
         (SELECT o.sale_order_id FROM public.orders o WHERE o.id = mr.order_id)
       )
   AND (so.deleted_at IS NOT NULL OR so.status = 'Cancelado');
