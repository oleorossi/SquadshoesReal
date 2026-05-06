-- 1. Adiciona flag de costura nos produtos
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS requires_sewing BOOLEAN DEFAULT false;

-- 2. View de fila de costura adaptada ao schema real
-- Usa order_stages (que já rastreia setores) em vez de tabelas inexistentes
DROP VIEW IF EXISTS public.vw_costura_queue CASCADE;
CREATE OR REPLACE VIEW public.vw_costura_queue
WITH (security_invoker = true) AS
SELECT 
    o.id as order_id,
    o.order_number,
    ts.name as reference_name,
    ts.code as reference_code,
    o.color,
    o.quantity,
    o.grade,
    os.status as sewing_status,
    os.quantity_processed,
    os.quantity_total,
    o.sale_order_id,
    o.planned_start,
    o.planned_delivery
FROM public.orders o
JOIN public.order_stages os ON os.order_id = o.id
LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
WHERE os.stage_name IN ('Costura', 'Forração')
  AND o.status NOT IN ('Finalizada', 'Cancelada')
ORDER BY o.planned_start ASC NULLS LAST;