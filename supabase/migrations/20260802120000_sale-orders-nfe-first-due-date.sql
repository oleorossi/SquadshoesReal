-- 1ª data de vencimento escolhida na emissão da NF-e (faturamento antecipado).
-- Já aplicada em produção (ssvxfoybzmjlypnipqzn) via MCP; este arquivo rastreia
-- o schema no repo. Idempotente (ADD COLUMN IF NOT EXISTS).
--
-- Quando preenchida, as duplicatas da NF E as contas a receber são ancoradas
-- nesta data, e as parcelas seguintes seguem os MESMOS intervalos da
-- payment_condition (ex.: 60/75/90 → +0/+15/+15 a partir desta data).
-- NULL = comportamento padrão (base hoje/entrega + dias da condição).
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS nfe_first_due_date date;

COMMENT ON COLUMN public.sale_orders.nfe_first_due_date IS
  'Data de vencimento da 1ª parcela escolhida na emissão da NF-e (faturamento '
  'antecipado). Ancora as duplicatas da NF e as contas a receber; parcelas '
  'seguintes seguem os intervalos da payment_condition. NULL = base padrão.';
