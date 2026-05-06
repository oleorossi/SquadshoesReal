
-- Add missing Corte stages for OPs in production that should have them
-- These OPs have technical sheets with 'Corte' in production_sectors but no Corte stage was created
INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
SELECT o.id, 'Corte', 1, 'pendente', o.quantity, 0
FROM public.orders o
JOIN public.technical_sheets ts ON o.reference_id = ts.id
WHERE o.status = 'Em Produção'
  AND ts.production_sectors::jsonb ? 'Corte'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_stages os 
    WHERE os.order_id = o.id AND os.stage_name = 'Corte'
  );
