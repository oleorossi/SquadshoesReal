-- ============================================================================
-- Guarda-corpo pra organização de grupos de estoque (product_groups)
-- ============================================================================
-- Contexto: os dois fluxos de criação de grupo na UI (Groups.tsx e
-- GroupCreateDialog.tsx) foram unificados no GroupCreateDialog, que agora exige
-- Setor na criação e faz checagem de nome duplicado client-side. Esta migration
-- adiciona os backstops de banco correspondentes:
--   1) índice único case-insensitive em name — trava duplicata que escapar do
--      aviso da UI (ex.: import direto, script). Verificado antes de aplicar:
--      zero colisões nos 31 grupos existentes.
--   2) CHECK em sector — hoje é `text` livre; restringe aos 9 valores canônicos
--      de SECTOR_OPTIONS (src/lib/categoryFromGroup.ts), mesmo conjunto usado
--      pelo trigger fn_products_auto_category (migration 20260629140000).
--      Permite NULL (grupos legados/edge cases) — só valida quando preenchido.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS product_groups_name_ci_unique
  ON public.product_groups (lower(trim(name)));

ALTER TABLE public.product_groups
  ADD CONSTRAINT product_groups_sector_check
  CHECK (
    sector IS NULL OR sector IN (
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

COMMENT ON INDEX public.product_groups_name_ci_unique IS
  'Trava nome duplicado (case/espaço-insensitive). Backstop do aviso já feito na UI (GroupCreateDialog).';
COMMENT ON CONSTRAINT product_groups_sector_check ON public.product_groups IS
  'Setor deve ser um dos 9 valores canônicos de SECTOR_OPTIONS (src/lib/categoryFromGroup.ts).';
