-- =============================================================================
-- Limpa OPs órfãs na production_queue cujo PV já morreu (Cancelado/Faturado).
--
-- Contexto: redesenho da Central (chão vs fila). Fantasmas de PV morto na fila
-- empurram WIP vivo e confundem o Kanban. O vazamento estrutural foi fechado em
-- `20261214120000` (cancelar PV cascateia pra OP → `tg_sync_production_queue`
-- apaga a linha). O backfill pontual das 20 OPs históricas foi
-- `20261216120000`. Esta migration é o varredura idempotente: qualquer órfão
-- residual (ou regressão futura aplicada por SQL Editor) com ZERO progresso de
-- estágio é cancelado — o mesmo critério do dono em 06/08/2026.
--
-- Diagnóstico (MCP, projeto ssvxfoybzmjlypnipqzn, 21/09/2026):
--   production_queue ∩ OP aberta ∩ PV Cancelado/Faturado = 0 linhas
--   Fila viva só tem PV Aprovado / Em Produção (não tocar).
-- O UPDATE abaixo é no-op nesse estado; fica como rede de segurança.
--
-- ⚠ NÃO é DELETE em production_queue. UPDATE pra 'Cancelada' dispara
-- `tg_orders_sync_production_queue` → `tg_sync_production_queue` remove a linha.
--
-- ⚠ NÃO cancela PV Aprovado + na_fila (reservadas legítimas → aba Fila).
-- ⚠ NÃO fabrica Finalizado: gatilho de finalize inventaria quantity_processed.
-- ⚠ Só órfãos com zero progresso em order_stages (espelha 20261216120000).
-- =============================================================================

UPDATE public.orders o
   SET status = 'Cancelada',
       updated_at = now()
  FROM public.sale_orders so
 WHERE so.id = o.sale_order_id
   AND o.deleted_at IS NULL
   AND lower(btrim(COALESCE(o.status, ''))) NOT IN
       ('finalizado', 'cancelada', 'cancelado', 'cancelled', 'faturado',
        'concluído', 'concluido')
   AND lower(btrim(COALESCE(so.status, ''))) IN
       ('cancelado', 'cancelada', 'cancelled', 'faturado')
   AND EXISTS (
         SELECT 1
           FROM public.production_queue pq
          WHERE pq.order_id = o.id
       )
   AND NOT EXISTS (
         SELECT 1
           FROM public.order_stages os
          WHERE os.order_id = o.id
            AND COALESCE(os.quantity_processed, 0) > 0
       );
