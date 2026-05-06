DROP VIEW IF EXISTS public.vw_virtual_cfo_cashflow CASCADE;
CREATE OR REPLACE VIEW public.vw_virtual_cfo_cashflow
WITH (security_invoker = true)
AS
SELECT 
    'SAIDA'::text as tipo,
    due_date as data_movimento,
    amount as valor,
    category as categoria,
    status
FROM public.accounts_payable
WHERE status IN ('pending', 'overdue')

UNION ALL

SELECT 
    'ENTRADA'::text as tipo,
    due_date as data_movimento,
    amount as valor,
    category as categoria,
    status
FROM public.accounts_receivable
WHERE status IN ('pending', 'overdue');