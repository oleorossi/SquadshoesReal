-- Item #9 do roadmap (auditoria 30/05). Forecast simples sobre histórico de PVs.
-- Histórico hoje: 46 PVs em ~2.5 meses (mar-mai 2026). Modelo:
--   média_móvel_3m × momentum_factor (variação relativa últimos 2 meses)
-- Confiabilidade calibrada pelo número de meses com venda no histórico.

CREATE OR REPLACE VIEW public.v_demand_history_monthly AS
SELECT
  date_trunc('month', so.created_at)::date AS month,
  soi.reference_id,
  COALESCE(NULLIF(TRIM(soi.color), ''), '(sem cor)') AS color,
  COALESCE(ts.name, ts.model, ts.id::text) AS reference_name,
  SUM(GREATEST(soi.quantity - COALESCE(soi.qty_devolvida, 0), 0))::int AS pairs_sold,
  COUNT(DISTINCT soi.sale_order_id) AS orders_count
FROM public.sale_order_items soi
JOIN public.sale_orders so ON so.id = soi.sale_order_id
LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
WHERE so.status NOT IN ('Cancelado')
  AND so.created_at >= CURRENT_DATE - INTERVAL '12 months'
  AND soi.reference_id IS NOT NULL
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC;

ALTER VIEW public.v_demand_history_monthly SET (security_invoker = on);
GRANT SELECT ON public.v_demand_history_monthly TO authenticated;

CREATE OR REPLACE VIEW public.v_demand_forecast AS
WITH all_periods AS (
  SELECT date_trunc('month', CURRENT_DATE - (n || ' months')::interval)::date AS month
  FROM generate_series(1, 3) n
),
pairs AS (
  SELECT DISTINCT reference_id, color, reference_name FROM public.v_demand_history_monthly
),
matrix AS (
  SELECT p.reference_id, p.color, p.reference_name, ap.month
  FROM pairs p CROSS JOIN all_periods ap
),
filled AS (
  SELECT m.reference_id, m.color, m.reference_name, m.month,
         COALESCE(h.pairs_sold, 0) AS pairs_sold
  FROM matrix m
  LEFT JOIN public.v_demand_history_monthly h
    ON h.reference_id = m.reference_id AND h.color = m.color AND h.month = m.month
),
agg AS (
  SELECT
    reference_id, color, MIN(reference_name) AS reference_name,
    AVG(pairs_sold)::numeric AS avg_3m,
    SUM(pairs_sold)::int AS sum_3m,
    SUM(CASE WHEN pairs_sold > 0 THEN 1 ELSE 0 END)::int AS months_with_sales,
    MAX(CASE WHEN month = date_trunc('month', CURRENT_DATE - INTERVAL '1 month') THEN pairs_sold END) AS last_month,
    MAX(CASE WHEN month = date_trunc('month', CURRENT_DATE - INTERVAL '2 months') THEN pairs_sold END) AS prev_month
  FROM filled
  GROUP BY reference_id, color
)
SELECT
  reference_id, color, reference_name,
  ROUND(avg_3m, 1) AS avg_last_3_months,
  sum_3m AS sum_last_3_months,
  COALESCE(last_month, 0) AS last_month_sales,
  COALESCE(prev_month, 0) AS prev_month_sales,
  months_with_sales,
  CASE
    WHEN prev_month > 0 AND last_month > 0
      THEN LEAST(2.0, GREATEST(0.5, last_month::numeric / prev_month))
    ELSE 1.0
  END AS momentum_factor,
  ROUND(
    avg_3m * CASE
      WHEN prev_month > 0 AND last_month > 0
        THEN LEAST(2.0, GREATEST(0.5, last_month::numeric / prev_month))
      ELSE 1.0
    END
  )::int AS projected_next_month,
  CASE
    WHEN months_with_sales >= 3 THEN 'high'
    WHEN months_with_sales = 2 THEN 'medium'
    WHEN months_with_sales = 1 THEN 'low'
    ELSE 'none'
  END AS confidence
FROM agg
WHERE sum_3m > 0
ORDER BY projected_next_month DESC NULLS LAST;

ALTER VIEW public.v_demand_forecast SET (security_invoker = on);
GRANT SELECT ON public.v_demand_forecast TO authenticated;
