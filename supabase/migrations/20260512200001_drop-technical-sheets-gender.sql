-- =============================================================================
-- 20260512200000 — DROP technical_sheets.gender (campo morto)
-- =============================================================================
-- Auditoria de fichas técnicas detectou que `gender` era um dead field:
--   - existia na tabela (text nullable)
--   - existia em SheetFormData + select de UI (Nova Ficha + edit form)
--   - NÃO era lido em nenhuma business logic
--   - NÃO era usado em filtros, busca, agrupamentos ou cálculos
--   - NÃO determinava capacidade, consumo ou roteiro produtivo
--
-- Frontend já foi atualizado pra não enviar/exibir o campo. Esta migration
-- finaliza removendo a coluna do banco. Backfill não necessário — coluna era
-- nullable e tinha conteúdo arbitrário.
-- =============================================================================

ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS gender;
