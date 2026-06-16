-- =============================================================================
-- Decisão Leonardo 2026-06-14 — CMV 3A+i: reconhecimento por DATA DE RECEBIMENTO
-- =============================================================================
-- Top10 #2 (parte 3/3). O CMV (financial_entries reference_type='sale_order_cmv')
-- é a ALOCAÇÃO contábil do custo, criada quando o PV é confirmado/produzido. Mas
-- a DRE agora é em regime de CAIXA — então o CMV deve ser RECONHECIDO conforme o
-- cliente paga (cash matching): pagou 100% → CMV 100% reconhecido; pagou parcial
-- → CMV proporcional ao recebido; o resto fica diferido até o restante entrar.
--
-- Não há tabela de pagamentos (pagamento = update na própria accounts_receivable:
-- amount_received + payment_date). Então o reconhecimento é dirigido por trigger
-- na accounts_receivable.
--
-- Modelo:
--   • sale_order_cmv_recognized: 1 linha por PARCELA (accounts_receivable) que tem
--     caixa recebido, com recognized_amount (proporcional) e recognized_date (=
--     payment_date da parcela). UNIQUE(sale_order_id, receivable_id) = idempotência.
--   • recognized_amount(parcela) = cmv_total × (amount_received_da_parcela / AR_bruta_total)
--     onde AR_bruta_total = Σ amount das parcelas ativas (AR é bruta desde o commit 1/3).
--     Σ reconhecido = cmv_total × (Σ recebido / Σ bruto) → = cmv_total quando 100% pago.
--   • financial_entries.recognized_amount/recognized_date (cumulativo) preenchidos
--     pro relatório/auditoria.
--   • Cancelamento de NF/PV: cancela a entry sale_order_cmv (trigger existente) e/ou
--     as AR → recompute zera o reconhecido (estorna proporcional ao reconhecido).
-- =============================================================================

-- ── 1. Colunas de reconhecimento na entry de CMV ──────────────────────────────
ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS recognized_amount numeric,
  ADD COLUMN IF NOT EXISTS recognized_date   date;

COMMENT ON COLUMN public.financial_entries.recognized_amount IS
  'Para sale_order_cmv: total de CMV já reconhecido (cash matching) — Σ de '
  'sale_order_cmv_recognized. Preenchido por recompute_sale_order_cmv_recognition.';
COMMENT ON COLUMN public.financial_entries.recognized_date IS
  'Para sale_order_cmv: data do último reconhecimento (MAX recognized_date).';

-- ── 2. Tabela de reconhecimento por parcela ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sale_order_cmv_recognized (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id     uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  receivable_id     uuid NOT NULL REFERENCES public.accounts_receivable(id) ON DELETE CASCADE,
  recognized_amount numeric NOT NULL DEFAULT 0,
  recognized_date   date NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_order_cmv_recognized_uq UNIQUE (sale_order_id, receivable_id)
);

