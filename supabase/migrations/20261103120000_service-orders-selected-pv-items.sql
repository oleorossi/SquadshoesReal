-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ OS: registrar QUAIS itens do PV a ordem de serviço cobre                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Problema: o atalho "Gerar OS" do PV deixa marcar um subconjunto dos itens
-- (a soma dos pares vira a Quantidade da OS), mas essa seleção NUNCA era
-- gravada. O único vestígio era o texto da descrição — que, pior, listava
-- SEMPRE todos os itens do pedido, ignorando o que o usuário desmarcou. Era
-- texto errado, não informação.
--
-- Consequência viva: reabrir qualquer OS no dialog de edição remarcava todos
-- os itens do PV; salvar um prazo ou um valor trocava silenciosamente o escopo
-- da OS.
--
-- Esta coluna passa a ser o registro de verdade. Dela derivamos, na LEITURA,
-- as ordens de produção da OS (`orders.sale_order_item_id`) — apoiado no
-- UNIQUE parcial de 1 OP ativa por item do PV (migration 20260429123049).
--
-- Por que derivar em vez de gravar o id da OP: a OS pode nascer ANTES das OPs
-- serem geradas. Gravando o item, o número da OP aparece sozinho assim que a
-- OP nascer (e sobrevive a um resync que recria a OP).
--
-- NULL  = OS antiga / criada fora do atalho — não há seleção registrada.
--         Os consumidores caem no comportamento de hoje (todas as OPs do PV).
-- '{}'  = seleção vazia registrada. Semanticamente diferente de NULL.

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS selected_sale_order_item_ids uuid[];

COMMENT ON COLUMN public.service_orders.selected_sale_order_item_ids IS
  'Itens do PV (sale_order_items.id) que esta OS cobre, marcados na criação. '
  'NULL = sem registro (OS anterior a 2026-11-03 ou criada fora do atalho do PV) — '
  'nesse caso os consumidores usam todas as OPs do sale_order_id. '
  'As OPs da OS são derivadas na leitura via orders.sale_order_item_id.';

-- Consulta quente: "as OPs desta OS" = orders WHERE sale_order_item_id = ANY(...).
-- O índice GIN serve o caminho inverso (achar as OS que cobrem um item), usado
-- pela busca e pela conferência OS × produção.
CREATE INDEX IF NOT EXISTS idx_service_orders_selected_pv_items
  ON public.service_orders USING gin (selected_sale_order_item_ids)
  WHERE selected_sale_order_item_ids IS NOT NULL;

-- ⚠ Sem backfill de propósito. Deduzir a seleção do texto da descrição antiga
-- herdaria a listagem "todos os itens" e gravaria isso como se fosse dado.
-- OS antiga mantém a descrição que já tem — nada nela regride.
