-- ---------------------------------------------------------------
-- 20260504150000_fn-projected-demand.sql
-- ---------------------------------------------------------------

-- DROP CASCADE para remover dependências (como v_mrp_needs)
DROP FUNCTION IF EXISTS public.fn_projected_demand() CASCADE;

CREATE OR REPLACE FUNCTION public.fn_projected_demand()
RETURNS TABLE (
  product_id       uuid,
  product_name     text,
  total_required   numeric,
  earliest_deadline timestamptz,
  orders_count     integer,
  order_ids        uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT
      so.id AS sale_order_id,
      so.delivery_deadline,
      soi.id AS sale_order_item_id,
      (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
         FROM public.calculate_order_consumption(
           soi.reference_id, soi.quantity, COALESCE(soi.color,''),
           (SELECT (key)::integer FROM jsonb_each_text(soi.grade)
              WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
         ) c) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE LOWER(COALESCE(so.status, '')) NOT IN (
            'cancelado', 'cancelada', 'cancelled',
            'entregue', 'delivered',
            'finalizado', 'finalizada', 'finished', 'completed',
            'faturado', 'faturada', 'invoiced'
          )
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT
      sale_order_id,
      delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')      AS product_name,
      (line ->> 'required')::numeric AS required
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  )
  SELECT
    e.product_id,
    MAX(e.product_name) AS product_name,
    SUM(e.required)     AS total_required,
    MIN(e.delivery_deadline) AS earliest_deadline,
    COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
    array_agg(DISTINCT e.sale_order_id) AS order_ids
  FROM exploded e
  WHERE e.product_id IS NOT NULL
  GROUP BY e.product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_projected_demand() TO authenticated;

-- Recriar a view v_mrp_needs que foi removida pelo CASCADE
-- Usando a coluna 'quantity' da tabela products conforme o schema real
DROP VIEW IF EXISTS public.v_mrp_needs CASCADE;
CREATE OR REPLACE VIEW public.v_mrp_needs AS
SELECT
    pd.product_id,
    pd.product_name,
    pd.total_required,
    p.quantity AS current_stock,
    (pd.total_required - COALESCE(p.quantity, 0)) AS balance,
    pd.earliest_deadline,
    pd.orders_count,
    pd.order_ids
FROM public.fn_projected_demand() pd
LEFT JOIN public.products p ON p.id = pd.product_id;

-- ---------------------------------------------------------------
-- 20260504160000_sale-order-total-integrity-trigger.sql
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.recalc_sale_order_total(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.recalc_sale_order_total(p_sale_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_sale_order_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(unit_price, 0)), 0)
    INTO v_total
    FROM public.sale_order_items
   WHERE sale_order_id = p_sale_order_id;

  v_total := round(v_total::numeric, 2);

  UPDATE public.sale_orders
     SET total = v_total,
         updated_at = now()
   WHERE id = p_sale_order_id
     AND COALESCE(total, 0) IS DISTINCT FROM v_total;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_sale_order_total(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.fn_sync_sale_order_total() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_sync_sale_order_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_target_id := OLD.sale_order_id;
    PERFORM public.recalc_sale_order_total(v_target_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id THEN
    PERFORM public.recalc_sale_order_total(OLD.sale_order_id);
    PERFORM public.recalc_sale_order_total(NEW.sale_order_id);
    RETURN NEW;
  ELSE
    PERFORM public.recalc_sale_order_total(NEW.sale_order_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sale_order_total ON public.sale_order_items;
CREATE TRIGGER trg_sync_sale_order_total
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_sale_order_total();

DO $$
DECLARE
  v_fixed integer := 0;
  v_so_id uuid;
BEGIN
  FOR v_so_id IN
    SELECT DISTINCT so.id
      FROM public.sale_orders so
      LEFT JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     GROUP BY so.id, so.total
    HAVING ABS(COALESCE(so.total, 0) - COALESCE(SUM(COALESCE(soi.quantity, 0) * COALESCE(soi.unit_price, 0)), 0)) > 0.01
  LOOP
    PERFORM public.recalc_sale_order_total(v_so_id);
    v_fixed := v_fixed + 1;
  END LOOP;
  RAISE NOTICE 'Backfill: % pedidos tiveram total reajustado.', v_fixed;
END;
$$;