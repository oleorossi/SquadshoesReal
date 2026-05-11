-- =============================================================================
-- AUDIT FLUXO COMPLETO — Fixes críticos de reserva de estoque
-- =============================================================================
-- Cobre:
--   🔴 C3 — Backfill round 23 (20260610120000:6-16) usou filter `status='active'`
--         que não existe (real é 'reserved'/'partially_consumed') → zerou
--         reserved_stock de todos produtos com drift. Re-aplica backfill correto.
--   🔴 C2 — `DELETE FROM material_reservations` em 8 funções vaza reserved_stock
--         (trigger AFTER INSERT do round 6 não cobre DELETE). Adiciona trigger
--         BEFORE DELETE defensivo que decrementa reserved_stock antes do delete.
--         Funciona mesmo sem refactor das funções legacy (próxima fase).
--   🔴 C4 — Duplo decremento em sole+grade no hybrid_debit_stock_for_order: ao
--         passar pra `sole_deferred_to_grade`, INSERT em material_reservations
--         (trigger +reserved_stock) + debit_sole_stock_by_grade decrementa
--         products.quantity SEM decrementar reserved_stock. Reserved_stock fica
--         inflado. Fix: trigger BEFORE UPDATE em material_reservations que ao
--         mudar status pra 'consumed' decrementa reserved_stock proporcional.
-- =============================================================================

-- ─── FIX C3: ressync reserved_stock com filtro CORRETO ──────────────────────
WITH active_reservations AS (
  SELECT product_id,
         SUM(quantity_reserved - COALESCE(quantity_consumed, 0)) AS active_qty
    FROM public.material_reservations
   WHERE status IN ('reserved', 'partially_consumed')
     AND product_id IS NOT NULL
   GROUP BY product_id
),
sync AS (
  -- Produtos com reservas ativas: alinha reserved_stock com soma real.
  SELECT p.id AS product_id,
         GREATEST(0, ar.active_qty) AS new_reserved
    FROM public.products p
    JOIN active_reservations ar ON ar.product_id = p.id
  UNION ALL
  -- Produtos sem reservas ativas mas com reserved_stock > 0 (drift histórico): zera.
  SELECT p.id, 0
    FROM public.products p
   WHERE COALESCE(p.reserved_stock, 0) > 0
     AND NOT EXISTS (
       SELECT 1 FROM active_reservations ar WHERE ar.product_id = p.id
     )
)
UPDATE public.products p
   SET reserved_stock = s.new_reserved,
       updated_at     = now()
  FROM sync s
 WHERE p.id = s.product_id
   AND COALESCE(p.reserved_stock, 0) <> s.new_reserved;


-- ─── FIX C2: trigger BEFORE DELETE em material_reservations ─────────────────
-- Defensivo: cobre as 8 funções que fazem DELETE direto sem refatorar todas
-- (resync_op_atomic, etc). Só decrementa quando status é ATIVO (reserved/
-- partially_consumed) — se já foi cancelled/consumed, reserved_stock já foi
-- ajustado, então não double-decremente.
CREATE OR REPLACE FUNCTION public.tg_sync_reserved_stock_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_delta numeric;
BEGIN
  IF OLD.status NOT IN ('reserved', 'partially_consumed') THEN
    RETURN OLD;
  END IF;
  v_delta := COALESCE(OLD.quantity_reserved, 0) - COALESCE(OLD.quantity_consumed, 0);
  IF v_delta > 0 AND OLD.product_id IS NOT NULL THEN
    UPDATE public.products
       SET reserved_stock = GREATEST(0, COALESCE(reserved_stock, 0) - v_delta),
           updated_at     = now()
     WHERE id = OLD.product_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_reserved_stock_on_delete ON public.material_reservations;
CREATE TRIGGER trg_sync_reserved_stock_on_delete
  BEFORE DELETE ON public.material_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_reserved_stock_on_delete();


