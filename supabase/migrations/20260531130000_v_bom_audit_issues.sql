-- =============================================================================
-- VIEW: v_bom_audit_issues — fichas com BOM suspeito (2026-05-31)
-- =============================================================================
-- Aplicada via MCP em 2026-05-31. Complementa o cleanup de variantes-cor.
-- Detecta fichas com grupos que têm ≥5 variantes no BOM (heurística).
--
-- Usado pelo frontend (CostsTab) pra warning quando o BOM provavelmente
-- está errado, sem bloquear edição.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_bom_audit_issues AS
WITH bom_groups AS (
  SELECT
    sm.sheet_id,
    p.group_id,
    pg.name AS group_name,
    COUNT(*) AS variants_count,
    string_agg(DISTINCT NULLIF(p.color, ''), ', ' ORDER BY NULLIF(p.color, '')) AS colors_in_bom
  FROM public.sheet_materials sm
  JOIN public.products p ON p.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = p.group_id
  WHERE p.group_id IS NOT NULL
  GROUP BY sm.sheet_id, p.group_id, pg.name
  HAVING COUNT(*) >= 5
)
SELECT
  sheet_id,
  group_id,
  group_name,
  variants_count,
  colors_in_bom,
  'bom_color_variants_inflated' AS issue_type,
  CASE WHEN variants_count >= 10 THEN 'critical' ELSE 'warning' END AS severity
FROM bom_groups;

GRANT SELECT ON public.v_bom_audit_issues TO authenticated;

COMMENT ON VIEW public.v_bom_audit_issues IS
  'Fichas técnicas com BOM inflado: grupos com ≥5 variantes-cor no mesmo BOM.';
