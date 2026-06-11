-- M6 (auditoria 2026-06-09): retry de recebimento de OC após falha parcial
-- re-creditava itens já lançados. Coluna received_at por item permite o
-- frontend pular itens já recebidos no retry (idempotência por item).
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS received_at timestamptz;
