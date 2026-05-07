-- Dois fixes operacionais:
--
-- 1) Trigger: auto-cancela picking_lists quando OP é cancelada
--    picking_lists tem FK ON DELETE CASCADE em order_id, mas cancelamento
--    é status change (não DELETE). Listas para OPs canceladas ficam
--    'pending' para sempre, inflando o KPI de picking pendente.
--    Mesmo padrão usado em mrp_suggestions (20260527180000).
--
-- 2) Função de retenção: prune_old_notifications()
--    Tabela notifications cresce sem limite (cada finalize_production_sector,
--    cada low-stock alert, etc. cria uma linha). Adiciona função idempotente
--    que remove notificações lidas com >90 dias E broadcasts (sem user_id)
--    com >30 dias. Pode ser invocada manualmente ou agendada via pg_cron
--    (não habilitado por padrão).

-- ============================================================
-- 1) Trigger picking_lists auto-cancel
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_picking_lists_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Cancelada' AND COALESCE(OLD.status, '') <> 'Cancelada' THEN
    UPDATE public.picking_lists
       SET status = 'cancelled',
           notes = COALESCE(NULLIF(notes, ''), '') ||
                   CASE WHEN COALESCE(NULLIF(notes, ''), '') <> '' THEN E'\n' ELSE '' END ||
                   '[Auto-cancelada: OP ' || COALESCE(NEW.order_number, NEW.id::text) || ' cancelada em ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ']',
           updated_at = now()
     WHERE order_id = NEW.id
       AND status IN ('pending', 'in_progress');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_picking_lists_on_order_cancel ON public.orders;
CREATE TRIGGER trg_cancel_picking_lists_on_order_cancel
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (NEW.status = 'Cancelada' AND COALESCE(OLD.status, '') <> 'Cancelada')
EXECUTE FUNCTION public.cancel_picking_lists_on_order_cancel();

-- Backfill: cancela picking_lists já órfãs (vinculadas a OPs canceladas).
-- Verifica se a coluna updated_at existe (tabelas antigas podem não ter).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='picking_lists' AND column_name='updated_at'
  ) THEN
    UPDATE public.picking_lists pl
       SET status = 'cancelled',
           notes = COALESCE(NULLIF(pl.notes, ''), '') ||
                   CASE WHEN COALESCE(NULLIF(pl.notes, ''), '') <> '' THEN E'\n' ELSE '' END ||
                   '[Auto-cancelada via backfill: OP já cancelada]',
           updated_at = now()
      FROM public.orders o
     WHERE pl.order_id = o.id
       AND o.status = 'Cancelada'
       AND pl.status IN ('pending', 'in_progress');
  ELSE
    UPDATE public.picking_lists pl
       SET status = 'cancelled',
           notes = COALESCE(NULLIF(pl.notes, ''), '') ||
                   CASE WHEN COALESCE(NULLIF(pl.notes, ''), '') <> '' THEN E'\n' ELSE '' END ||
                   '[Auto-cancelada via backfill: OP já cancelada]'
      FROM public.orders o
     WHERE pl.order_id = o.id
       AND o.status = 'Cancelada'
       AND pl.status IN ('pending', 'in_progress');
  END IF;
END $$;

-- ============================================================
-- 2) Função de retenção de notifications
-- ============================================================
-- Política sugerida (configurável via parâmetros):
--   - notificações lidas (read=true) há >90 dias: deletar
--   - broadcasts (user_id IS NULL) há >30 dias: deletar (já viram histórico)
--   - notificações não-lidas direcionadas (user_id IS NOT NULL):
--     manter sempre (operador ainda não viu)
--
-- Retorna jsonb com a contagem do que foi limpo, para auditoria de execução.

DROP FUNCTION IF EXISTS public.prune_old_notifications(int, int) CASCADE;
CREATE OR REPLACE FUNCTION public.prune_old_notifications(
  p_read_days_to_keep      int DEFAULT 90,
  p_broadcast_days_to_keep int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_read_deleted      int := 0;
  v_broadcast_deleted int := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  WITH d AS (
    DELETE FROM public.notifications
     WHERE read = true
       AND created_at < now() - (p_read_days_to_keep || ' days')::interval
    RETURNING 1
  )
  SELECT count(*) INTO v_read_deleted FROM d;

  WITH d AS (
    DELETE FROM public.notifications
     WHERE user_id IS NULL
       AND created_at < now() - (p_broadcast_days_to_keep || ' days')::interval
    RETURNING 1
  )
  SELECT count(*) INTO v_broadcast_deleted FROM d;

  RETURN jsonb_build_object(
    'read_deleted',      v_read_deleted,
    'broadcast_deleted', v_broadcast_deleted,
    'total_deleted',     v_read_deleted + v_broadcast_deleted,
    'pruned_at',         now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_old_notifications(int, int) TO authenticated;

COMMENT ON FUNCTION public.prune_old_notifications(int, int) IS
  'Remove notificações antigas. read=true há >p_read_days_to_keep dias e broadcasts (user_id IS NULL) há >p_broadcast_days_to_keep dias. Retorna contagem.';
