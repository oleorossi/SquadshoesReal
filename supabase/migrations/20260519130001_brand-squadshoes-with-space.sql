-- Muda marca de 'SquadShoes' (sem espaço) → 'Squad Shoes' (com espaço).
--
-- Pedido user 19/05/2026: 'na nota fiscal a parte marca tem que escrever
-- Squad Shoes'. xMarca do XML SEFAZ vinha como "SquadShoes" — contabilidade/
-- destinatários esperam o nome da empresa escrito com espaço.
--
-- Mudanças neste arquivo:
--   1) DEFAULT da coluna sale_orders.brand passa de 'SquadShoes' pra 'Squad Shoes'
--   2) Backfill: todos os PVs hoje em 'SquadShoes' viram 'Squad Shoes'
--      (variantes do user permanecem — só toca rows com a string default)

-- 1) Default novo
ALTER TABLE public.sale_orders
  ALTER COLUMN brand SET DEFAULT 'Squad Shoes';

-- 2) Backfill
UPDATE public.sale_orders
   SET brand = 'Squad Shoes'
 WHERE brand = 'SquadShoes';
