-- Marca dos produtos do pedido — vai pro xMarca do XML SEFAZ.
-- Default 'SquadShoes' (fábrica só produzia marca própria até 15/05/2026),
-- mas agora editável por PV pra atender private label/OEM.
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'SquadShoes';

COMMENT ON COLUMN public.sale_orders.brand IS
  'Marca dos produtos. Vai pro xMarca do XML SEFAZ via emit-nfe. Default SquadShoes — editável no PV pra private label/OEM.';
