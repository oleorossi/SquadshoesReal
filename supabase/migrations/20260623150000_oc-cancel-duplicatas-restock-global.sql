-- Auditoria do setor de Ordem de Compra (2026-06-23) — limpeza de dados.
-- Aplicado via MCP em 2026-06-23 (ssvxfoybzmjlypnipqzn).
--
-- O gerador automático generateAutoPurchaseOrders (src/hooks/useSaleOrders.ts) só
-- deduplica OC pendente quando há supplier_id — o balde "Sem Fornecedor" (supplier_id
-- NULL) nunca era reusado, então CADA faturar PV / gerar OP criava uma OC NOVA idêntica
-- (mesmo cesto global "abaixo do mínimo"). Resultado: 14 OCs pendentes byte-idênticas
-- (10 itens, R$ 1.789,21 cada, mesmo conjunto de produtos), poluindo a lista.
--
-- O código foi corrigido (dedup do balde sem-fornecedor + idempotência per-PV +
-- linked_sale_order_ids + solados fora do caminho genérico). Esta migration limpa o
-- legado: cancela 13 das 14 duplicatas pendentes, mantendo OC-00160 (a mais recente),
-- que representa o restock global real. São OCs PENDING (não recebidas) → cancelar é
-- seguro/reversível (status='cancelled', sem tocar estoque/financeiro).
-- Idempotente: a condição (status='pending') não casa mais após o cancelamento.
UPDATE public.purchase_orders
SET status = 'cancelled',
    notes = COALESCE(notes,'') || ' — Cancelada: duplicata do restock global automático (mantida OC-00160). Auditoria do setor de OC 2026-06-23.',
    updated_at = now()
WHERE status = 'pending'
  AND auto_generated = true
  AND supplier_id IS NULL
  AND order_number IN (
    'OC-00111','OC-00113','OC-00115','OC-00117','OC-00119','OC-00121','OC-00123',
    'OC-00127','OC-00136','OC-00140','OC-00143','OC-00149','OC-00154'
  );
