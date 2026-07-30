-- =============================================================================
-- SEED: bank_accounts default (Caixa Principal)
-- =============================================================================
-- bank_accounts estava vazia em produção. Sem isso, useFinanceAlerts
-- retornava balance=0 e mascarava cálculos de fluxo de caixa/cobertura.
-- Cria 1 conta default ('Caixa Principal') se não houver nenhuma ativa.
--
-- O usuário pode editar/excluir essa conta normalmente — é só um starter.
-- =============================================================================

INSERT INTO public.bank_accounts (name, bank_name, account_type, current_balance, active)
SELECT 'Caixa Principal', 'A definir', 'corrente', 0, true
WHERE NOT EXISTS (SELECT 1 FROM public.bank_accounts WHERE active = true);
