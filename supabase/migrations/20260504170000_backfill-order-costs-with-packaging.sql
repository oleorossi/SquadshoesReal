-- ---------------------------------------------------------------
-- 20260504170000_backfill-order-costs-with-packaging.sql
--
-- Recalcula `order_costs` históricos que foram persistidos pela
-- versão anterior de `calculate_order_cost()` (sem somar packaging
-- e sem usar grade). Garante que relatórios de margem retroativos
-- reflitam o custo real.
--
-- Pré-requisito: 20260504120000 já aplicado (versão corrigida da
-- função). Esta migration apenas dispara recalculação.
--
-- Estratégia:
--   - Para cada (sale_order_id, sale_order_item_id) com order_costs
--     existente, chama `calculate_order_cost(..., p_persist=true)`
--     que faz UPSERT (ON CONFLICT DO UPDATE) com os valores corretos.
--   - Pedidos cancelados são pulados (não fazem sentido recalcular).
-- ---------------------------------------------------------------

DO $$
DECLARE
  v_oc record;
  v_processed integer := 0;
  v_skipped   integer := 0;
  v_failed    integer := 0;
BEGIN
  FOR v_oc IN
    SELECT oc.sale_order_id, oc.sale_order_item_id, so.status
      FROM public.order_costs oc
      JOIN public.sale_orders so ON so.id = oc.sale_order_id
     ORDER BY oc.calculated_at NULLS FIRST
  LOOP
    -- Pula pedidos finalizados — manter custo histórico congelado
    -- evita que mudanças no cost_policies retroajam relatórios
    -- de pedidos já entregues.
    IF LOWER(COALESCE(v_oc.status, '')) IN (
         'cancelado', 'cancelada', 'cancelled',
         'entregue', 'delivered',
         'finalizado', 'finalizada', 'finished', 'completed',
         'faturado', 'faturada', 'invoiced'
       ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.calculate_order_cost(
        v_oc.sale_order_id,
        v_oc.sale_order_item_id,
        true
      );
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Não aborta o backfill por causa de um pedido com dados
      -- inconsistentes (ficha técnica deletada, item órfão, etc).
      v_failed := v_failed + 1;
      RAISE WARNING 'Falhou ao recalcular order_cost para (%, %): %',
        v_oc.sale_order_id, v_oc.sale_order_item_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Backfill order_costs: % recalculados, % pulados (finalizados/cancelados), % falharam.',
    v_processed, v_skipped, v_failed;
END;
$$;
