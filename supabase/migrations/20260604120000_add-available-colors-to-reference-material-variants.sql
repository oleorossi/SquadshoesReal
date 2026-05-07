-- =============================================================================
-- FIX: reference_material_variants.available_colors faltando
-- =============================================================================
-- Frontend usa available_colors em 4 arquivos:
--   - MaterialVariantsPanel.tsx (linhas 31, 45, 165, 250-251, 357-359)
--   - SaleOrderItemForm.tsx (linhas 304-305)
--   - useReferenceMaterialVariants.ts (linha 154 SELECT, 161 mapping, 171 type)
--
-- Erro reportado pelo usuário: "Falha ao carregar reference_material_variants:
-- column reference_material_variants.available_colors does not exist"
--
-- Significado: cada variação de material tem uma lista de cores disponíveis
-- pra aquela variação (ex: "Napa Soft pode ser comprada em Preto, Branco,
-- Caramelo"). Frontend lê pra popular dropdown de cores no item de PV.
--
-- Aplicada em produção via Supabase MCP em 2026-05-07.
-- =============================================================================

ALTER TABLE public.reference_material_variants
  ADD COLUMN IF NOT EXISTS available_colors text[] DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN public.reference_material_variants.available_colors IS
  'Lista de cores disponíveis para esta variação de material. '
  'Ex: ["Preto","Branco","Caramelo"]. Usada pelo SaleOrderItemForm '
  'pra popular o dropdown de cor no item de PV.';
