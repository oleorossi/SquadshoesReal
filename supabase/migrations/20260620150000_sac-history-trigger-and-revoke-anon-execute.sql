-- =============================================================================
-- SAC history trigger + REVOKE EXECUTE FROM anon
-- =============================================================================
-- 1) Trigger auto-popula sac_ticket_history sempre que status muda em
--    sac_tickets. Histórico ficava órfão (tabela existia mas ninguém escrevia).
--
-- 2) REVOKE EXECUTE FROM anon ON ALL FUNCTIONS IN SCHEMA public.
--    Squad Shoes é ERP interno (sem surface anônima). Os 134 funções
--    SECURITY DEFINER expostas a anon eram vetor de escalation
--    (auditoria advisor security #12). Authenticated continua com acesso.
-- =============================================================================

-- ─── #1: SAC history auto-insert ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_sac_log_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Só registra quando status muda (não em UPDATE de qualquer campo)
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.sac_ticket_history (
      ticket_id, from_status, to_status, changed_by
    ) VALUES (
      NEW.id, OLD.status, NEW.status, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sac_log_status_change ON public.sac_tickets;
CREATE TRIGGER trg_sac_log_status_change
  AFTER UPDATE ON public.sac_tickets
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_sac_log_status_change();

-- ─── #2: REVOKE EXECUTE FROM anon ────────────────────────────────────────────
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Garante que default privileges futuros também não dão anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
