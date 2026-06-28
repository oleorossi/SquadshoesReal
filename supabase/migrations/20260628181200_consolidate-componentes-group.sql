-- Fase 1: consolida a dup do bucket "Componentes" (validado no gate 2026-06-28).
-- Componentes (dcf999dc): root chato, 3 aviamentos (Binóculo SANSIN, Fivela 12mm, Ilhós 51),
--   0 filhos / 0 fornecedor / 0 cor / 0 BOM.
-- COMPONENTES (c0ce741a): nó estrutural — pai de 4 subgrupos de tira + fornecedor + 1 produto.
-- Sobrevive o estrutural; migra os 3 produtos do dcf999dc e apaga o dcf999dc.
-- bom_part_sector_map(dcf999dc) cascateia no delete (FK ON DELETE CASCADE). Aplicada via MCP.
UPDATE public.products
SET group_id = 'c0ce741a-6035-4d4e-9c30-35bcecc4e833'
WHERE group_id = 'dcf999dc-ac70-4913-9a15-a61812408808';

DELETE FROM public.product_groups WHERE id = 'dcf999dc-ac70-4913-9a15-a61812408808';
