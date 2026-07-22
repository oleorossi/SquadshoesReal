-- ============================================================================
-- Fase 2 da auditoria de motores — Pacote P4 (COMPRAS), parte 4/4
--
-- F3-8 (baixo): duas views legadas MORTAS da era Lovable no caminho de compras:
--   • report_material_needs_by_group — JOIN estruturalmente impossível
--     (orders.id = sale_order_items.sale_order_id: id de OP × FK de PV nunca
--     casa), filtro o.status='confirmed' (status inexistente) e leitura das
--     tabelas legadas bill_of_materials/current_stock (0 rows). Retorna sempre
--     vazio — armadilha de reativação silenciosa.
--   • vw_material_projected_availability — referencia materials /
--     product_variants / production_orders / bill_of_materials (todas legadas,
--     0 rows). Retorna sempre vazio.
--
-- Verificado antes do DROP:
--   • pg_depend: NENHUMA view/regra dependente;
--   • repo TS: único consumidor era src/hooks/useMaterialNeedsReport.ts
--     (hook órfão — não importado por nenhuma tela), removido junto com
--     src/components/mrp/MaterialNeedsReport.tsx e as invalidations no-op da
--     query key 'material-needs-report' nesta mesma frente.
--
-- Idempotente (IF EXISTS), sem DML.
-- ============================================================================

DROP VIEW IF EXISTS public.report_material_needs_by_group;
DROP VIEW IF EXISTS public.vw_material_projected_availability;
