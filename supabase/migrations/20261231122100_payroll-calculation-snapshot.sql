-- Congela o cálculo e o extrato diário usados na emissão da folha.
-- Folhas antigas continuam válidas: o snapshot é nulo e a UI usa o fallback legado.
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS calculation_rule_version text,
  ADD COLUMN IF NOT EXISTS calculation_snapshot jsonb;

COMMENT ON COLUMN public.payroll_runs.calculation_rule_version IS
  'Versão da regra do motor usada no cálculo. Ex.: saldo-periodo-v1-2026-08-13.';

COMMENT ON COLUMN public.payroll_runs.calculation_snapshot IS
  'Snapshot imutável dos dados/resultados exibidos nos relatórios da folha fechada.';

-- Uma folha aprovada/paga não pode trocar silenciosamente o cálculo histórico.
CREATE OR REPLACE FUNCTION public.tg_lock_closed_payroll_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('aprovado', 'pago') AND (
      NEW.calculation_rule_version IS NULL OR NEW.calculation_snapshot IS NULL OR
      NEW.calculation_snapshot->>'rule_version' IS DISTINCT FROM NEW.calculation_rule_version OR
      NEW.calculation_snapshot->'result'->>'rule_version' IS DISTINCT FROM NEW.calculation_rule_version
    ) THEN
      RAISE EXCEPTION 'Folha não pode ser fechada sem snapshot de cálculo';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('aprovado', 'pago') AND OLD.status = 'rascunho' AND (
    NEW.calculation_rule_version IS NULL OR NEW.calculation_snapshot IS NULL OR
    NEW.calculation_snapshot->>'rule_version' IS DISTINCT FROM NEW.calculation_rule_version OR
    NEW.calculation_snapshot->'result'->>'rule_version' IS DISTINCT FROM NEW.calculation_rule_version
  ) THEN
    RAISE EXCEPTION 'Folha não pode ser fechada sem snapshot de cálculo';
  END IF;

  IF OLD.status IN ('aprovado', 'pago') AND (
    NEW.calculation_rule_version IS DISTINCT FROM OLD.calculation_rule_version OR
    NEW.calculation_snapshot IS DISTINCT FROM OLD.calculation_snapshot
  ) THEN
    RAISE EXCEPTION 'Snapshot de folha aprovada/paga é imutável';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_closed_payroll_snapshot ON public.payroll_runs;
CREATE TRIGGER trg_lock_closed_payroll_snapshot
  BEFORE UPDATE OF status, calculation_rule_version, calculation_snapshot
  ON public.payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_lock_closed_payroll_snapshot();

DROP TRIGGER IF EXISTS trg_require_closed_payroll_snapshot_insert ON public.payroll_runs;
CREATE TRIGGER trg_require_closed_payroll_snapshot_insert
  BEFORE INSERT ON public.payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_lock_closed_payroll_snapshot();
