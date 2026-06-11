-- ════════════════════════════════════════════════════════════════════════════
-- Fix ALTO (auditoria 2026-06-11) — report_material_needs_by_group obsoleta
-- ════════════════════════════════════════════════════════════════════════════
-- A view (aba "Planejamento Compras (DNA Solados)" em MrpPage) estava quebrada:
--   • JOIN orders o ON o.id = oi.sale_order_id  — a FK aponta para sale_orders
--   • WHERE o.status = 'confirmed'              — status inexistente (usa PT)
--   • m.current_stock                           — coluna legada (hoje products.quantity)
--   • bill_of_materials / sole_technical_specs  — BOM/specs legados (hoje sheet_materials)
-- Resultado: relatório SEMPRE vazio/incorreto em produção.
--
-- Reescrita fina sobre v_mrp_needs (motor de demanda já corrigido: converte
-- dm²→física pela largura da ficha e deduz reserva) + product_groups para o
-- nome do grupo. Mantém as mesmas colunas consumidas por useMaterialNeedsReport
-- (group_name, material_name, current_stock, total_needed, missing_qty, unit).

CREATE OR REPLACE VIEW public.report_material_needs_by_group AS
SELECT
  COALESCE(pg.name, NULLIF(n.category, ''), 'Sem grupo') AS group_name,
  n.product_name                                          AS material_name,
  n.on_hand                                               AS current_stock,
  n.projected_demand                                      AS total_needed,
  GREATEST(n.projected_demand - n.available_now, 0)       AS missing_qty,
  n.unit                                                  AS unit
FROM public.v_mrp_needs n
JOIN public.products p ON p.id = n.product_id
LEFT JOIN public.product_groups pg ON pg.id = p.group_id
WHERE n.projected_demand > 0
  AND GREATEST(n.projected_demand - n.available_now, 0) > 0;

ALTER VIEW public.report_material_needs_by_group SET (security_invoker = true);

COMMENT ON VIEW public.report_material_needs_by_group IS
  'Necessidade de material por grupo (aba DNA Solados). Reescrita sobre v_mrp_needs '
  '(demanda dos PVs ativos com conversão dm²→física + reserva deduzida). Substitui a '
  'versão legada quebrada (orders/confirmed/current_stock/bill_of_materials).';
