-- =============================================================================
-- Grupo 23 — Cores por grupo de material (reference_material_variants)
-- =============================================================================
--
-- Problem: reference_material_variants armazena grupos de material como
-- NAPA SANTORINE, NAPA TITANIUM, NAPA SOFT, NAPA SUDANI — cada um com SKU/NCM
-- próprios para NF-e. Mas não havia como registrar QUAIS CORES cada material
-- oferece. O seletor de cor no pedido de venda mostrava todas as cores da
-- referência independente do material selecionado.
--
-- Esta migration adiciona `available_colors text[]` em
-- reference_material_variants. Quando preenchido, o formulário de pedido usa
-- apenas essas cores como opção após o cliente selecionar o grupo de material.
-- Quando vazio, o fallback são as cores derivadas da ficha técnica (BOM).
-- =============================================================================

ALTER TABLE public.reference_material_variants
  ADD COLUMN IF NOT EXISTS available_colors text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.reference_material_variants.available_colors IS
  'Cores disponíveis para este grupo de material. Array vazio = usa cores derivadas da ficha técnica (BOM). '
  'Quando preenchido, o seletor de cor no pedido de venda exibe apenas estas opções após o material ser escolhido.';
