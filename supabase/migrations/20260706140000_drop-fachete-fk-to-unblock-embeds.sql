-- Reverte FK products.fachete_material_group_id → product_groups(id).
--
-- O FK foi introduzido em 20260706_add_fachete_material_group_to_products.
-- Resultado: 2 FKs entre products e product_groups (group_id E
-- fachete_material_group_id). Toda query PostgREST que faz embed
-- `product_groups(...)` sem qualificar a relação passou a falhar com:
--
--   Could not embed because more than one relationship was found for
--   'products' and 'product_groups'
--
-- Afetava o useProducts/usePaginatedProducts (main loaders), além de:
-- SummaryConsumptionPanel, OrderConsumptionDialog, MaterialConsumptionTab,
-- ConversionReportTab, useTechnicalSheets, useLowStockAlerts, bomConsumption,
-- orderConsumption, labelUtils, Corte.tsx — total ~20 callsites.
--
-- Solução: drop só o FK. A coluna fachete_material_group_id continua
-- existindo (uuid) e ainda guarda a referência ao grupo de material do
-- fachete. Integridade de "grupo existe" verificada na aplicação quando
-- precisar (lookup via WHERE p.fachete_material_group_id = g.id). Não
-- embedamos esse grupo via PostgREST de qualquer forma.

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_fachete_material_group_id_fkey;

COMMENT ON COLUMN public.products.fachete_material_group_id IS
  'UUID do product_groups usado como fachete neste solado. SEM FK pra não ambiguar embeds do PostgREST — integridade verificada na aplicação.';
