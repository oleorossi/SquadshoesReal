-- =============================================================================
-- CLEANUP FASE 2: purga total dos sheet_materials inflados (2026-05-31)
-- =============================================================================
-- Aplicada via MCP em 2026-05-31.
--
-- Continuação do cleanup_inflated_bom_color_variants. Após a fase 1, as 5
-- fichas CONFORTO ainda tinham 31 itens/ficha com TODOS quantity_per_unit=1
-- (default do bulk insert). Custo continuava em R$ 153,98/par contra
-- esperado de R$ 2-3/par.
--
-- Decisão: deletar TODOS sheet_materials das 5 fichas afetadas. O cabedal
-- principal vem das "Especificações por Componente" (upper_material +
-- upper_consumption_per_size). User reconstrói componentes auxiliares
-- (linhas/colas/elásticos) com qty fracionário correto quando precisar.
--
-- Resultado: 155 itens removidos. BOM = 0 nas 5 fichas. Custo agora
-- depende só de Especificações por Componente + Operações (BOM operations).
-- =============================================================================

WITH affected_sheets AS (
  SELECT id, code, name FROM public.technical_sheets
  WHERE name IN ('CF 03', 'CF 05 ', 'CF 07 ', 'CF 09 ', 'ST 10 ')
)
INSERT INTO public.sheet_materials_cleanup_log
  (sheet_id, sheet_code, sheet_name, product_id, product_name, product_color, group_name, unit_price, quantity_per_unit, reason)
SELECT
  sm.sheet_id, a.code, a.name,
  p.id, p.name, p.color,
  pg.name, p.unit_price, sm.quantity_per_unit,
  'bom_full_purge_qty1_2026_05_31'
FROM public.sheet_materials sm
JOIN affected_sheets a ON a.id = sm.sheet_id
JOIN public.products p ON p.id = sm.product_id
LEFT JOIN public.product_groups pg ON pg.id = p.group_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.sheet_materials_cleanup_log existing
  WHERE existing.sheet_id = sm.sheet_id
    AND existing.product_id = sm.product_id
    AND existing.reason = 'bom_full_purge_qty1_2026_05_31'
);

DELETE FROM public.sheet_materials sm
WHERE sm.sheet_id IN (
  SELECT id FROM public.technical_sheets
  WHERE name IN ('CF 03', 'CF 05 ', 'CF 07 ', 'CF 09 ', 'ST 10 ')
);
