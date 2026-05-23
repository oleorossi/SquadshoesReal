-- =============================================================================
-- purchase_orders: idempotency_key + trigger anti-duplicação dentro de 30s
-- =============================================================================
-- Antes deste fix, useCreatePurchaseOrder tinha idempotência APENAS client-side
-- (Map em memória com TTL 30s). Se o cliente crashava OU o componente era
-- desmontado entre o INSERT e o callback, um retry rápido criava OC duplicada.
--
-- Agora: frontend computa hash do payload (supplier + items sorted) e envia
-- como idempotency_key. Trigger BEFORE INSERT rejeita INSERT se já houver OC
-- com mesma key nos últimos 30s (raise unique_violation = 23505).
--
-- Não usa UNIQUE INDEX porque NOW() não é IMMUTABLE; trigger permite a janela
-- temporal de 30s de proteção.
-- =============================================================================

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMENT ON COLUMN public.purchase_orders.idempotency_key IS
  'Hash do payload (supplier + items) calculado pelo frontend. Trigger ' ||
  'tg_purchase_order_idempotency rejeita INSERT se houver OC com mesmo ' ||
  'key nos últimos 30s. Nullable pra compat com OCs legacy.';

-- Índice parcial pra acelerar a checagem do trigger (evita full table scan
-- a cada INSERT em uma tabela que pode ter 10k+ rows).
CREATE INDEX IF NOT EXISTS idx_purchase_orders_idempotency_recent
  ON public.purchase_orders (idempotency_key, created_at DESC)
  WHERE idempotency_key IS NOT NULL;

-- Trigger function
CREATE OR REPLACE FUNCTION public.check_purchase_order_idempotency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.idempotency_key IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.purchase_orders
      WHERE idempotency_key = NEW.idempotency_key
        AND created_at > NOW() - INTERVAL '30 seconds'
    ) THEN
      RAISE EXCEPTION 'OC duplicada — mesma idempotency_key submetida nos últimos 30s. Verifique se a OC anterior foi criada antes de tentar de novo.'
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_purchase_order_idempotency ON public.purchase_orders;
CREATE TRIGGER tg_purchase_order_idempotency
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_purchase_order_idempotency();
