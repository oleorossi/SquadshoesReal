-- =============================================================================
-- 20260627124000 — RECREATE v_order_profitability com total_packaging
-- =============================================================================
--
-- Bug B2: coluna packaging_cost foi adicionada à order_costs em
-- 20260524220000 (round 11), mas v_order_profitability nunca foi atualizada.
-- Resultado: total_material + total_labor + total_overhead ≠ total_cost
-- nos relatórios (faltava a parcela de embalagem).
--
-- Fix: drop+recreate da view adicionando total_packaging na seleção.

DROP VIEW IF EXISTS public.v_order_profitability CASCADE;
CREATE VIEW public.v_order_profitability
WITH (security_invoker = true) AS
SELECT
  so.id AS sale_order_id,
  so.order_number,
  so.client_name,
  so.status,
  SUM(oc.quantity)        AS total_units,
  SUM(oc.material_cost)   AS total_material,
  SUM(oc.labor_cost)      AS total_labor,
  SUM(oc.overhead_cost)   AS total_overhead,
  SUM(oc.packaging_cost)  AS total_packaging,
  SUM(oc.total_cost)      AS total_cost,
  SUM(oc.revenue)         AS total_revenue,
  SUM(oc.margin)          AS total_margin,
  CASE WHEN SUM(oc.revenue) > 0
       THEN SUM(oc.margin) / SUM(oc.revenue)
       ELSE 0 END         AS margin_pct,
  MAX(oc.calculated_at)   AS last_calculated_at
FROM public.sale_orders so
LEFT JOIN public.order_costs oc ON oc.sale_order_id = so.id
GROUP BY so.id, so.order_number, so.client_name, so.status;

COMMENT ON VIEW public.v_order_profitability IS
  'Custo/receita/margem agregada por PV. Adicionada total_packaging em 27/jun '
  '(B2 da auditoria): antes a view ignorava packaging_cost e os sub-totais '
  'não fechavam o total_cost.';
