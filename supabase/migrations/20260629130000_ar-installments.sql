-- AR (accounts_receivable) — habilita parcelamento real baseado em payment_condition.
--
-- Antes: sale_order gerava 1 row em accounts_receivable. payment_condition
-- ("30/60/90 DIAS") era parseada só pro cálculo do desconto factoring; nunca
-- virava parcelas reais. Resultado: o financeiro nunca conseguia projetar
-- fluxo de caixa parcelado real e a "data de vencimento" do PV não batia
-- com o que o cliente prometeu pagar.
--
-- Agora: o frontend gera N rows (uma por parcela), preenchendo installment_number
-- (1..N) e total_installments (N). Esta migration:
--   1. Backfill: rows existentes com installment_number=NULL passam pra (1,1)
--      pra entrar na constraint sem colidir.
--   2. Unique index parcial: previne duplo-insert de mesma parcela em retry
--      ou race (1 PV não pode ter 2 rows com installment_number=2 ativos).

-- 1) Backfill — rows legacy: 1 parcela só, número 1 de 1.
UPDATE accounts_receivable
SET installment_number = 1, total_installments = 1
WHERE installment_number IS NULL AND total_installments IS NULL;

-- 2) Unique index parcial: cobre apenas (sale_order_id, installment_number) ativos
--    e não-cancelados. Rows cancelled podem coexistir com novas (ex.: PV cancelado
--    e refeito gera AR fresco sem conflitar com o histórico).
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_receivable_sale_order_installment
ON accounts_receivable(sale_order_id, installment_number)
WHERE sale_order_id IS NOT NULL
  AND installment_number IS NOT NULL
  AND status <> 'cancelled';

COMMENT ON INDEX uq_accounts_receivable_sale_order_installment IS
  'Prevenção de duplicata de parcela ativa por PV. Permite múltiplos cancelled na história.';
