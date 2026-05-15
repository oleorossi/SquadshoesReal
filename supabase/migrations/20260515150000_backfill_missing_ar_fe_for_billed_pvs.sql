-- Backfill: AR/FE faltantes nos PVs Faturado (auditoria do Financeiro)
-- Auditoria detectou 18 PVs Faturado sem accounts_receivable (R$ 122.850) e
-- 3 PVs Faturado sem financial_entry de receita (R$ 109.131). Causa: mudança
-- de status manual no DB que bypassou o syncFinancialRecords (função
-- frontend) que deveria criar essas linhas.
--
-- Backfill respeita o design: PVs "Finalizado s/ NF" e nfe_required=false
-- NÃO recebem AR/FE (são informais por design — useSaleOrders.ts:82).
-- PVs com is_factoring=true são pulados (cálculo de desconto exige config).

INSERT INTO public.accounts_receivable (
  sale_order_id, client_name, client_cnpj, description, category,
  due_date, amount, amount_received, status
)
SELECT
  so.id, COALESCE(so.client_name, ''), COALESCE(so.client_cnpj, ''),
  'Pedido ' || COALESCE(so.order_number, so.id::text),
  'venda',
  COALESCE(so.delivery_deadline, CURRENT_DATE),
  so.total, 0, 'pending'
FROM public.sale_orders so
WHERE so.status = 'Faturado'
  AND COALESCE(so.nfe_required, true) = true
  AND COALESCE(so.is_factoring, false) = false
  AND so.total > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts_receivable ar
    WHERE ar.sale_order_id = so.id AND ar.status <> 'cancelled'
  );

INSERT INTO public.financial_entries (
  description, amount, type, entry_date,
  reference_id, reference_type, status
)
SELECT
  'Faturamento - ' || COALESCE(so.client_name, '') || ' - ' || COALESCE(so.order_number, ''),
  so.total, 'receita', CURRENT_DATE,
  so.id::text, 'sale_order', 'confirmed'
FROM public.sale_orders so
WHERE so.status = 'Faturado'
  AND COALESCE(so.nfe_required, true) = true
  AND so.total > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.financial_entries fe
    WHERE fe.reference_type = 'sale_order'
      AND fe.reference_id = so.id::text
      AND fe.type = 'receita'
      AND fe.status NOT IN ('cancelado','cancelled','estornado')
  );
