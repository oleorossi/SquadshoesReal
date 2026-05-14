-- ============================================================================
-- FIX: vazamento de material_reservations em OPs finalizadas
-- ============================================================================
-- Causa-raiz: o único gatilho que liberava reservas na mudança de status da OP
-- (auto_release_reservations_on_op_cancel) checava NEW.status = 'Cancelada' —
-- status que NÃO existe no vocabulário real (os status são 'Reservado',
-- 'Em Produção', 'Finalizado'). Resultado: nenhuma reserva nunca era liberada.
-- Quando uma OP era finalizada sem passar pelo convert_reservation_to_out
-- (linha ~1666 de useSaleOrders.ts), a material_reservations ficava presa em
-- status='reserved' pra sempre, e o reserved_stock (recalculado por
-- sync_product_reserved_stock como SUM filtrado por status='reserved') só subia.
--
-- Auditoria: 16 reservas presas em 16 OPs já 'Finalizado' (~691m de material),
-- afetando EVA 3MM, GLOW METALIC PRATA, NAPA SUDANI NUDE, NAPA SOFT, COLA FORTE.
-- (As outras 33 reservas pertencem a OPs ainda 'Reservado' — legítimas, intactas.)
--
-- Fix em 2 partes:
--   1. PREVENÇÃO — o gatilho passa a reagir aos status terminais REAIS. Quando
--      uma OP entra em 'Finalizado' (ou cancelamento futuro), qualquer reserva
--      ainda 'reserved' é liberada (status='cancelled'). É uma rede de segurança:
--      o fluxo normal deve converter via convert_reservation_to_out ANTES de
--      finalizar; se sobrar reserva, significa que o convert foi pulado — então
--      liberamos o "hold" pra o reserved_stock não mentir. NÃO debita
--      products.quantity (o débito real tem caminho próprio; debitar aqui
--      arriscaria débito duplo).
--   2. LIMPEZA — libera as 16 reservas órfãs já existentes. O gatilho de
--      recompute (tg_material_reservations_sync_reserved) corrige o
--      reserved_stock automaticamente a cada UPDATE.
-- ============================================================================

-- ── Parte 1: prevenção ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_release_reservations_on_op_cancel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Dispara quando a OP entra num status TERMINAL (finalizada ou cancelada).
  -- Antes checava só 'Cancelada' (status inexistente) — por isso nunca rodava.
  IF NEW.status IN ('Finalizado', 'Cancelado', 'Cancelada', 'Concluído', 'Concluido')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.material_reservations
       SET status     = 'cancelled',
           notes      = COALESCE(NULLIF(notes, ''), '')
                        || ' [auto-liberada: OP -> ' || NEW.status || ']',
           updated_at = now()
     WHERE order_id = NEW.id
       AND status IN ('reserved', 'partially_consumed');
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.auto_release_reservations_on_op_cancel() IS
  'Rede de segurança: libera material_reservations ainda "reserved" quando a OP entra em status terminal (Finalizado/Cancelado). O recompute de reserved_stock roda automático via tg_material_reservations_sync_reserved.';

-- ── Parte 2: limpeza das 16 reservas órfãs ──────────────────────────────────
-- Só toca reservas 'reserved' cujas OPs JÁ estão 'Finalizado' (inequivocamente
-- mortas). NÃO toca reservas de OPs ainda 'Reservado'/'Em Produção' (legítimas).
-- NÃO altera products.quantity — se o material foi fisicamente usado sem débito
-- registrado, isso é uma questão histórica separada.
WITH leaked AS (
  SELECT mr.id
  FROM public.material_reservations mr
  JOIN public.orders o ON o.id = mr.order_id
  WHERE mr.status = 'reserved'
    AND o.status = 'Finalizado'
)
UPDATE public.material_reservations mr
   SET status     = 'cancelled',
       notes      = COALESCE(NULLIF(mr.notes, ''), '')
                    || ' [limpeza auditoria: OP finalizada, reserva nunca consumida]',
       updated_at = now()
  FROM leaked
 WHERE mr.id = leaked.id;
