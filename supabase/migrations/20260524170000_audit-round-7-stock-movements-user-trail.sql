-- =============================================================================
-- AUDIT ROUND 7 — Audit trail de stock_movements
-- =============================================================================
-- 🔴 BUG #5 — 100% dos stock_movements sem user_id/user_email
--    Tabela tem colunas user_id/user_email pra auditoria, mas as 11 RPCs
--    que inserem em stock_movements (adjust_stock, debit_*, restore_*,
--    convert_reservation_to_out, etc.) nunca populam. Resultado: 278/278
--    movimentos em produção sem rastro de quem fez. Compliance fiscal e
--    forense impossível.
--
--    Fix: trigger BEFORE INSERT que preenche user_id/user_email a partir
--    de auth.uid() se ainda forem NULL. Funciona pra todas as RPCs atuais
--    e futuras sem precisar tocar em cada uma. SECURITY DEFINER preserva
--    o auth.uid() do request HTTP original.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_stock_movements_set_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
  v_email text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    -- Sem usuário no request (job de fundo, manual SQL via service_role).
    -- Não bloqueia a inserção; apenas deixa user_id NULL como antes.
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL THEN
    NEW.user_id := v_uid;
  END IF;

  IF NEW.user_email IS NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    NEW.user_email := v_email;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_movements_set_user ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_set_user
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_stock_movements_set_user();
