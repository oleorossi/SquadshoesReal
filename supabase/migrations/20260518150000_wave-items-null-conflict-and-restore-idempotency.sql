-- =============================================================================
-- Fix 1: production_wave_items ON CONFLICT null sole_product_id duplication
-- =============================================================================
-- The unique index on (wave_id, reference_id, sole_product_id, color) uses the
-- default Postgres NULL treatment: two NULL sole_product_ids are considered
-- DISTINCT. Any reference without a resolved sole (tira-only, artisanal) produces
-- a new row per sale-order-item instead of aggregating total_quantity, inflating
-- wave totals and production_wave_items row counts.
--
-- Fix: recreate the index with NULLS NOT DISTINCT (PG15+) so two rows with
-- sole_product_id IS NULL are treated as equal and the ON CONFLICT fires.
-- Note: Supabase (PG15+) supports NULLS NOT DISTINCT in CREATE UNIQUE INDEX.
-- =============================================================================

-- Drop the old index (may exist under different names across migration history)
DROP INDEX IF EXISTS public.idx_wave_items_unique;
DROP INDEX IF EXISTS public.production_wave_items_wave_id_reference_id_sole_product_id_c_key;
DO $$
BEGIN
  -- Also drop any constraint-backed unique index if present
  ALTER TABLE public.production_wave_items
    DROP CONSTRAINT IF EXISTS production_wave_items_wave_id_reference_id_sole_product_id_c_key;
EXCEPTION WHEN others THEN NULL;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wave_items_unique
  ON public.production_wave_items (wave_id, reference_id, COALESCE(sole_product_id, '00000000-0000-0000-0000-000000000000'::uuid), color)
  NULLS NOT DISTINCT;

-- =============================================================================
-- Fix 2: restore_product_stocks_for_order — skip phantom 0-quantity movement
-- =============================================================================
-- The idempotent restore (migration 20260508130000) correctly computes
-- net_credit = 0 on a second call and skips the quantity UPDATE, but it still
-- inserts a stock_movement row with quantity=0. Audit reports that sum absolute
-- movement values or count rows are distorted. Fix: add a guard before the
-- INSERT so the movement is only written when credit > 0.
-- =============================================================================

DROP FUNCTION IF EXISTS public.restore_product_stocks_for_order(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rec RECORD;
  v_current_qty numeric;
  v_net_credit numeric;
BEGIN
  FOR v_rec IN
    SELECT
      product_id,
      -- Net debit = total out − total in for this order
      COALESCE(SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN movement_type = 'in'  THEN quantity ELSE 0 END), 0) AS net_debit
    FROM public.stock_movements
    WHERE order_id = p_order_id
    GROUP BY product_id
  LOOP
    v_net_credit := v_rec.net_debit;  -- what we owe back
    IF v_net_credit <= 0 THEN CONTINUE; END IF;  -- already fully restored

    SELECT quantity INTO v_current_qty FROM public.products WHERE id = v_rec.product_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    UPDATE public.products
      SET quantity = v_current_qty + v_net_credit, updated_at = now()
      WHERE id = v_rec.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock, description, order_id
    ) VALUES (
      v_rec.product_id, 'in', v_net_credit,
      v_current_qty, v_current_qty + v_net_credit,
      'Restauração de estoque (cancelamento de OP)', p_order_id
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_product_stocks_for_order(uuid) TO authenticated;
