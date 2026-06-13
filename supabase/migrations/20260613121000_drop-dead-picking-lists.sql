-- ============================================================
-- Remove a 4ª modelagem MORTA de picking: picking_lists / picking_list_items
-- ============================================================
-- O hook usePickingLists.ts (useCreatePickingList/useUpdatePickingStatus) e
-- estas tabelas nunca foram consumidos por nenhum componente — só apareciam
-- em types.ts (tipos gerados). Confirmado 0 linhas em ambas as tabelas no
-- banco de produção antes do drop. O fluxo real de picking vive em
-- picking_sessions/picking_items (execução, agora com baixa de estoque) e em
-- PickingListPage (planejamento/BOM). Manter um terceiro modelo morto só
-- confunde quem lê o código e infla o schema.
--
-- Dependências removidas junto:
--   - trigger trg_cancel_picking_lists_on_order_cancel ON orders
--   - função cancel_picking_lists_on_order_cancel() (migration 20260527230000)

DROP TRIGGER IF EXISTS trg_cancel_picking_lists_on_order_cancel ON public.orders;
DROP FUNCTION IF EXISTS public.cancel_picking_lists_on_order_cancel() CASCADE;

-- picking_list_items tem FK pra picking_lists; dropar items primeiro.
DROP TABLE IF EXISTS public.picking_list_items CASCADE;
DROP TABLE IF EXISTS public.picking_lists CASCADE;
