-- pv_commitment grava material_reservations com sale_order_id e order_id NULL
-- (mig 20270101030600). O CHECK material_reservations_origin_ck (28000) só
-- aceitava order_id OU exatamente um de
-- (sale_order_strap_demand_id, strap_stock_floor_contribution_id, dublagem_demand_id).
-- Confirm/promote do PV estourava 23514 e a fila de materialização falhava.
-- sale_order_id passa a ser origem válida do comprometimento de PV.

ALTER TABLE public.material_reservations
  DROP CONSTRAINT IF EXISTS material_reservations_origin_ck;

ALTER TABLE public.material_reservations
  ADD CONSTRAINT material_reservations_origin_ck CHECK (
    (order_id IS NOT NULL)
    OR (sale_order_id IS NOT NULL)
    OR (
      num_nonnulls(
        sale_order_strap_demand_id,
        strap_stock_floor_contribution_id,
        dublagem_demand_id
      ) = 1
    )
  );

COMMENT ON CONSTRAINT material_reservations_origin_ck ON public.material_reservations IS
  'Origem: OP (order_id), comprometimento de PV (sale_order_id), ou exatamente um vínculo de tira/dublagem.';
