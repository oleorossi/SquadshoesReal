-- =============================================================================
-- Projeção de Compras — análise estatística histórica
-- =============================================================================
-- Diferente do "Plano de Compras" (que olha pra demanda futura via PVs ativos),
-- a Projeção responde "o que vale deixar em estoque" baseado em comportamento
-- histórico (últimos N dias).
--
-- Métricas calculadas:
--   • Frequência e volume de compra (quantas vezes + quanto comprou)
--   • Velocidade de giro (consumo/dia)
--   • Cobertura atual (estoque / consumo médio)
--   • Curva ABC sobre VALOR de compra (Pareto 80/15/5)
--   • Estoque mínimo sugerido = lead_time × consumo_médio × 1.3 (30% safety)
--   • Quantidade sugerida pra reposição
--   • Recomendação: CRITICO_REPOR | REPOR | OK | ESTOQUE_ALTO | INATIVO
--
-- Critério de recomendação:
--   - CRITICO_REPOR  : days_of_cover < lead_time            (vai zerar)
--   - REPOR          : days_of_cover < lead_time × 1.5
--   - ESTOQUE_ALTO   : days_of_cover > 90 (estoque parado)
--   - INATIVO        : sem consumo nos N dias               (não comprar)
--   - OK             : os demais
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_purchase_projection(int);

CREATE OR REPLACE FUNCTION public.get_purchase_projection(p_days int DEFAULT 30)
RETURNS TABLE (
  product_id              uuid,
  product_name            text,
  product_category        text,
  color                   text,
  unit                    text,
  is_artisanal            boolean,
  current_stock           numeric,
  reserved_stock          numeric,
  available_stock         numeric,
  total_purchased_qty     numeric,
  total_purchased_value   numeric,
  purchase_count          int,
  last_purchase_date      date,
  avg_unit_price          numeric,
  consumed_qty            numeric,
  avg_daily_consumption   numeric,
  days_of_cover           numeric,
  supplier_id             uuid,
  supplier_name           text,
  supplier_lead_time_days int,
  abc_class               text,
  abc_cum_share           numeric,
  suggested_min_stock     numeric,
  suggested_reorder_qty   numeric,
  recommendation          text
)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn$
DECLARE
  v_safety_factor numeric := 1.3;        -- 30% margem de segurança
  v_target_cover_days int := 30;          -- objetivo: 30 dias de cobertura
  v_high_stock_threshold int := 90;       -- > 90 dias = estoque alto
BEGIN
  RETURN QUERY
  WITH
  -- 1) Compras dos últimos N dias por produto
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
  -- 2) Consumo dos últimos N dias (movement_type='out' OR quantity decrementing stock)
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
  -- 3) Base: produtos com compra OU consumo no período (ignora catálogo morto)
  active_products AS (
    SELECT DISTINCT product_id FROM purchases
    UNION
    SELECT DISTINCT product_id FROM consumption
  ),
  -- 4) Curva ABC sobre VALOR de compra (Pareto 80/95)
  abc AS (
    SELECT
      pu.product_id,
      pu.value,
      SUM(pu.value) OVER (ORDER BY pu.value DESC, pu.product_id) AS cum_value,
      SUM(pu.value) OVER ()                                       AS total_value
    FROM purchases pu WHERE pu.value > 0
  ),
  -- 5) Junta tudo com produto + fornecedor
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
    -- days_of_cover: NULL se não consumiu (divisão por zero)
    CASE WHEN e.p_avg_daily > 0
         THEN ROUND(e.p_avail / e.p_avg_daily, 1)
         ELSE NULL
    END AS days_of_cover,
    e.p_supid,
    e.p_supname,
    e.p_lead,
    e.p_abc,
    e.p_abc_share,
    -- min_stock sugerido = consumo_diário × lead_time × safety
    CEIL(e.p_avg_daily * e.p_lead * v_safety_factor)::numeric AS suggested_min_stock,
    -- reorder_qty = (min_stock alvo + cobertura desejada) − estoque atual
    GREATEST(0,
      CEIL(e.p_avg_daily * (e.p_lead * v_safety_factor + v_target_cover_days)) - e.p_avail
    )::numeric AS suggested_reorder_qty,
    -- Recomendação
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
$fn$;

GRANT EXECUTE ON FUNCTION public.get_purchase_projection(int) TO authenticated;

COMMENT ON FUNCTION public.get_purchase_projection(int) IS
  'Análise estatística histórica de compras. Para cada produto ativo nos '
  'últimos N dias retorna: volume comprado, frequência, consumo médio, '
  'cobertura atual, classe ABC (Pareto 80/95), reorder sugerido com 30% safety '
  'e recomendação (CRITICO_REPOR/REPOR/OK/ESTOQUE_ALTO/INATIVO). Use 30 ou 60 dias '
  'pra capturar sazonalidade. Não substitui o Plano de Compras (demanda) — '
  'complementa com lente histórica.';

-- ── Resumo agregado pra cards/KPIs ───────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_purchase_projection_summary(int);

CREATE OR REPLACE FUNCTION public.get_purchase_projection_summary(p_days int DEFAULT 30)
RETURNS TABLE (
  total_active_products    int,
  total_purchase_value     numeric,
  abc_a_count              int,
  abc_b_count              int,
  abc_c_count              int,
  critical_reorder_count   int,
  reorder_count            int,
  high_stock_count         int,
  inactive_count           int,
  ok_count                 int,
  total_reorder_value      numeric,
  top_5_categories         jsonb,
  top_10_colors            jsonb
)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN QUERY
  WITH proj AS (
    SELECT * FROM public.get_purchase_projection(p_days)
  ),
  cat_top AS (
    SELECT product_category,
           SUM(total_purchased_value) AS val,
           COUNT(*)::int AS items
    FROM proj WHERE total_purchased_value > 0 AND product_category IS NOT NULL
    GROUP BY product_category ORDER BY val DESC LIMIT 5
  ),
  color_top AS (
    SELECT color,
           SUM(total_purchased_qty) AS qty,
           COUNT(*)::int AS items
    FROM proj WHERE color != '' AND total_purchased_qty > 0
    GROUP BY color ORDER BY qty DESC LIMIT 10
  )
  SELECT
    COUNT(*)::int                                                      AS total_active,
    COALESCE(SUM(total_purchased_value),0)                             AS total_value,
    COUNT(*) FILTER (WHERE abc_class='A')::int                          AS a_count,
    COUNT(*) FILTER (WHERE abc_class='B')::int                          AS b_count,
    COUNT(*) FILTER (WHERE abc_class='C')::int                          AS c_count,
    COUNT(*) FILTER (WHERE recommendation='CRITICO_REPOR')::int          AS critical,
    COUNT(*) FILTER (WHERE recommendation='REPOR')::int                  AS reorder,
    COUNT(*) FILTER (WHERE recommendation='ESTOQUE_ALTO')::int           AS high,
    COUNT(*) FILTER (WHERE recommendation='INATIVO')::int                AS inactive,
    COUNT(*) FILTER (WHERE recommendation='OK')::int                     AS ok,
    COALESCE(SUM(suggested_reorder_qty * COALESCE(avg_unit_price,0)) FILTER
      (WHERE recommendation IN ('CRITICO_REPOR','REPOR')), 0)            AS reorder_value,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('category',product_category,'value',val,'items',items))
              FROM cat_top), '[]'::jsonb)                                AS cats,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('color',color,'qty',qty,'items',items))
              FROM color_top), '[]'::jsonb)                              AS colors
  FROM proj;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_purchase_projection_summary(int) TO authenticated;
