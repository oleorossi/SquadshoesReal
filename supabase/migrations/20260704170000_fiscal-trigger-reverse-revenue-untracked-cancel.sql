-- =============================================================================
-- AUDITORIA FISCAL (hardening): trigger de reversão de receita em cancelamento
-- NÃO-RASTREADO (fora do fluxo cancel-nfe)
-- =============================================================================
-- O cancel-nfe (fluxo próprio) já reverte: insere entry negativa + cancela AR,
-- e SEMPRE grava justificativa_cancelamento (≥15 chars). Cancelamento em massa
-- ou manual (UPDATE direto status='cancelada' SEM justificativa) deixava
-- receita-fantasma — foi o caso dos 5 NFs cancelados em 26/05 (PV-00104 etc.).
--
-- Este trigger cobre exatamente esse buraco SEM dupla-reversão: age só quando
-- justificativa_cancelamento está vazia (= não passou pelo cancel-nfe). Estorna
-- só receita 'confirmed'/'posted' (nunca caixa recebido 'paid'/'reconciled') de
-- forma SPED-safe (status='estornado', não deleta) e cancela AR em aberto.
-- Idempotente: re-disparo não re-estorna (WHERE status IN confirmed/posted).
-- Aplicada via Supabase MCP em 2026-06-01.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.tg_reverse_revenue_on_untracked_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'cancelada'
     AND OLD.status IS DISTINCT FROM 'cancelada'
     AND NEW.sale_order_id IS NOT NULL
     AND COALESCE(TRIM(NEW.justificativa_cancelamento), '') = ''
  THEN
    UPDATE public.financial_entries
    SET status = 'estornado',
        notes = TRIM(BOTH ' |' FROM COALESCE(notes,'') || ' | Estorno automatico (trigger): NF-e cancelada fora do fluxo cancel-nfe')
    WHERE reference_type = 'sale_order' AND type = 'receita'
      AND reference_id = NEW.sale_order_id::text
      AND status IN ('confirmed','posted');

    UPDATE public.accounts_receivable
    SET status = 'cancelled'
    WHERE sale_order_id = NEW.sale_order_id
      AND status NOT IN ('received','cancelled');
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_reverse_revenue_on_untracked_cancel ON public.nfe_emitidas;
CREATE TRIGGER trg_reverse_revenue_on_untracked_cancel
AFTER UPDATE OF status ON public.nfe_emitidas
FOR EACH ROW EXECUTE FUNCTION public.tg_reverse_revenue_on_untracked_cancel();
