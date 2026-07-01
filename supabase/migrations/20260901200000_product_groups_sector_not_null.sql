-- ============================================================================
-- product_groups.sector: torna NOT NULL (fecha a brecha da migration anterior)
-- ============================================================================
-- A migration 20260901140000 adicionou o CHECK de sector mas permitia NULL
-- "pra grupos legados/edge cases". Isso reabre exatamente o bug que aquela PR
-- fechou (produto herda categoria 'Componente' em silêncio via
-- fn_products_auto_category) caso QUALQUER caminho de insert em product_groups
-- fora dos dois diálogos de criação (que já exigem sector) seja usado — um
-- script de import futuro, por exemplo.
--
-- Hoje 0 dos 31 grupos têm sector nulo (verificado antes de aplicar) — seguro
-- exigir NOT NULL no banco, não só na UI.
-- ============================================================================

ALTER TABLE public.product_groups
  ALTER COLUMN sector SET NOT NULL;

ALTER TABLE public.product_groups
  DROP CONSTRAINT IF EXISTS product_groups_sector_check;

ALTER TABLE public.product_groups
  ADD CONSTRAINT product_groups_sector_check
  CHECK (
    sector IN (
      'Cabedal',
      'Forração da Palmilha',
      'Palmilha',
      'Cola / Químico',
      'Componente',
      'Embalagem',
      'Solado',
      'Ferramentas',
      'Fôrma'
    )
  );

COMMENT ON COLUMN public.product_groups.sector IS
  'Setor/categoria EXPLÍCITO e OBRIGATÓRIO do grupo (= products.category canônico). '
  'NOT NULL desde 2026-09-01 (2ª correção) — nenhum insert, seja pela UI ou por '
  'qualquer script/import futuro, pode mais criar grupo sem setor.';
