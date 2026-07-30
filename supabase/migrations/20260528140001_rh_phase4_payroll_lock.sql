-- =============================================================================
-- RH Audit Fase 4 (2026-05-28): payroll_runs lock pra status aprovado/pago
-- =============================================================================
-- Aplicada via MCP. Arquivo no repo pra histórico.
--
-- C4 da auditoria: UNIQUE(employee_id, period) já existe (payroll_runs_employee_id_period_key),
-- protege contra duplicatas. Mas UPDATE em row aprovada/paga corrompia audit
-- (RH podia "recalcular" silenciosamente folha já paga).
--
-- Trigger BEFORE UPDATE: bloqueia mudança quando status='aprovado' ou 'pago'.
-- Única transição permitida: → 'cancelado' (estorno legítimo).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_payroll_lock_finalized()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('aprovado', 'pago') THEN
    IF NEW.status = 'cancelado' AND OLD.status <> 'cancelado' THEN
      RETURN NEW;
    END IF;
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Folha em status % nao pode ser editada. Crie nova folha ou cancele a atual.', OLD.status
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_payroll_lock_finalized ON public.payroll_runs;
CREATE TRIGGER tg_payroll_lock_finalized
  BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_lock_finalized();
