-- Auto-cancela mrp_suggestions quando a OP vinculada é cancelada.
--
-- Bug: a tabela mrp_suggestions tem `order_id REFERENCES orders(id) ON DELETE SET NULL`,
-- ou seja, quando uma OP é cancelada (apenas mudança de status, NÃO delete), as
-- mrp_suggestions abertas vinculadas continuam com status='open' e order_id apontando
-- para uma OP cancelada. Resultado:
--   - Painel MRP mostra "comprar X material para OP Y" mesmo OY estando cancelada.
--   - useSaleOrders pode auto-gerar OCs baseadas nessas sugestões fantasmas.
--   - Operadores manualmente "resolvem" sugestões inúteis.
--
-- Fix: trigger AFTER UPDATE em orders. Quando status muda para 'Cancelada' (de qualquer
-- estado anterior), marca como 'cancelled' todas as suggestions abertas/aceitas dessa
-- OP, com note explicando o motivo. Suggestions já resolvidas/rejeitadas ficam intocadas
-- (preservar trilha de auditoria).

CREATE OR REPLACE FUNCTION public.cancel_mrp_suggestions_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só age quando o status MUDA para 'Cancelada' — evita re-disparo se a OP já estava cancelada.
  IF NEW.status = 'Cancelada' AND COALESCE(OLD.status, '') <> 'Cancelada' THEN
    UPDATE public.mrp_suggestions
       SET status = 'cancelled',
           resolved_at = now(),
           resolved_by = 'system:order_cancel',
           notes = COALESCE(NULLIF(notes, ''), '') ||
                   CASE WHEN COALESCE(NULLIF(notes, ''), '') <> '' THEN E'\n' ELSE '' END ||
                   '[Auto-cancelada: OP ' || COALESCE(NEW.order_number, NEW.id::text) || ' cancelada em ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ']',
           updated_at = now()
     WHERE order_id = NEW.id
       AND status IN ('open', 'accepted');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_mrp_suggestions_on_order_cancel ON public.orders;
CREATE TRIGGER trg_cancel_mrp_suggestions_on_order_cancel
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (NEW.status = 'Cancelada' AND COALESCE(OLD.status, '') <> 'Cancelada')
EXECUTE FUNCTION public.cancel_mrp_suggestions_on_order_cancel();

-- Backfill: marca como 'cancelled' suggestions abertas vinculadas a OPs já canceladas.
UPDATE public.mrp_suggestions ms
   SET status = 'cancelled',
       resolved_at = now(),
       resolved_by = 'system:backfill',
       notes = COALESCE(NULLIF(ms.notes, ''), '') ||
               CASE WHEN COALESCE(NULLIF(ms.notes, ''), '') <> '' THEN E'\n' ELSE '' END ||
               '[Auto-cancelada via backfill: OP já cancelada]',
       updated_at = now()
  FROM public.orders o
 WHERE ms.order_id = o.id
   AND o.status = 'Cancelada'
   AND ms.status IN ('open', 'accepted');
