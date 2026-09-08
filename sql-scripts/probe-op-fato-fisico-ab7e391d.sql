-- =============================================================================
-- Probe pontual: OP do toast "possui fato físico; cancelamento automático
-- recusado" (print 2026-09-08).
-- =============================================================================
-- UUID do toast: ab7e391d-d325-467e-a383-576e79311e6c
-- Somente leitura. Diz QUAL predicado de fato físico disparou.
-- =============================================================================

WITH target AS (
  SELECT o.id, o.order_number, o.status, o.sale_order_id
    FROM public.orders o
   WHERE o.id = 'ab7e391d-d325-467e-a383-576e79311e6c'
),
pv AS (
  SELECT so.id, so.order_number, so.status, so.client_name
    FROM public.sale_orders so
    JOIN target t ON t.sale_order_id = so.id
)
SELECT
  'identidade' AS secao,
  pv.order_number AS pv,
  pv.status AS pv_status,
  pv.client_name,
  t.order_number AS op,
  t.status AS op_status,
  t.id AS op_id,
  NULL::text AS fact_kind,
  NULL::text AS detail
FROM target t
CROSS JOIN pv

UNION ALL

SELECT
  'fato',
  pv.order_number,
  pv.status,
  NULL,
  t.order_number,
  t.status,
  t.id,
  'stage',
  format(
    'quantity_processed=%s started_at=%s completed_at=%s status=%s',
    os.quantity_processed, os.started_at, os.completed_at, os.status
  )
FROM target t
CROSS JOIN pv
JOIN public.order_stages os ON os.order_id = t.id
WHERE COALESCE(os.quantity_processed, 0) > 0
   OR os.started_at IS NOT NULL
   OR os.completed_at IS NOT NULL
   OR lower(COALESCE(os.status, '')) NOT IN ('', 'pendente', 'pending')

UNION ALL

SELECT
  'fato',
  pv.order_number,
  pv.status,
  NULL,
  t.order_number,
  t.status,
  t.id,
  'lot',
  format('started_at=%s completed_at=%s status=%s', ol.started_at, ol.completed_at, ol.status)
FROM target t
CROSS JOIN pv
JOIN public.order_lots ol ON ol.order_id = t.id
WHERE ol.started_at IS NOT NULL
   OR ol.completed_at IS NOT NULL
   OR lower(COALESCE(ol.status, '')) NOT IN ('', 'pendente', 'pending')

UNION ALL

SELECT
  'fato',
  pv.order_number,
  pv.status,
  NULL,
  t.order_number,
  t.status,
  t.id,
  'reservation',
  format(
    'status=%s quantity_consumed=%s consumed_at=%s',
    mr.status, mr.quantity_consumed, mr.consumed_at
  )
FROM target t
CROSS JOIN pv
JOIN public.material_reservations mr ON mr.order_id = t.id
WHERE COALESCE(mr.quantity_consumed, 0) > 0
   OR mr.consumed_at IS NOT NULL
   OR lower(COALESCE(mr.status, '')) IN (
     'consumed', 'converted', 'pending_reconciliation'
   )

UNION ALL

SELECT
  'fato',
  pv.order_number,
  pv.status,
  NULL,
  t.order_number,
  t.status,
  t.id,
  'consumption',
  format('actual_quantity=%s component=%s/%s', pc.actual_quantity, pc.component_type, pc.component_name)
FROM target t
CROSS JOIN pv
JOIN public.production_consumptions pc ON pc.order_id = t.id
WHERE pc.superseded_at IS NULL
  AND COALESCE(pc.actual_quantity, 0) > 0

ORDER BY secao, fact_kind;
