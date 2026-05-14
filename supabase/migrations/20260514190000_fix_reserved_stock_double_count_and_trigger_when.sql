-- ============================================================================
-- FIX: dois bugs achados no pedido teste do gatilho de reservas
-- ============================================================================
-- PROBLEMA #1 — reserved_stock contado em dobro:
--   Existem 4 triggers em material_reservations. 1 é recompute idempotente
--   (tg_sync_reserved_stock -> tg_material_reservations_sync_reserved, faz
--   reserved_stock = SUM(...)). Os outros 3 (trg_sync_reserved_stock_on_
--   insert/update/delete) são estilo DELTA (reserved_stock += delta). Os dois
--   estilos disparam nos MESMOS eventos: no INSERT o recompute seta =10 e o
--   delta soma +10 -> 20. Teste comprovou: reserva de 10 -> reserved_stock 20.
--   Fix: dropar os 3 triggers/funções delta. O recompute sozinho é correto,
--   idempotente e cobre INSERT/UPDATE/DELETE.
--
-- PROBLEMA #2 — gatilho de liberação não dispara em OP finalizada:
--   O trigger trg_auto_release_reservations_on_op_cancel tinha um WHEN clause
--   PRÓPRIO (no nível do trigger, não da função): WHEN (new.status='Cancelada').
--   A migration anterior (20260514180000) corrigiu só o corpo da FUNÇÃO — o
--   WHEN do trigger continuou filtrando 'Cancelada' (status inexistente), então
--   a função nunca era chamada pra 'Finalizado'. Teste comprovou: OP ->
--   Finalizado, reserva continuou 'reserved'.
--   Fix: recriar o trigger sem o WHEN errado (a função já faz o check de status
--   internamente).
-- ============================================================================

-- ── Problema #1: remove os 3 triggers/funções delta redundantes ─────────────
DROP TRIGGER IF EXISTS trg_sync_reserved_stock_on_insert ON public.material_reservations;
DROP TRIGGER IF EXISTS trg_sync_reserved_stock_on_update ON public.material_reservations;
DROP TRIGGER IF EXISTS trg_sync_reserved_stock_on_delete ON public.material_reservations;
DROP FUNCTION IF EXISTS public.tg_sync_reserved_stock_on_insert();
DROP FUNCTION IF EXISTS public.tg_sync_reserved_stock_on_update();
DROP FUNCTION IF EXISTS public.tg_sync_reserved_stock_on_delete();
-- Sobra só tg_sync_reserved_stock (recompute idempotente) — o correto.

-- ── Problema #2: recria o trigger com WHEN correto ──────────────────────────
DROP TRIGGER IF EXISTS trg_auto_release_reservations_on_op_cancel ON public.orders;
CREATE TRIGGER trg_auto_release_reservations_on_op_cancel
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.status IN ('Finalizado','Cancelado','Cancelada','Concluído','Concluido')
    AND NEW.status IS DISTINCT FROM OLD.status
  )
  EXECUTE FUNCTION public.auto_release_reservations_on_op_cancel();

-- ── Resync geral: corrige reserved_stock inflado pelo duplo-count ───────────
-- Recalcula do zero pra TODOS os produtos a partir da fonte autoritativa.
UPDATE public.products p
   SET reserved_stock = GREATEST(0, COALESCE(sub.total, 0)),
       updated_at = now()
  FROM (
    SELECT product_id, SUM(quantity_reserved - COALESCE(quantity_consumed,0)) AS total
      FROM public.material_reservations
     WHERE status = 'reserved'
     GROUP BY product_id
  ) sub
 WHERE p.id = sub.product_id
   AND p.reserved_stock IS DISTINCT FROM GREATEST(0, COALESCE(sub.total,0));

-- Zera produtos sem nenhuma reserva ativa que ainda tenham reserved_stock <> 0
UPDATE public.products p
   SET reserved_stock = 0, updated_at = now()
 WHERE COALESCE(p.reserved_stock,0) <> 0
   AND NOT EXISTS (
     SELECT 1 FROM public.material_reservations mr
      WHERE mr.product_id = p.id AND mr.status = 'reserved'
   );
