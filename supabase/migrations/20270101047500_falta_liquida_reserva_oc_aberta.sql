-- Falta líquida: a necessidade que a compra enxerga desconta
--   1. empenho dos outros PVs e o empenho próprio (já feito em
--      compute_allocated_per_pv_purchase_need_lines);
--   2. saldo ainda aberto em OC comprometida.
--
-- Rascunho e sugestão automática per_pv NÃO cobrem. São o documento que
-- process_sale_order_purchase_shortages reescreve. Se entrassem na conta,
-- o worker veria a própria OC, zeraria a falta e cancelaria a compra.
-- OC aprovada/enviada/parcial, manual, MRP e strap_demand cobrem.
--
-- Fornecedor da linha: products.supplier_id, senão preferred_supplier_id.
-- Não mexe em quantidade, reserva nem OC já gravada.

CREATE OR REPLACE FUNCTION public.compute_per_pv_purchase_needs(p_pv_ids uuid[])
RETURNS TABLE(
  material_id uuid,
  product_name text,
  unit text,
  color text,
  needed_qty numeric,
  stock_qty numeric,
  shortage numeric,
  supplier_id uuid,
  supplier_name text,
  last_unit_price numeric,
  is_artisanal boolean,
  grade jsonb,
  color_mismatch boolean,
  conversion_warning text,
  shortage_grade jsonb,
  open_purchase_warning text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $function$
  WITH scope AS (
    SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::uuid[]) AS ids
      FROM (
        SELECT so.id
          FROM public.sale_orders so
         WHERE so.deleted_at IS NULL
           AND so.status IN ('Aprovado', 'Em Produção')
        UNION
        SELECT unnest(COALESCE(p_pv_ids, ARRAY[]::uuid[]))
      ) ids
  ),
  lines AS (
    SELECT l.*,
           public.resolve_billing_week_for_order(l.sale_order_id) AS billing_week,
           so.created_at AS sale_order_created_at
      FROM public.compute_allocated_per_pv_purchase_need_lines(
             (SELECT ids FROM scope),
             NULL
           ) l
      JOIN public.sale_orders so ON so.id = l.sale_order_id
  ),
  cover AS (
    SELECT poi.product_id,
           sum(greatest(
             0,
             COALESCE(poi.quantity, 0) - COALESCE(poi.received_quantity, 0)
           )) AS open_qty
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
     WHERE poi.product_id IS NOT NULL
       AND lower(COALESCE(po.status, '')) NOT IN (
             'cancelled', 'canceled', 'cancelada',
             'received', 'recebida', 'receiving'
           )
       AND NOT (
         COALESCE(po.auto_generated, false)
         AND po.source_type = 'per_pv'
         AND lower(COALESCE(po.status, '')) IN ('draft', 'suggested')
       )
       -- Napa da aba Tiras vai para o prestador. Não cobre a falta da fábrica.
       AND NOT EXISTS (
         SELECT 1
           FROM public.strap_atelier_jobs j
          WHERE j.purchase_order_id = po.id
       )
     GROUP BY poi.product_id
  ),
  ordered AS (
    SELECT l.*,
           COALESCE(sum(GREATEST(l.shortage, 0)) OVER (
             PARTITION BY l.material_id
             ORDER BY l.billing_week NULLS LAST,
                      l.sale_order_created_at,
                      l.sale_order_id,
                      COALESCE(l.color, '')
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS prior_shortage
      FROM lines l
  ),
  netted AS (
    SELECT o.*,
           public.sale_order_purchase_allocated_shortage(
             o.shortage,
             COALESCE(c.open_qty, 0),
             o.prior_shortage
           ) AS net_shortage,
           COALESCE(o.supplier_id, p.preferred_supplier_id) AS resolved_supplier_id,
           COALESCE(pref.name, o.supplier_name) AS resolved_supplier_name
      FROM ordered o
      LEFT JOIN cover c ON c.product_id = o.material_id
      LEFT JOIN public.products p ON p.id = o.material_id
      LEFT JOIN public.suppliers pref
        ON pref.id = COALESCE(o.supplier_id, p.preferred_supplier_id)
  ),
  target AS (
    SELECT n.*,
           CASE
             WHEN n.shortage > 0
              AND n.net_shortage < n.shortage
              AND jsonb_typeof(n.shortage_grade) = 'object'
             THEN (
               SELECT COALESCE(jsonb_object_agg(
                        e.key,
                        round((e.value #>> '{}')::numeric * n.net_shortage / n.shortage, 4)
                        ORDER BY e.key
                      ), '{}'::jsonb)
                 FROM jsonb_each(n.shortage_grade) e(key, value)
                WHERE left(e.key, 1) <> '_'
                  AND jsonb_typeof(e.value) = 'number'
                  AND round((e.value #>> '{}')::numeric * n.net_shortage / n.shortage, 4) > 0
             )
             ELSE n.shortage_grade
           END AS net_shortage_grade
      FROM netted n
     WHERE n.sale_order_id = ANY(COALESCE(p_pv_ids, ARRAY[]::uuid[]))
  ),
  grouped AS (
    SELECT t.material_id,
           max(t.product_name) AS product_name,
           max(t.unit) AS unit,
           t.color,
           sum(t.needed_qty) AS needed_qty,
           sum(GREATEST(0, t.needed_qty - t.net_shortage)) AS stock_qty,
           sum(t.net_shortage) AS shortage,
           max(t.resolved_supplier_id::text)::uuid AS supplier_id,
           max(t.resolved_supplier_name) AS supplier_name,
           max(t.last_unit_price) AS last_unit_price,
           bool_or(t.is_artisanal) AS is_artisanal,
           bool_or(t.color_mismatch) AS color_mismatch,
           max(t.conversion_warning) AS conversion_warning,
           max(t.open_purchase_warning) AS open_purchase_warning
      FROM target t
     GROUP BY t.material_id, t.color
  ),
  demand_grade_values AS (
    SELECT t.material_id,
           t.color,
           ge.key,
           sum((ge.value #>> '{}')::numeric) AS quantity
      FROM target t
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(t.grade) = 'object' THEN t.grade ELSE '{}'::jsonb END
      ) ge(key, value)
     WHERE left(ge.key, 1) <> '_'
       AND jsonb_typeof(ge.value) = 'number'
     GROUP BY t.material_id, t.color, ge.key
  ),
  demand_grades AS (
    SELECT d.material_id,
           d.color,
           jsonb_object_agg(d.key, d.quantity ORDER BY d.key) AS grade
      FROM demand_grade_values d
     WHERE d.quantity > 0
     GROUP BY d.material_id, d.color
  ),
  shortage_grades AS (
    SELECT s.material_id,
           s.color,
           jsonb_object_agg(s.key, s.quantity ORDER BY s.key) AS shortage_grade
      FROM (
        SELECT t.material_id,
               t.color,
               e.key,
               sum((e.value #>> '{}')::numeric) AS quantity
          FROM target t
          CROSS JOIN LATERAL jsonb_each(
            CASE WHEN jsonb_typeof(t.net_shortage_grade) = 'object'
                 THEN t.net_shortage_grade ELSE '{}'::jsonb END
          ) e(key, value)
         WHERE left(e.key, 1) <> '_'
           AND jsonb_typeof(e.value) = 'number'
         GROUP BY t.material_id, t.color, e.key
      ) s
     WHERE s.quantity > 0
     GROUP BY s.material_id, s.color
  )
  SELECT g.material_id,
         g.product_name,
         g.unit,
         g.color,
         g.needed_qty,
         g.stock_qty,
         g.shortage,
         g.supplier_id,
         g.supplier_name,
         g.last_unit_price,
         g.is_artisanal,
         dg.grade,
         g.color_mismatch,
         g.conversion_warning,
         sg.shortage_grade,
         g.open_purchase_warning
    FROM grouped g
    LEFT JOIN demand_grades dg
      ON dg.material_id = g.material_id
     AND dg.color IS NOT DISTINCT FROM g.color
    LEFT JOIN shortage_grades sg
      ON sg.material_id = g.material_id
     AND sg.color IS NOT DISTINCT FROM g.color
   ORDER BY g.supplier_name NULLS LAST, g.product_name, COALESCE(g.color, '');
$function$;

REVOKE ALL ON FUNCTION public.compute_per_pv_purchase_needs(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_per_pv_purchase_needs(uuid[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.compute_per_pv_purchase_needs(uuid[]) IS
  'Falta de compra do PV. Reservas: compute_allocated_per_pv_purchase_need_lines. '
  'OC aberta comprometida cobre o resto, uma vez, pela semana de faturamento. '
  'Rascunho/sugestão automática per_pv não cobre. Fornecedor: supplier_id, senão preferred_supplier_id.';
