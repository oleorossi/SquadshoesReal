-- =============================================================================
-- AUDIT ROUND 14 — Comissões + integridade de AR
-- =============================================================================
-- 1. Backfill representative_id em sale_orders
--    Hoje: 19 PVs ativos com representative (texto), 3 com representative_id.
--    16 PVs dependem de matching por nome no ComissoesTab — frágil.
--    Fix: backfill por LOWER(TRIM(name)) match. Ambíguos (>1 rep com mesmo nome)
--    permanecem NULL e geram log via NOTICE pra revisão manual.
--
-- 2. Validação de integridade em accounts_receivable
--    Hoje: 0 violações ATUAIS, mas sem CHECK constraints. amount_received pode
--    ser editado livremente — futuro risco.
--    Fix: CHECK amount >= 0, amount_received between 0 and amount.
--
-- 3. Auto-fechar AR quando quitado
--    Hoje: precisa atualizar status='received' manualmente. Pode esquecer e o
--    AR aparece como "pendente" mesmo recebido.
--    Fix: trigger BEFORE UPDATE — quando amount_received >= amount, status vira
--    'received' e payment_date é setado se ainda for NULL.
-- =============================================================================

-- ─── 1. Backfill representative_id ─────────────────────────────────────────

DO $$
DECLARE
  v_updated int;
  v_ambiguous int;
BEGIN
  -- 1a. Match exato (case-insensitive, trim) onde só há UM rep com aquele nome
  WITH unique_reps AS (
    SELECT LOWER(TRIM(name)) AS norm_name, id
      FROM public.representatives
     WHERE active = true
     GROUP BY LOWER(TRIM(name)), id
     HAVING COUNT(*) OVER (PARTITION BY LOWER(TRIM(name))) = 1
  )
  UPDATE public.sale_orders so
     SET representative_id = ur.id
    FROM unique_reps ur
   WHERE so.representative_id IS NULL
     AND so.representative IS NOT NULL
     AND LOWER(TRIM(so.representative)) = ur.norm_name;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 1b. Conta quantos ficaram sem match (nomes ambíguos ou inexistentes)
  SELECT COUNT(*) INTO v_ambiguous
    FROM public.sale_orders
   WHERE representative_id IS NULL
     AND representative IS NOT NULL
     AND representative <> '';

  RAISE NOTICE 'Backfill representative_id: % PVs atualizados, % ainda sem FK (nomes ambíguos ou inexistentes)',
    v_updated, v_ambiguous;
END $$;


-- ─── 2. CHECK constraints em accounts_receivable ──────────────────────────

-- Adicionar com NOT VALID primeiro pra não quebrar caso existam dados ruins,
-- depois VALIDATE — se passar, vira full constraint. Se falhar, vamos saber.

ALTER TABLE public.accounts_receivable
  ADD CONSTRAINT ar_amount_non_negative
    CHECK (amount >= 0) NOT VALID;

ALTER TABLE public.accounts_receivable
  ADD CONSTRAINT ar_received_non_negative
    CHECK (COALESCE(amount_received, 0) >= 0) NOT VALID;

ALTER TABLE public.accounts_receivable
  ADD CONSTRAINT ar_received_le_amount
    CHECK (COALESCE(amount_received, 0) <= COALESCE(amount, 0)) NOT VALID;

-- Validar (vai ler todas as linhas; em prod hoje passa porque já validamos
-- que não há violações).
ALTER TABLE public.accounts_receivable VALIDATE CONSTRAINT ar_amount_non_negative;
ALTER TABLE public.accounts_receivable VALIDATE CONSTRAINT ar_received_non_negative;
ALTER TABLE public.accounts_receivable VALIDATE CONSTRAINT ar_received_le_amount;


-- Mesmas constraints simétricas em accounts_payable
ALTER TABLE public.accounts_payable
  ADD CONSTRAINT ap_amount_non_negative
    CHECK (amount >= 0) NOT VALID;

ALTER TABLE public.accounts_payable
  ADD CONSTRAINT ap_paid_non_negative
    CHECK (COALESCE(amount_paid, 0) >= 0) NOT VALID;

ALTER TABLE public.accounts_payable
  ADD CONSTRAINT ap_paid_le_amount
    CHECK (COALESCE(amount_paid, 0) <= COALESCE(amount, 0)) NOT VALID;

ALTER TABLE public.accounts_payable VALIDATE CONSTRAINT ap_amount_non_negative;
ALTER TABLE public.accounts_payable VALIDATE CONSTRAINT ap_paid_non_negative;
ALTER TABLE public.accounts_payable VALIDATE CONSTRAINT ap_paid_le_amount;


-- ─── 3. Auto-fechar AR/AP quando quitado ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_auto_close_ar_on_full_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Só age se ainda não está finalizado E foi totalmente quitado.
  IF NEW.status NOT IN ('received', 'cancelled', 'cancelado')
     AND COALESCE(NEW.amount_received, 0) >= COALESCE(NEW.amount, 0)
     AND COALESCE(NEW.amount, 0) > 0 THEN
    NEW.status := 'received';
    IF NEW.payment_date IS NULL THEN
      NEW.payment_date := CURRENT_DATE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_close_ar ON public.accounts_receivable;
CREATE TRIGGER trg_auto_close_ar
  BEFORE INSERT OR UPDATE OF amount_received, amount ON public.accounts_receivable
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_auto_close_ar_on_full_payment();


-- AP: simétrico (auto-fecha pra 'paid' quando amount_paid >= amount)
CREATE OR REPLACE FUNCTION public.tg_auto_close_ap_on_full_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status NOT IN ('paid', 'cancelled', 'cancelado')
     AND COALESCE(NEW.amount_paid, 0) >= COALESCE(NEW.amount, 0)
     AND COALESCE(NEW.amount, 0) > 0 THEN
    NEW.status := 'paid';
    IF NEW.payment_date IS NULL THEN
      NEW.payment_date := CURRENT_DATE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_close_ap ON public.accounts_payable;
CREATE TRIGGER trg_auto_close_ap
  BEFORE INSERT OR UPDATE OF amount_paid, amount ON public.accounts_payable
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_auto_close_ap_on_full_payment();
