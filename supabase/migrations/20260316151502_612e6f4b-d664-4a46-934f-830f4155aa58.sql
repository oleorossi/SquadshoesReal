-- Fix existing OPs that belong to PVs already "Em Produção" but are still "Reservado"
UPDATE public.orders
SET status = 'Em Produção', updated_at = now()
WHERE sale_order_id IN (
  SELECT id FROM public.sale_orders WHERE status = 'Em Produção'
)
AND status = 'Reservado';