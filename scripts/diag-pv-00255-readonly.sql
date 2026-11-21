-- Leitura. Não grava pedido, OP nem fila.
SELECT so.order_number,
       so.status,
       so.updated_at,
       so.created_at,
       so.command_phase,
       so.command_error
  FROM public.sale_orders so
 WHERE so.id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
    OR so.order_number IN ('PV-00255', 'PV-00236', 'PV-2026-00083');

SELECT soi.id,
       ts.code,
       soi.color,
       soi.production_excluded_at,
       public.atelier_reference_street_sectors(soi.reference_id) AS sectors,
       public.atelier_item_block_reason(soi.id) AS atelier_reason,
       public.sale_order_item_factory_gate_block_reason(soi.id) AS gate_reason
  FROM public.sale_order_items soi
  LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
 WHERE soi.sale_order_id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7';

SELECT j.id, j.command_name, j.status, j.target_status, j.completed_at, j.last_error, j.receipt_id
  FROM public.sale_order_materialization_jobs j
 WHERE j.id = 'c70ae8e6-62fd-4aa5-9e20-f2dc204dc59c'
    OR j.sale_order_id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
 ORDER BY j.created_at;

SELECT r.command_name,
       r.status,
       r.completed_at,
       left(COALESCE(r.error_message, ''), 400) AS error_message,
       left(COALESCE(r.response::text, ''), 2000) AS response_head
  FROM public.sale_order_command_receipts r
 WHERE r.sale_order_id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
 ORDER BY r.created_at;

SELECT so.order_number,
       o.order_number AS op,
       o.status AS op_status,
       o.deleted_at,
       o.updated_at AS op_updated_at,
       left(COALESCE(o.notes, ''), 200) AS notes
  FROM public.sale_orders so
  JOIN public.orders o ON o.sale_order_id = so.id
 WHERE so.order_number IN ('PV-00236', 'PV-2026-00083')
 ORDER BY so.order_number, o.deleted_at;

SELECT so.order_number,
       r.command_name,
       r.status,
       r.completed_at,
       r.created_at,
       left(COALESCE(r.error_message, ''), 200) AS error_message
  FROM public.sale_order_command_receipts r
  JOIN public.sale_orders so ON so.id = r.sale_order_id
 WHERE so.order_number IN ('PV-00236', 'PV-2026-00083')
   AND r.created_at >= '2026-11-16 13:00:00+00'
   AND r.created_at < '2026-11-16 16:00:00+00'
 ORDER BY r.created_at;

SELECT so.order_number
  FROM public.sale_orders so
 WHERE so.deleted_at IS NULL
   AND so.status = 'Em Produção'
   AND so.order_number IS DISTINCT FROM 'PV-00249'
   AND NOT EXISTS (
     SELECT 1
       FROM public.orders production_order
      WHERE production_order.sale_order_id = so.id
        AND production_order.deleted_at IS NULL
        AND COALESCE(production_order.status, '') NOT IN (
          'Cancelada', 'Cancelado', 'cancelled',
          'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
          'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
          'Faturado', 'Rascunho'
        )
   )
 ORDER BY so.order_number;