CREATE INDEX IF NOT EXISTS idx_socr_sale_order ON public.sale_order_cmv_recognized(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_socr_recognized_date ON public.sale_order_cmv_recognized(recognized_date);

COMMENT ON TABLE public.sale_order_cmv_recognized IS
  'CMV reconhecido por caixa (cash matching). 1 linha por parcela de AR que recebeu '
  'caixa; recognized_amount = proporção do CMV total pela fração recebida. A DRE em '
  'regime de caixa soma recognized_amount por recognized_date. Decisão Leonardo 2026-06-14.';

-- RLS: leitura p/ usuário aprovado; escrita SÓ via funções SECURITY DEFINER.
ALTER TABLE public.sale_order_cmv_recognized ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_order_cmv_recognized FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sale_order_cmv_recognized FROM authenticated;
GRANT SELECT ON public.sale_order_cmv_recognized TO authenticated;
DROP POLICY IF EXISTS socr_select ON public.sale_order_cmv_recognized;
CREATE POLICY socr_select ON public.sale_order_cmv_recognized
  FOR SELECT TO authenticated USING (public.is_approved_user());

-- ── 3. Função de recompute (idempotente) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_sale_order_cmv_recognition(p_sale_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ref         text := p_sale_order_id::text;
  v_cmv_total   numeric;
  v_gross       numeric;   -- base bruta = Σ amount das parcelas ativas
  v_rec_total   numeric := 0;
  v_rec_date    date;
BEGIN
  IF p_sale_order_id IS NULL THEN RETURN; END IF;

  -- CMV total alocado (entry ativa). Se cancelado/inexistente → 0 (estorna tudo).
  SELECT COALESCE(SUM(amount), 0) INTO v_cmv_total
    FROM public.financial_entries
   WHERE reference_type = 'sale_order_cmv'
     AND reference_id = v_ref
     AND status NOT IN ('cancelado', 'cancelled', 'estornado');

  -- Base bruta de rateio = soma das parcelas ativas (AR é bruta).
  SELECT COALESCE(SUM(amount), 0) INTO v_gross
    FROM public.accounts_receivable
   WHERE sale_order_id = p_sale_order_id
     AND status NOT IN ('cancelled', 'cancelado');

  IF v_cmv_total > 0 AND v_gross > 0 THEN
    -- Upsert 1 linha por parcela com caixa recebido. Cap em amount (sem
    -- super-reconhecer se amount_received > amount por algum motivo).
    INSERT INTO public.sale_order_cmv_recognized AS t
      (sale_order_id, receivable_id, recognized_amount, recognized_date)
    SELECT
      p_sale_order_id,
      ar.id,
      round(v_cmv_total * (LEAST(COALESCE(ar.amount_received,0), ar.amount) / v_gross), 2),
      COALESCE(ar.payment_date, CURRENT_DATE)
    FROM public.accounts_receivable ar
    WHERE ar.sale_order_id = p_sale_order_id
      AND ar.status NOT IN ('cancelled', 'cancelado')
      AND COALESCE(ar.amount_received, 0) > 0
    ON CONFLICT (sale_order_id, receivable_id) DO UPDATE
      SET recognized_amount = EXCLUDED.recognized_amount,
          recognized_date   = EXCLUDED.recognized_date,
          updated_at        = now();
  END IF;

  -- Remove reconhecimentos que não se sustentam mais (CMV cancelado, sem base,
  -- parcela cancelada ou zerada). Estorna proporcional ao que havia.
  DELETE FROM public.sale_order_cmv_recognized r
   WHERE r.sale_order_id = p_sale_order_id
     AND (
       v_cmv_total <= 0
       OR v_gross <= 0
       OR NOT EXISTS (
         SELECT 1 FROM public.accounts_receivable ar
          WHERE ar.id = r.receivable_id
            AND ar.status NOT IN ('cancelled', 'cancelado')
            AND COALESCE(ar.amount_received, 0) > 0
       )
     );

  -- Espelha o cumulativo na entry de CMV (relatório/auditoria). Atualiza só se
  -- mudou — e SÓ colunas recognized_* (não dispara o trigger OF amount,status).
  SELECT COALESCE(SUM(recognized_amount), 0), MAX(recognized_date)
    INTO v_rec_total, v_rec_date
    FROM public.sale_order_cmv_recognized
   WHERE sale_order_id = p_sale_order_id;

  UPDATE public.financial_entries
     SET recognized_amount = v_rec_total,
         recognized_date   = v_rec_date
   WHERE reference_type = 'sale_order_cmv'
     AND reference_id = v_ref
     AND status NOT IN ('cancelado', 'cancelled', 'estornado')
     AND (recognized_amount IS DISTINCT FROM v_rec_total
          OR recognized_date IS DISTINCT FROM v_rec_date);
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_sale_order_cmv_recognition(uuid) TO authenticated;

-- ── 4. Trigger na accounts_receivable (recebimento dirige o reconhecimento) ───
CREATE OR REPLACE FUNCTION public.tg_ar_recompute_cmv_recognition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.sale_order_id IS NOT NULL THEN
      PERFORM public.recompute_sale_order_cmv_recognition(OLD.sale_order_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.sale_order_id IS NOT NULL THEN
    PERFORM public.recompute_sale_order_cmv_recognition(NEW.sale_order_id);
  END IF;
  -- Se a parcela mudou de PV (raro), recompute o antigo também.
  IF TG_OP = 'UPDATE' AND OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id
     AND OLD.sale_order_id IS NOT NULL THEN
    PERFORM public.recompute_sale_order_cmv_recognition(OLD.sale_order_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ar_recompute_cmv ON public.accounts_receivable;
CREATE TRIGGER trg_ar_recompute_cmv
  AFTER INSERT OR DELETE OR UPDATE OF amount, amount_received, payment_date, status, sale_order_id
  ON public.accounts_receivable
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_ar_recompute_cmv_recognition();

-- ── 5. Trigger na financial_entries (CMV alocado mudou/cancelou → re-distribui) ─
-- Só reage a sale_order_cmv. Dispara em INSERT e em UPDATE OF amount/status —
-- NUNCA em update de recognized_* (recompute atualiza só essas colunas → sem loop).
CREATE OR REPLACE FUNCTION public.tg_cmv_entry_recompute_recognition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so uuid;
BEGIN
  IF NEW.reference_type <> 'sale_order_cmv' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_so := NEW.reference_id::uuid;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;
  IF v_so IS NOT NULL THEN
    PERFORM public.recompute_sale_order_cmv_recognition(v_so);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cmv_entry_recompute ON public.financial_entries;
CREATE TRIGGER trg_cmv_entry_recompute
  AFTER INSERT OR UPDATE OF amount, status
  ON public.financial_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_cmv_entry_recompute_recognition();

GRANT EXECUTE ON FUNCTION public.tg_ar_recompute_cmv_recognition() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_cmv_entry_recompute_recognition() TO authenticated;

COMMENT ON FUNCTION public.recompute_sale_order_cmv_recognition(uuid) IS
  'Recalcula sale_order_cmv_recognized de um PV: rateia o CMV total (entry '
  'sale_order_cmv ativa) proporcional ao caixa recebido em cada parcela de AR. '
  'Idempotente. Chamado por triggers em accounts_receivable e financial_entries. '
  'Cancelamento (CMV ou AR) zera o reconhecido (estorno). Decisão Leonardo 2026-06-14.';
