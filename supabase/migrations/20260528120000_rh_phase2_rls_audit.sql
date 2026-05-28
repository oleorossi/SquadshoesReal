-- =============================================================================
-- RH Audit Fase 2 (2026-05-28): RLS leitura restrita + audit trail
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-28.
-- Arquivo no repo pra histórico (não vai ser re-aplicada pelo GH Action).
--
-- Resolve:
--   C1 da auditoria — vazamento de saldo: qualquer authenticated lia movimentos
--   A1 — edição manual de batidas sem audit
--   A6 extra — UPDATE/DELETE de bank_hours_movements sem audit
-- =============================================================================

-- C1: bank_hours_movements SELECT restrito a roles RH.
DROP POLICY IF EXISTS "Authenticated can read bank_hours_movements" ON public.bank_hours_movements;
CREATE POLICY "Only RH roles can read bank_hours_movements"
  ON public.bank_hours_movements
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['admin'::app_role, 'gerente'::app_role, 'rh'::app_role])
    )
  );

-- A1: audit trail em time_records (edição/exclusão de batidas)
CREATE OR REPLACE FUNCTION public.tg_audit_time_records()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, old_data, new_data, success)
  VALUES (
    auth.uid(),
    LOWER(TG_OP),
    'time_record',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN to_jsonb(NEW) END,
    true
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_audit_time_records ON public.time_records;
CREATE TRIGGER tg_audit_time_records
  AFTER UPDATE OR DELETE ON public.time_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_time_records();

-- A6 extra: audit em bank_hours_movements (UPDATE/DELETE só — INSERT já tem created_by)
CREATE OR REPLACE FUNCTION public.tg_audit_bank_hours_movements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, old_data, new_data, success)
  VALUES (
    auth.uid(),
    LOWER(TG_OP),
    'bank_hours_movement',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN to_jsonb(NEW) END,
    true
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_audit_bank_hours_movements ON public.bank_hours_movements;
CREATE TRIGGER tg_audit_bank_hours_movements
  AFTER UPDATE OR DELETE ON public.bank_hours_movements
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_bank_hours_movements();
