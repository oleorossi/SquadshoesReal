-- ============================================================================
-- FIX: get_purchase_projection() estava QUEBRADA (erro em toda chamada).
--
-- O CTE active_products faz `SELECT DISTINCT product_id FROM purchases` SEM
-- qualificar — e como a função é RETURNS TABLE(product_id uuid, ...), esse nome
-- também é uma variável PL/pgSQL. Sob plpgsql.variable_conflict=error (default),
-- a referência crua aborta com:
--   "column reference \"product_id\" is ambiguous".
-- Resultado: a tela de Projeção de Compras (PurchaseProjectionContent) e
-- qualquer consumidor do RPC ficavam mortos.
--
-- FIX: diretiva `#variable_conflict use_column` no topo do corpo — referências
-- ambíguas preferem a COLUNA (a função nunca lê as OUT vars por nome; só popula
-- via RETURN QUERY posicional). Robusto e mínimo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_purchase_projection(p_days integer DEFAULT 30)
 RETURNS TABLE(product_id uuid, product_name text, product_category text, color text, unit text, is_artisanal boolean, current_stock numeric, reserved_stock numeric, available_stock numeric, total_purchased_qty numeric, total_purchased_value numeric, purchase_count integer, last_purchase_date date, avg_unit_price numeric, consumed_qty numeric, avg_daily_consumption numeric, days_of_cover numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days integer, abc_class text, abc_cum_share numeric, suggested_min_stock numeric, suggested_reorder_qty numeric, recommendation text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_safety_factor numeric := 1.3;
  v_target_cover_days int := 30;
  v_high_stock_threshold int := 90;
BEGIN
  RETURN QUERY
  WITH
  purchases AS (
    SELECT
      poi.product_id,
      SUM(poi.quantity)                               AS qty,
      SUM(poi.quantity * COALESCE(poi.unit_price,0))  AS value,
      COUNT(DISTINCT poi.purchase_order_id)::int       AS po_count,
      MAX(po.created_at)::date                         AS last_date,
      AVG(NULLIF(poi.unit_price,0))                    AS avg_price
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE po.created_at >= now() - (p_days || ' days')::interval
      AND COALESCE(po.status,'pending') NOT IN ('cancelled','cancelado')
    GROUP BY poi.product_id
  ),
  consumption AS (
    SELECT
      sm.product_id,
      SUM(ABS(sm.quantity)) AS qty
    FROM stock_movements sm
    WHERE sm.created_at >= now() - (p_days || ' days')::interval
      AND (sm.movement_type IN ('out','consumo','sale','debit')
           OR sm.previous_stock > sm.new_stock)
    GROUP BY sm.product_id
  ),
  active_products AS (
    SELECT DISTINCT purchases.product_id FROM purchases
    UNION
    SELECT DISTINCT consumption.product_id FROM consumption
  ),
  abc AS (
    SELECT
      pu.product_id,
      pu.value,
      SUM(pu.value) OVER (ORDER BY pu.value DESC, pu.product_id) AS cum_value,
      SUM(pu.value) OVER ()                                       AS total_value
    FROM purchases pu WHERE pu.value > 0
  ),
  enriched AS (
    SELECT
      p.id              AS pid,
      p.name            AS pname,
      p.category        AS pcat,
      COALESCE(p.color,'') AS pcolor,
      COALESCE(p.unit,'un') AS punit,
      COALESCE(p.is_artisanal,false) AS p_is_artisanal,
      COALESCE(p.quantity,0)::numeric                                                           AS p_stock,
      COALESCE(p.reserved_stock,0)::numeric                                                      AS p_reserved,
      GREATEST(0, COALESCE(p.quantity,0) - COALESCE(p.reserved_stock,0))::numeric                AS p_avail,
      COALESCE(pu.qty,0)::numeric                                                                AS p_pqty,
      COALESCE(pu.value,0)::numeric                                                              AS p_pval,
      COALESCE(pu.po_count,0)::int                                                               AS p_pcount,
      pu.last_date                                                                               AS p_plast,
      pu.avg_price::numeric                                                                      AS p_pavg,
      COALESCE(c.qty,0)::numeric                                                                 AS p_cqty,
      (COALESCE(c.qty,0)::numeric / GREATEST(p_days,1)::numeric)                                 AS p_avg_daily,
      p.supplier_id                                                                              AS p_supid,
      sup.name                                                                                    AS p_supname,
      COALESCE(p.supplier_lead_time_days, 7)::int                                                 AS p_lead,
      CASE
        WHEN abc.product_id IS NULL THEN 'C'
        WHEN abc.total_value > 0 AND abc.cum_value <= abc.total_value * 0.80 THEN 'A'
        WHEN abc.total_value > 0 AND abc.cum_value <= abc.total_value * 0.95 THEN 'B'
        ELSE 'C'
      END AS p_abc,
      CASE WHEN abc.total_value > 0 THEN ROUND((abc.cum_value / abc.total_value)::numeric, 4) ELSE NULL END AS p_abc_share
    FROM active_products ap
    JOIN products p ON p.id = ap.product_id
    LEFT JOIN purchases pu ON pu.product_id = p.id
    LEFT JOIN consumption c ON c.product_id = p.id
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
    LEFT JOIN abc ON abc.product_id = p.id
  )
  SELECT
    e.pid,
    e.pname,
    e.pcat,
    e.pcolor,
    e.punit,
    e.p_is_artisanal,
    e.p_stock,
    e.p_reserved,
    e.p_avail,
    e.p_pqty,
    e.p_pval,
    e.p_pcount,
    e.p_plast,
    e.p_pavg,
    e.p_cqty,
    ROUND(e.p_avg_daily, 3) AS avg_daily_consumption,
    CASE WHEN e.p_avg_daily > 0
         THEN ROUND(e.p_avail / e.p_avg_daily, 1)
         ELSE NULL
    END AS days_of_cover,
    e.p_supid,
    e.p_supname,
    e.p_lead,
    e.p_abc,
    e.p_abc_share,
    CEIL(e.p_avg_daily * e.p_lead * v_safety_factor)::numeric AS suggested_min_stock,
    GREATEST(0,
      CEIL(e.p_avg_daily * (e.p_lead * v_safety_factor + v_target_cover_days)) - e.p_avail
    )::numeric AS suggested_reorder_qty,
    CASE
      WHEN e.p_avg_daily = 0 THEN 'INATIVO'
      WHEN e.p_avail / NULLIF(e.p_avg_daily,0) < e.p_lead THEN 'CRITICO_REPOR'
      WHEN e.p_avail / NULLIF(e.p_avg_daily,0) < e.p_lead * 1.5 THEN 'REPOR'
      WHEN e.p_avail / NULLIF(e.p_avg_daily,0) > v_high_stock_threshold THEN 'ESTOQUE_ALTO'
      ELSE 'OK'
    END AS recommendation
  FROM enriched e
  ORDER BY
    CASE e.p_abc WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
    e.p_pval DESC NULLS LAST,
    e.p_cqty DESC NULLS LAST;
END;
$function$;
