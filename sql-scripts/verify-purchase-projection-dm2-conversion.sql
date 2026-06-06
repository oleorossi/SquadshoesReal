-- =============================================================================
-- VALIDAÇÃO: conversão dm²→unidade física em purchase_projection_timeline
-- (migration 20260720150000_fix-purchase-projection-timeline-dm2-conversion.sql)
--
-- Rode DEPOIS de aplicar a migration. A própria view já traz o valor BRUTO
-- (pré-conversão) na coluna `quantidade_necessaria_bruta` e o convertido em
-- `quantidade_necessaria` — então o "antes × depois" sai numa query só.
-- =============================================================================

-- ── 1. Materiais de ÁREA (napa/couro/forro) onde a conversão atua: bruto deve
--      cair de centenas/milhares de "m" para dezenas. Olhar `fator_reducao`.
SELECT
  pedido_ref,
  material,
  grupo_material,
  unidade,
  conversao_dm2,                                   -- 'linear' | 'placa' | 'none'
  ROUND(quantidade_necessaria_bruta, 1) AS antes,  -- dm²/par × qtd (cru, ~100× p/ área)
  ROUND(quantidade_necessaria,        1) AS depois, -- convertido p/ a unidade do produto
  ROUND(quantidade_necessaria_bruta
        / NULLIF(quantidade_necessaria, 0), 1) AS fator_reducao,
  estoque_atual
FROM public.purchase_projection_timeline
WHERE conversao_dm2 <> 'none'
  AND (LOWER(material) LIKE '%napa%'
       OR LOWER(material) LIKE '%couro%'
       OR LOWER(material) LIKE '%forro%'
       OR LOWER(grupo_material) LIKE '%napa%'
       OR LOWER(grupo_material) LIKE '%couro%'
       OR LOWER(grupo_material) LIKE '%forro%')
ORDER BY fator_reducao DESC NULLS LAST
LIMIT 50;

-- ── 2. Sanidade: itens NÃO convertidos (tiras/elásticos diretos, un/par, kg/g,
--      dm²-em-dm²) devem ter antes == depois (fator = 1).
SELECT
  conversao_dm2,
  COUNT(*)                                                   AS linhas,
  COUNT(*) FILTER (WHERE quantidade_necessaria_bruta
                        = quantidade_necessaria)             AS inalteradas,
  ROUND(AVG(quantidade_necessaria_bruta
            / NULLIF(quantidade_necessaria, 0)), 2)          AS fator_medio
FROM public.purchase_projection_timeline
GROUP BY conversao_dm2
ORDER BY conversao_dm2;

-- ── 3. (Opcional) Foco numa OP específica com napa — troque o pedido_ref.
-- SELECT material, unidade, conversao_dm2,
--        ROUND(quantidade_necessaria_bruta,1) AS antes,
--        ROUND(quantidade_necessaria,1)        AS depois
-- FROM public.purchase_projection_timeline
-- WHERE pedido_ref = 'OP-XXXXX'
-- ORDER BY conversao_dm2, material;
