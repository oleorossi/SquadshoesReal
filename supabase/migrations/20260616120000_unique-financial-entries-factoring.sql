-- Round 28 — Factoring audit fix
--
-- Round 26 introduziu reference_type='sale_order_factoring' em financial_entries
-- pra registrar a despesa financeira de juros como entry separada da receita.
-- A migration 20260524160000 já tinha criado UNIQUE pra reference_type='sale_order',
-- mas ESQUECEU de cobrir o novo reference_type. Race em retries do
-- syncFinancialRecords (concorrência de "Faturar" entre operadores ou
-- double-click no botão) pode duplicar a entry de juros, inflando despesas
-- financeiras na DRE.
--
-- Mesma estratégia da constraint anterior: índice parcial cobrindo só status
-- ativos (cancelado/estornado/cancelled podem coexistir como histórico).

CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_sale_order_factoring_unique
  ON public.financial_entries (reference_id)
  WHERE reference_type = 'sale_order_factoring'
    AND reference_id IS NOT NULL
    AND reference_id <> ''
    AND status NOT IN ('cancelado', 'cancelled', 'estornado');

-- Cleanup defensivo: se já houver duplicatas pré-existentes, consolida na mais
-- antiga. Não roda em produção limpa, mas garante idempotência se a migration
-- for aplicada num DB que já experimentou a race.
WITH duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY reference_id ORDER BY created_at ASC) AS rn
  FROM public.financial_entries
  WHERE reference_type = 'sale_order_factoring'
    AND reference_id IS NOT NULL
    AND reference_id <> ''
    AND status NOT IN ('cancelado', 'cancelled', 'estornado')
)
DELETE FROM public.financial_entries
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
