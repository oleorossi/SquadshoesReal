-- =============================================================================
-- Drop stale overloads of check_stock_availability
-- =============================================================================
--
-- Postgres mantinha 3 overloads acumulados:
--   (uuid, integer)
--   (uuid, integer, text)
--   (uuid, integer, text, jsonb)  <- versão correta com defaults (mig 20260502231728)
--
-- Quando o frontend chama com 3 args (StockAvailabilityBadge, useOrders),
-- PostgREST não decide entre a 3-args e a 4-args com p_order_grade DEFAULT NULL.
-- Erro: "Could not choose the best candidate function between: ...".
--
-- Fix: dropar as 2 versões antigas. A de 4 args cobre TODOS os callers:
--   - 3 args (sem grade) → p_order_grade=NULL via DEFAULT
--   - 4 args (com grade)  → caso normal
-- =============================================================================

DROP FUNCTION IF EXISTS public.check_stock_availability(p_reference_id uuid, p_order_quantity integer);
DROP FUNCTION IF EXISTS public.check_stock_availability(p_reference_id uuid, p_order_quantity integer, p_color text);

-- Sanity check: deve restar exatamente 1 versão.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'check_stock_availability';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Esperava 1 versão de check_stock_availability, encontrou %', v_count;
  END IF;
END $$;
