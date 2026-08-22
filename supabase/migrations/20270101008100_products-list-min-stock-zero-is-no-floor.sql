-- =============================================================================
-- v_products_list — min_stock = 0 é "sem piso", status usa ATP
-- =============================================================================
-- Espelha ProductTable.getStockStatus (2026-08-21):
--   disponível = quantity - reserved_stock
--   min_stock 0/null NÃO vira 1 (era o || 1 do JS antigo)
--   só pinta Crítico/Baixo por piso quando min_stock > 0
--   disponível <= 0 continua Crítico
--
-- CREATE OR REPLACE mantém grants e security_invoker da view original.
-- =============================================================================

DROP VIEW IF EXISTS public.v_products_list;

CREATE VIEW public.v_products_list
WITH (security_invoker = true) AS
SELECT
  p.*,

  -- Campos derivados que a busca client-side cobria e o banco não expunha.
  COALESCE(g.name, '')            AS group_name,
  g.consumption_unit              AS group_consumption_unit,
  COALESCE(inprod.qty, 0)         AS in_production_quantity,

  -- Status de estoque — espelha ProductTable.getStockStatus:
  --   disponível = quantity - reserved
  --   min_stock = 0 significa "sem piso" (só Crítico se disponível <= 0)
  --   nunca trata 0 como 1.
  CASE
    WHEN COALESCE(p.min_stock, 0) = 0 THEN NULL
    ELSE (COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0)) / p.min_stock
  END                              AS stock_ratio,

  (
    (COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0)) <= 0
    OR (
      COALESCE(p.min_stock, 0) > 0
      AND (COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0)) / p.min_stock <= 0.5
    )
  )                                AS is_critical,

  (
    (COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0)) <= 0
    OR (
      COALESCE(p.min_stock, 0) > 0
      AND (COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0)) / p.min_stock <= 1.0
    )
  )                                AS is_low,

  (NULLIF(COALESCE(p.max_stock, 0), 0) IS NOT NULL
   AND COALESCE(p.quantity, 0) > NULLIF(COALESCE(p.max_stock, 0), 0)
  )                                AS is_overstock,

  -- Chips "esconder zeradas" / "só com falta" da aba Materiais, que rodavam em
  -- JS sobre a lista já baixada. Falta = reserva mordendo saldo — pode ser
  -- negativa com quantidade > 0, por isso NÃO é o mesmo teste que zerada.
  (COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0))
                                   AS available_stock,
  (COALESCE(p.quantity, 0) <= 0)   AS is_zerada,
  (COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0) < 0)
                                   AS is_falta,

  -- Ordenação. Com paginação REAL, ordenar na tela ordena só as 50 linhas da
  -- página — "os 10 materiais de maior valor" sairia errado sempre que o maior
  -- estivesse na página 2. Por isso todo critério de ordenação da tela vira
  -- coluna aqui.
  (COALESCE(p.quantity, 0) * COALESCE(p.unit_price, 0))
                                   AS total_value,

  -- Espelha getEstPairs(): pares estimados = saldo ÷ consumo médio por par.
  -- Média de sheet_materials.quantity_per_unit, ignorando linha sem consumo.
  FLOOR(
    COALESCE(p.quantity, 0) / NULLIF(consumo.media, 0)
  )                                AS est_pairs,
  consumo.media                    AS avg_consumption,

  -- Ordem do status: Crítico(0) < Baixo(1) < Normal(2), igual ao statusOrder da
  -- tabela.
  CASE
    WHEN (COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0)) <= 0 THEN 0
    WHEN COALESCE(p.min_stock, 0) = 0 THEN 2
    WHEN (COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0)) / p.min_stock <= 0.5 THEN 0
    WHEN (COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0)) / p.min_stock <= 1.0 THEN 1
    ELSE 2
  END                              AS status_rank,

  -- Categoria normalizada, NUNCA nula. O TS comparava
  -- `(p.category || '').toLowerCase()`, então categoria nula virava '' e
  -- PASSAVA no filtro de exclusão. Um `.not('category','ilike',…)` direto no
  -- PostgREST descartaria essas linhas (NULL não satisfaz o predicado) — a
  -- coluna com COALESCE mantém o comportamento antigo intacto.
  lower(COALESCE(p.category, ''))  AS category_norm,

  -- Busca: os 4 campos de `products.search_norm` MAIS o nome do grupo.
  public.normalize_search(
    COALESCE(p.name, '')           || ' ' ||
    COALESCE(p.sku, '')            || ' ' ||
    COALESCE(p.color, '')          || ' ' ||
    COALESCE(p.technical_name, '') || ' ' ||
    COALESCE(g.name, '')
  )                                AS search_all

FROM public.products p
LEFT JOIN public.product_groups g
  ON g.id = p.group_id
-- Espelha get_in_production_stock(). Inline em vez de chamar a função porque
-- ela é SECURITY DEFINER — chamá-la de uma view security_invoker reabriria o
-- bypass de RLS que o invoker fecha.
LEFT JOIN LATERAL (
  SELECT SUM(sm.quantity) AS qty
  FROM public.stock_movements sm
  JOIN public.orders o ON o.id = sm.order_id
  WHERE sm.product_id = p.id
    AND sm.movement_type = 'out'
    AND o.status IN ('Reservado', 'Em Produção')
) inprod ON TRUE
LEFT JOIN LATERAL (
  SELECT AVG(sm2.quantity_per_unit) AS media
  FROM public.sheet_materials sm2
  WHERE sm2.product_id = p.id
    AND sm2.quantity_per_unit > 0
) consumo ON TRUE;

COMMENT ON VIEW public.v_products_list IS 'Listagem de produtos com campos derivados (group_name, status de estoque, flags zerada/falta, ordenacao, search_all) pra busca, filtro e ordenacao server-side. Espelha usePaginatedProducts + ProductTable. security_invoker: RLS de products continua valendo.';

GRANT SELECT ON public.v_products_list TO authenticated;
