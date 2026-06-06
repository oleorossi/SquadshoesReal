-- ============================================================================
-- HARDENING: idempotência de OC contra race entre conexões/abas.
--
-- check_purchase_order_idempotency() fazia só um EXISTS dos últimos 30s. Sob
-- READ COMMITTED, duas transações concorrentes (2 abas, double-click com
-- latência) NÃO enxergam a linha não-commitada uma da outra → ambos os triggers
-- passam e gravam 2 OCs com a mesma idempotency_key. O Map TTL do cliente só
-- cobre a mesma aba.
--
-- FIX: pg_advisory_xact_lock por idempotency_key serializa o acesso — a 2ª
-- transação espera a 1ª commitar e então enxerga a linha, abortando com 23505.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_purchase_order_idempotency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.idempotency_key IS NOT NULL THEN
    -- Serializa por chave (lock de transação, liberado no commit/rollback).
    PERFORM pg_advisory_xact_lock(hashtext('po_idempotency_' || NEW.idempotency_key));
    IF EXISTS (
      SELECT 1
      FROM public.purchase_orders
      WHERE idempotency_key = NEW.idempotency_key
        AND created_at > NOW() - INTERVAL '30 seconds'
    ) THEN
      RAISE EXCEPTION 'OC duplicada — mesma idempotency_key submetida nos ultimos 30s. Verifique se a OC anterior foi criada antes de tentar de novo.'
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
