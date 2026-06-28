-- Forração multi-grupo — Fase 1: colunas de fundação (aplicada via MCP; sem comportamento novo).
-- technical_sheets.lining_materials: grupos ADICIONAIS de forro (Material 1 segue em
-- lining_material; extras aqui), espelhando components_accessories do cabedal.
-- sale_order_items.lining_colors: cores de forro SELECIONADAS no item (cada cor → seu
-- grupo) — define o que reserva/debita. Espelha strap_colors.
ALTER TABLE public.technical_sheets ADD COLUMN IF NOT EXISTS lining_materials jsonb DEFAULT NULL;
COMMENT ON COLUMN public.technical_sheets.lining_materials IS 'Grupos ADICIONAIS de forração (além de lining_material/Material 1). Array de {material, consumption, consumption_per_size, product_id?, label?}. Espelha components_accessories do cabedal; consumido conforme lining_colors selecionado no PV.';

ALTER TABLE public.sale_order_items ADD COLUMN IF NOT EXISTS lining_colors jsonb DEFAULT NULL;
COMMENT ON COLUMN public.sale_order_items.lining_colors IS 'Cores de forração SELECIONADAS neste item: array de {group, color}. Define o que reserva/debita (cada cor resolve seu grupo). Espelha strap_colors.';
