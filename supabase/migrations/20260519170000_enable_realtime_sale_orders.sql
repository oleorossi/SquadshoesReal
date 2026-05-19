-- Habilita Supabase Realtime em sale_orders + sale_order_items.
--
-- Sem realtime, cada user trabalhava em cache local stale (React Query).
-- Quando A alterava/deletava PV-X, B só via depois de F5 ou polling — daí
-- o sintoma "PV some pra outro user sem aviso".
--
-- Com REPLICA IDENTITY FULL: UPDATE/DELETE incluem o row completo no payload
-- WAL, permitindo o front-end discriminar/processar corretamente.
--
-- ADD TABLE ao supabase_realtime: tabela passa a publicar mudanças via WS.
-- Hook useRealtimeSaleOrders (frontend) escuta INSERT/UPDATE/DELETE e invalida
-- queries ['sale_order*'] do React Query → todos os users veem em ~200ms.
--
-- Aplicada via MCP em 19/05/2026.

ALTER TABLE public.sale_orders REPLICA IDENTITY FULL;
ALTER TABLE public.sale_order_items REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.sale_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sale_order_items;
