-- ============================================================
-- MRP: Reserved / In-Production stock visibility
-- Adds:
--   1. get_in_production_stock()  – aggregate of out stock_movements
--                                   linked to active OPs
--   2. parse_iso_billing_week()   – parses '2026-W16' → Monday date
--   3. product_stock_with_reservations view (convenience)
-- ============================================================

-- 1. Returns (product_id, in_production_quantity) for every product
--    that has at least one out-movement on an active OP.
--    "Active OP" = status IN ('Reservado', 'Em Produção').
DROP FUNCTION IF EXISTS public.get_in_production_stock() CASCADE;
CREATE OR REPLACE FUNCTION public.get_in_production_stock()
RETURNS TABLE(product_id uuid, in_production_quantity numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sm.product_id,
    SUM(sm.quantity) AS in_production_quantity
  FROM stock_movements sm
  INNER JOIN orders o ON o.id = sm.order_id
  WHERE sm.movement_type = 'out'
    AND o.status IN ('Reservado', 'Em Produção')
  GROUP BY sm.product_id;
$$;

COMMENT ON FUNCTION public.get_in_production_stock IS
  'Returns the sum of out stock_movements linked to active OPs (Reservado / Em Produção). '
  'This represents material that has been hard-debited but is still being processed in production.';

-- 2. Parse ISO billing-week text (e.g. "2026-W16") to the Monday of that week.
DROP FUNCTION IF EXISTS public.parse_iso_billing_week(p_text text) CASCADE;
CREATE OR REPLACE FUNCTION public.parse_iso_billing_week(p_text text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_year  int;
  v_week  int;
  v_jan4  date;
  v_dow   int;  -- 0 = Mon … 6 = Sun
  v_w1mon date;
BEGIN
  IF p_text ~ '^\d{4}-W\d{1,2}$' THEN
    v_year  := split_part(p_text, '-W', 1)::int;
    v_week  := split_part(p_text, '-W', 2)::int;
    v_jan4  := make_date(v_year, 1, 4);
    -- ISODOW: 1=Mon … 7=Sun  →  subtract (isodow-1) to reach Monday
    v_dow   := (EXTRACT(ISODOW FROM v_jan4)::int) - 1;
    v_w1mon := v_jan4 - v_dow;
    RETURN v_w1mon + ((v_week - 1) * 7);
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.parse_iso_billing_week IS
  'Converts an ISO week string like "2026-W16" to the Monday date of that week.';

-- 3. Convenience view: products enriched with soft-reserved and in-production quantities.
--    • reserved_quantity  – soft reservations from material_reservations (status = reserved/partially_consumed)
--    • in_production_quantity – hard-debited materials still in active OPs (from stock_movements)
--    • available_quantity – products.quantity (free stock after debits)
DROP VIEW IF EXISTS public.product_stock_with_reservations CASCADE;
CREATE OR REPLACE VIEW public.product_stock_with_reservations AS
SELECT
  p.*,
  COALESCE(r.reserved_qty, 0)    AS reserved_quantity,
  COALESCE(ip.in_prod_qty, 0)    AS in_production_quantity,
  GREATEST(0, p.quantity - COALESCE(r.reserved_qty, 0)) AS available_quantity
FROM public.products p
LEFT JOIN (
  SELECT
    product_id,
    SUM(GREATEST(0, quantity_reserved - COALESCE(quantity_consumed, 0))) AS reserved_qty
  FROM public.material_reservations
  WHERE status IN ('reserved', 'partially_consumed')
  GROUP BY product_id
) r ON r.product_id = p.id
LEFT JOIN (
  SELECT sm.product_id, SUM(sm.quantity) AS in_prod_qty
  FROM public.stock_movements sm
  INNER JOIN public.orders o ON o.id = sm.order_id
  WHERE sm.movement_type = 'out'
    AND o.status IN ('Reservado', 'Em Produção')
  GROUP BY sm.product_id
) ip ON ip.product_id = p.id;

COMMENT ON VIEW public.product_stock_with_reservations IS
  'Products with additional stock breakdown: soft reservations and in-production quantities.';
