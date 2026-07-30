-- Campo livre que o usuário preenche no PV e aparece nas
-- "informacoes_complementares" da NF-e emitida (concatenado com OC do cliente
-- e Pedido de Venda). Separado do campo `notes` (notas internas que não vão
-- pra NF). Pedido em 15/05/2026.
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS informacoes_complementares_nf TEXT;

COMMENT ON COLUMN public.sale_orders.informacoes_complementares_nf IS
  'Texto livre que aparece nas Informações Complementares da NF-e quando o pedido for faturado. Concatenado com client_order_number (OC do cliente) e PV.';
