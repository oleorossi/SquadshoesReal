-- Batch 2 da auditoria Codex (2026-07-28): integridade de duplicidade + higiene.
-- JÁ APLICADA via Supabase MCP. Idempotente.

-- (1) Tabela-lixo `_tmp_fn_backup` (backup de 2 fontes de função, proname/def)
--     estava com RLS desligada → exposta a anon. Descartável.
drop table if exists public._tmp_fn_backup;

-- (2) NF-e: chave de acesso única → impede reimportar o mesmo XML e duplicar
--     nota/estoque/AP (fatia P07/P10). Parcial (ignora nulos/vazios).
create unique index if not exists uq_invoices_invoice_key
  on public.invoices (invoice_key)
  where invoice_key is not null and length(trim(invoice_key)) > 0;

-- (3) Contas a pagar: 1 linha por (NF, nº da parcela) → impede confirmar boleto/
--     parcelas 2× pra mesma NF (fatia P07/P10). Parcial.
create unique index if not exists uq_accounts_payable_invoice_installment
  on public.accounts_payable (invoice_id, installment_number)
  where invoice_id is not null and installment_number is not null;

-- NOTA: índice único de `accounts_payable.barcode` PENDENTE — existe 1 duplicata
-- real em produção (mesmo boleto, valores divergentes) que precisa de resolução
-- manual antes de criar o índice. Não removido automaticamente (registro financeiro).
