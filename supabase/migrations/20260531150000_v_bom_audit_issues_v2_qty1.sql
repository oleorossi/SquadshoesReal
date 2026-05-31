-- =============================================================================
-- VIEW v_bom_audit_issues v2: detecta qty_per_unit=1 em massa (2026-05-31)
-- =============================================================================
-- Aplicada via MCP em 2026-05-31.
--
-- Amplia o detector pra cobrir o segundo padrão do bulk insert:
-- quantity_per_unit = 1 em ≥80% dos itens da ficha (≥5 itens). Esse sintoma
-- indica que os componentes foram cadastrados com qty default, não com
-- consumo real fracionário (0.005 lata, 0.001 m, etc).
--
-- Frontend (CostsTab): warning ganha 2 categorias agora:
--   - bom_color_variants_inflated: ≥5 variantes-cor do mesmo grupo
--   - bom_default_qty_per_unit: ≥80% qty=1
-- =============================================================================

CREATE OR REPLACE VIEW public.v_bom_audit_issues AS
WITH bom_groups AS (
  SELECT
    sm.sheet_id, p.group_id, pg.name AS group_name,
    COUNT(*) AS variants_count,
    string_agg(DISTINCT NULLIF(p.color, ''), ', ' ORDER BY NULLIF(p.color, '')) AS colors_in_bom
  FROM public.sheet_materials sm
  JOIN public.products p ON p.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = p.group_id
  WHERE p.group_id IS NOT NULL
  GROUP BY sm.sheet_id, p.group_id, pg.name
  HAVING COUNT(*) >= 5
),
sheet_qty1_pattern AS (
  SELECT
    sm.sheet_id,
    NULL::uuid AS group_id,
    'BOM com consumo default'::text AS group_name,
    COUNT(*) AS variants_count,
    'qty_per_unit=1 em ' || COUNT(*) FILTER (WHERE sm.quantity_per_unit = 1) || ' de ' || COUNT(*) || ' itens' AS colors_in_bom
  FROM public.sheet_materials sm
  GROUP BY sm.sheet_id
  HAVING COUNT(*) >= 5
     AND COUNT(*) FILTER (WHERE sm.quantity_per_unit = 1) >= GREATEST(5, FLOOR(COUNT(*) * 0.8))
)
SELECT sheet_id, group_id, group_name, variants_count, colors_in_bom,
       'bom_color_variants_inflated' AS issue_type,
       CASE WHEN variants_count >= 10 THEN 'critical' ELSE 'warning' END AS severity
FROM bom_groups
UNION ALL
SELECT sheet_id, group_id, group_name, variants_count, colors_in_bom,
       'bom_default_qty_per_unit' AS issue_type,
       'critical' AS severity
FROM sheet_qty1_pattern;

GRANT SELECT ON public.v_bom_audit_issues TO authenticated;
