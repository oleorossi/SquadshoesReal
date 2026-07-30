-- =============================================================================
-- VIEW: v_materials_config_issues (2026-05-30)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-30.
--
-- Identifica materiais com cadastro incompleto que prejudica o cálculo de
-- consumo/custeio. Pedido reportado: 'identificador no estoque para
-- materiais sem campo que influencie no consumo'.
--
-- 4 tipos de issue cobertos:
--   1. missing_width (critical) — linear m/cm usado em fichas sem largura
--      na ficha de componente. dm²→m linear não converte, consumo infla 100×
--   2. missing_conversion (critical) — purchase_unit ≠ unit sem
--      conversion_rate; entrada de NF entra com qty errada
--   3. zero_price (warning) — unit_price=0 em material usado em fichas
--      (não bloqueia consumo mas zera o custeio)
--   4. missing_yield (critical) — calculation_method='yield' sem
--      yield_per_meter
--
-- Frontend (commit relacionado):
--   - hook useMaterialsConfigIssues + useMaterialsConfigIssuesByProduct
--   - Badge tipo "sem largura/sem preço/sem conversão" na linha de cada
--     material em /estoque (MaterialsTab via ProductTable)
--   - Tooltip lista todas as issues do produto + descrição
-- =============================================================================

CREATE OR REPLACE VIEW public.v_materials_config_issues AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.color,
  pg.name AS group_name,
  'missing_width' AS issue_type,
  'critical' AS severity,
  'Largura da ficha de componente não cadastrada — consumo infla ~100×' AS description
FROM public.products p
LEFT JOIN public.product_groups pg ON pg.id = p.group_id
WHERE p.active = true
  AND LOWER(p.unit) IN ('m','meters','metros','mt','cm')
  AND NOT EXISTS (
    SELECT 1 FROM public.component_sheets cs
    WHERE (cs.product_id = p.id OR cs.group_id = p.group_id)
      AND COALESCE(cs.dimensions_width, 0) > 0
  )
  AND NOT (
    p.name ILIKE '%tira%' OR p.name ILIKE '%elastic%' OR p.name ILIKE '%strass%'
    OR p.name ILIKE '%tranç%' OR p.name ILIKE '%tranc%'
    OR COALESCE(pg.name, '') ILIKE '%tira%'
    OR COALESCE(pg.name, '') ILIKE '%elastic%'
    OR COALESCE(pg.name, '') ILIKE '%strass%'
  )
  AND (
    EXISTS (SELECT 1 FROM public.sheet_materials sm WHERE sm.product_id = p.id)
    OR EXISTS (
      SELECT 1 FROM public.technical_sheets ts
      WHERE LOWER(TRIM(COALESCE(ts.upper_material, ''))) = LOWER(TRIM(COALESCE(pg.name, '')))
         OR LOWER(TRIM(COALESCE(ts.lining_material, ''))) = LOWER(TRIM(COALESCE(pg.name, '')))
         OR LOWER(TRIM(COALESCE(ts.insole_material, ''))) = LOWER(TRIM(COALESCE(pg.name, '')))
    )
  )

UNION ALL

SELECT
  p.id, p.name, p.color, pg.name,
  'missing_conversion', 'critical',
  'Unidade de compra (' || COALESCE(p.purchase_unit, '?') || ') diferente do estoque (' || p.unit || ') sem taxa de conversão'
FROM public.products p
LEFT JOIN public.product_groups pg ON pg.id = p.group_id
WHERE p.active = true
  AND p.purchase_unit IS NOT NULL AND p.purchase_unit <> ''
  AND LOWER(TRIM(p.purchase_unit)) <> LOWER(TRIM(p.unit))
  AND COALESCE(p.conversion_rate, 0) = 0

UNION ALL

SELECT
  p.id, p.name, p.color, pg.name,
  'zero_price', 'warning',
  'Preço unitário zerado — custeio do produto fica incorreto'
FROM public.products p
LEFT JOIN public.product_groups pg ON pg.id = p.group_id
WHERE p.active = true
  AND COALESCE(p.unit_price, 0) = 0
  AND p.category <> 'Solado'
  AND EXISTS (SELECT 1 FROM public.sheet_materials sm WHERE sm.product_id = p.id)

UNION ALL

SELECT
  p.id, p.name, p.color, pg.name,
  'missing_yield', 'critical',
  'Método de cálculo "rendimento" sem yield_per_meter configurado'
FROM public.products p
LEFT JOIN public.product_groups pg ON pg.id = p.group_id
WHERE p.active = true
  AND p.calculation_method = 'yield'
  AND COALESCE(p.yield_per_meter, 0) = 0;

GRANT SELECT ON public.v_materials_config_issues TO authenticated;
