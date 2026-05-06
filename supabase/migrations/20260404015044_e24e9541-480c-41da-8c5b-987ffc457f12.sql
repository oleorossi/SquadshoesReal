
-- Remove tables from Realtime publication that are not actively subscribed to in the application code.
-- Keep only 'orders' and 'order_stages' which have active subscriptions.
ALTER PUBLICATION supabase_realtime DROP TABLE public.products;
ALTER PUBLICATION supabase_realtime DROP TABLE public.stock_movements;
ALTER PUBLICATION supabase_realtime DROP TABLE public.sale_orders;
ALTER PUBLICATION supabase_realtime DROP TABLE public.material_reservations;
ALTER PUBLICATION supabase_realtime DROP TABLE public.quality_records;
ALTER PUBLICATION supabase_realtime DROP TABLE public.picking_lists;
