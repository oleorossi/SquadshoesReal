-- ════════════════════════════════════════════════════════════════════════
-- Recebimento PARCIAL de Ordem de Compra (Fase C)
--
-- Hoje o recebimento de OC é tudo-ou-nada por item: `received_at` (timestamptz)
-- marca o item como recebido por completo (idempotência M6). Pra suportar
-- "receber 8 de 10", adicionamos a quantidade ACUMULADA já recebida por item.
--
--   received_quantity = quantidade já recebida (na MESMA unidade de `quantity`,
--                       ou seja, purchase_unit). 0 = nada recebido ainda.
--
-- received_at continua marcando a conclusão (received_quantity >= quantity), e
-- continua sendo o guard de idempotência dos recebimentos globais.
-- Backfill: itens já recebidos no modelo antigo (received_at preenchido) têm
-- received_quantity setado = quantity, pra ficarem consistentes com o novo cálculo.
-- ════════════════════════════════════════════════════════════════════════

alter table public.purchase_order_items
  add column if not exists received_quantity numeric not null default 0;

comment on column public.purchase_order_items.received_quantity is
  'Quantidade já recebida (acumulada), na mesma unidade de quantity (purchase_unit). 0 = nada. Recebimento parcial soma aqui; received_at marca quando fecha (>= quantity).';

-- Consistência retroativa: o que já estava recebido (modelo binário) conta como
-- recebido por completo.
update public.purchase_order_items
   set received_quantity = quantity
 where received_at is not null
   and coalesce(received_quantity, 0) = 0;
