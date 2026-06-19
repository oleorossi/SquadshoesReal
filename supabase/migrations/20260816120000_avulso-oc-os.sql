-- =============================================================================
-- LANÇAMENTO AVULSO DE OC E OS (manual → gera conta a pagar com data escolhida)
-- =============================================================================
-- Pedido do usuário: lançar Ordem de Compra (item de estoque) e Ordem de Serviço
-- (serviço) de forma MANUAL/AVULSA — selecionar o item/qtd/valor e a DATA DE
-- PAGAMENTO, gerando automaticamente a conta a pagar (accounts_payable) num só
-- passo, sem precisar abrir o financeiro depois.
--
-- Mudanças (DDL apenas; a integração financeira é app-side nos hooks):
--   1. purchase_orders.source_type passa a aceitar 'manual_avulsa' (distingue a
--      OC avulsa do MRP/per_pv na listagem e nos relatórios).
--   2. service_orders ganha payment_due_date (data de pagamento escolhida) +
--      is_avulsa (marca OS lançada avulsa — só serviço + financeiro, sem
--      produção/material vinculado).
--   3. Idempotência da conta a pagar da OC avulsa: unique index parcial em
--      accounts_payable(reference_id) WHERE reference_type='purchase_order'
--      (espelha o uq_ap_per_service_order que já existe pra OS).
--
-- Por que app-side e não trigger: a tela de OC já cria AP app-side
-- (createAPEntries em PurchaseOrders.tsx) — mantemos o mesmo caminho. A AP da OC
-- avulsa usa reference_type='purchase_order'; a da OS avulsa reusa
-- 'service_order' (protegida pelo uq_ap_per_service_order já existente). O
-- trigger de finalização de OS (tg_create_ap_for_service_order) NÃO duplica: ele
-- só cria AP quando a OS vai pra status finalizado E ainda não há AP pra aquele
-- reference_id (faz `IF EXISTS (...) RETURN NEW`).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. purchase_orders.source_type aceita 'manual_avulsa'
-- ----------------------------------------------------------------------------
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS chk_purchase_orders_source_type;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_source_type
  CHECK (source_type IN ('manual', 'mrp', 'per_pv', 'manual_avulsa'));

-- ----------------------------------------------------------------------------
-- 2. service_orders: payment_due_date + is_avulsa
-- ----------------------------------------------------------------------------
ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS payment_due_date date,
  ADD COLUMN IF NOT EXISTS is_avulsa boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.service_orders.payment_due_date IS
  'Data de pagamento escolhida no lançamento avulso da OS. A conta a pagar '
  '(accounts_payable) é criada com due_date = este valor.';
COMMENT ON COLUMN public.service_orders.is_avulsa IS
  'TRUE quando a OS foi lançada manualmente (avulsa) — sem produção/material '
  'vinculado, só serviço + financeiro.';

-- ----------------------------------------------------------------------------
-- 3. Idempotência da conta a pagar da OC avulsa
-- ----------------------------------------------------------------------------
-- Espelha uq_ap_per_service_order. Só afeta linhas com reference_type=
-- 'purchase_order' (as OCs avulsas) — o fluxo normal de OC grava AP via token
-- [OC#id] em notes, SEM reference_type, então não colide com este índice.
DROP INDEX IF EXISTS public.uq_ap_per_purchase_order;
CREATE UNIQUE INDEX uq_ap_per_purchase_order
  ON public.accounts_payable (reference_id)
  WHERE reference_type = 'purchase_order';