-- ─── FIX C4: trigger AFTER UPDATE em material_reservations ──────────────────
-- Decrementa reserved_stock quando uma reserva passa de ATIVA pra CONSUMED ou
-- CANCELLED via UPDATE direto (sem passar pelas funções release/debit). Hoje:
--   - release_order_reservations: já decrementa manualmente ANTES do UPDATE
--     → quando o trigger rodar, OLD.status já tá pra cancelled? NÃO. O UPDATE
--     vem depois. Precisa proteger contra duplo: a função poderia setar uma
--     session variable, mas pra evitar acoplamento, comparamos quantity_consumed:
--     se quantity_consumed AUMENTOU, é o caso "consumed legítimo" → decrementa
--     o delta. Status change pra cancelled SEM consume change: também decrementa.
-- IMPORTANTE: tg_sync_reserved_stock_on_insert (round 6) cobre INSERT só com
-- status ativo. Aqui cobrimos transição ativo→inativo.
CREATE OR REPLACE FUNCTION public.tg_sync_reserved_stock_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_active numeric;
  v_new_active numeric;
  v_delta      numeric;
BEGIN
  -- Saldo "ativo" antes e depois (= quantity_reserved - quantity_consumed),
  -- mas só conta se o status estiver ativo.
  v_old_active := CASE WHEN OLD.status IN ('reserved', 'partially_consumed')
                       THEN COALESCE(OLD.quantity_reserved, 0) - COALESCE(OLD.quantity_consumed, 0)
                       ELSE 0 END;
  v_new_active := CASE WHEN NEW.status IN ('reserved', 'partially_consumed')
                       THEN COALESCE(NEW.quantity_reserved, 0) - COALESCE(NEW.quantity_consumed, 0)
                       ELSE 0 END;
  v_delta := v_new_active - v_old_active;
  IF v_delta = 0 OR NEW.product_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_delta > 0 THEN
    UPDATE public.products
       SET reserved_stock = COALESCE(reserved_stock, 0) + v_delta,
           updated_at     = now()
     WHERE id = NEW.product_id;
  ELSE
    UPDATE public.products
       SET reserved_stock = GREATEST(0, COALESCE(reserved_stock, 0) + v_delta),
           updated_at     = now()
     WHERE id = NEW.product_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_reserved_stock_on_update ON public.material_reservations;
CREATE TRIGGER trg_sync_reserved_stock_on_update
  AFTER UPDATE ON public.material_reservations
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status OR
    OLD.quantity_reserved IS DISTINCT FROM NEW.quantity_reserved OR
    OLD.quantity_consumed IS DISTINCT FROM NEW.quantity_consumed
  )
  EXECUTE FUNCTION public.tg_sync_reserved_stock_on_update();

-- Nota: release_order_reservations (round 6) decrementa MANUALMENTE +
-- depois faz UPDATE status='cancelled'. Com o novo trigger, o UPDATE
-- decrementaria de novo (duplo decrement). Vamos refatorar a função
-- pra delegar ao trigger.
CREATE OR REPLACE FUNCTION public.release_order_reservations(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- UPDATE dispara trg_sync_reserved_stock_on_update que decrementa reserved_stock
  -- proporcional ao delta (ativo → cancelled). Não decrementamos manual aqui.
  UPDATE public.material_reservations
     SET status = 'cancelled', updated_at = now()
   WHERE order_id = p_order_id
     AND status IN ('reserved', 'partially_consumed');

  DELETE FROM public.reservation_batches WHERE order_id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_order_reservations(uuid) TO authenticated;

-- Nota 2: hybrid_debit_stock_for_order, debit_sole_stock_by_grade etc. fazem
-- UPDATE quantity_consumed (não status). O trigger decrementa reserved_stock
-- proporcional ao quantity_consumed que aumentou. Coerente com o "passar pra
-- consumido". CORRIGE o duplo decremento C4.
