-- ════════════════════════════════════════════════════════════════════════════
-- Fix ALTO (auditoria 2026-06-11) — v_sector_bottlenecks mascarava sobrecarga
-- ════════════════════════════════════════════════════════════════════════════
-- A capacidade da semana era média PONDERADA POR PARES da capacity por OP:
--   ROUND(SUM(capacity_per_day * quantity) / SUM(quantity) * 5)
-- Quando OPs do mesmo setor têm capacidades diferentes, a ponderação por
-- quantidade INFLA a capacidade efetiva e ESCONDE o gargalo (a OP grande de
-- capacidade alta domina a média e "cobre" a OP pequena de capacidade baixa).
-- Além disso multiplicava por 5 dias fixos, ignorando feriados.
--
-- Correção (modelo aditivo / dias de máquina):
--   dias_necessários = Σ(pares_i / capacidade_i)   — OP lenta consome mais dias
--   dias_disponíveis = dias úteis da semana (feriado-aware via biz_days_between)
--   utilização%      = dias_necessários / dias_disponíveis × 100
--   gargalo          = dias_necessários > dias_disponíveis
-- Capacidade da semana é reexpressa como os pares que cabem nos dias disponíveis
-- ao throughput combinado (consistente com a utilização). Colunas de saída
-- inalteradas (useSectorBottlenecks/CapacityOverflowDialog seguem funcionando).
-- Capacidade 0/NULL na ficha é ignorada (NULLIF) em vez de virar "0 throughput"
-- (evita div/0 e falso gargalo em setor não configurado).

CREATE OR REPLACE VIEW public.v_sector_bottlenecks
WITH (security_invoker = true) AS
WITH agg AS (
  SELECT
    sector,
    week_start,
    iso_year::int AS iso_year,
    iso_week::int AS iso_week,
    COUNT(DISTINCT order_id) AS ops_count,
    SUM(quantity)::numeric AS total_pairs,
    -- dias de máquina necessários no setor (aditivo, sem média ponderada)
    SUM(quantity::numeric / NULLIF(capacity_per_day, 0)) AS days_needed,
    -- dias úteis seg–sex da semana ISO (desconta feriados; inclusivo nas pontas)
    GREATEST(1, public.biz_days_between(week_start, (week_start + 4))) AS days_available,
    ARRAY_AGG(json_build_object(
      'order_id', order_id,
      'order_number', order_number,
      'sale_order_id', sale_order_id,
      'sheet_name', sheet_name,
      'color', color,
      'quantity', quantity,
      'planned_delivery', planned_delivery,
      'pairs_per_day', ROUND(pairs_per_day, 1)
    ) ORDER BY quantity DESC) AS contributing_orders
  FROM public.v_sector_weekly_load
  GROUP BY sector, week_start, iso_year, iso_week
)
SELECT
  sector,
  week_start,
  iso_year,
  iso_week,
  ops_count,
  total_pairs::int AS total_pairs_planned,
  -- pares que cabem nos dias disponíveis ao throughput combinado
  CASE WHEN COALESCE(days_needed, 0) > 0
       THEN ROUND(total_pairs * days_available / days_needed)::int
       ELSE 0 END AS total_capacity_week,
  CASE WHEN days_available > 0 AND COALESCE(days_needed, 0) > 0
       THEN ROUND(days_needed / days_available * 100)::int
       ELSE 0 END AS utilization_pct,
  (COALESCE(days_needed, 0) > days_available) AS is_bottleneck,
  CASE
    WHEN COALESCE(days_needed, 0) > days_available * 1.5 THEN 'critical'
    WHEN COALESCE(days_needed, 0) > days_available       THEN 'warning'
    ELSE 'ok'
  END AS severity,
  contributing_orders
FROM agg;

COMMENT ON VIEW public.v_sector_bottlenecks IS
  'Gargalos por (setor, semana ISO). Capacidade pelo modelo ADITIVO de dias de '
  'máquina (Σ pares/capacidade vs dias úteis da semana, feriado-aware) — substitui '
  'a média ponderada que mascarava sobrecarga quando OPs tinham capacidades '
  'diferentes. is_bottleneck=true quando dias necessários > dias disponíveis.';

GRANT SELECT ON public.v_sector_bottlenecks TO authenticated, service_role;
