-- Inclui PVs alvo em Rascunho/Pendente no canal Compras por Pedido.
--
-- Bug: compute_allocated_per_pv_purchase_need_lines e o twin de embalagem
-- só consideravam status Aprovado/Em Produção. Abrir OC de um PV Rascunho
-- (ex.: PV-00193) devolvia 0 linhas e a UI mentia "estoque cobre".
-- O consumo (annotateConsumptionAvailability) não filtra por status — certo.
--
-- Regra: competidores vivos continuam Aprovado/Em Produção; o ALVO em
-- Rascunho/Pendente entra só quando está em p_target_pv_ids / p_pv_ids,
-- pra rascunho alheio não roubar estoque na alocação FIFO.

CREATE OR REPLACE FUNCTION public.compute_allocated_per_pv_purchase_need_lines(
  p_target_pv_ids uuid[],
  p_product_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  sale_order_id uuid,
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
  WITH eligible_pvs AS (
    -- Competidores vivos + os PVs ALVO mesmo em Rascunho/Pendente.
    -- Rascunho fora de p_target_pv_ids NÃO entra (não rouba estoque de outro PV).
    SELECT so.id AS sale_order_id, so.created_at
      FROM public.sale_orders so
     WHERE so.deleted_at IS NULL
       AND (
         so.status IN ('Aprovado', 'Em Produção')
         OR (
           so.id = ANY(COALESCE(p_target_pv_ids, ARRAY[]::uuid[]))
           AND so.status IN ('Rascunho', 'Pendente')
         )
       )
  ), demand AS (
    SELECT pv.sale_order_id,
           pv.created_at AS sale_order_created_at,
           need.*
      FROM eligible_pvs pv
      CROSS JOIN LATERAL public.compute_per_pv_purchase_needs_unallocated(
        ARRAY[pv.sale_order_id]
      ) need
     WHERE p_product_ids IS NULL
        OR need.material_id = ANY(p_product_ids)
  ), own_reservations AS (
    SELECT o.sale_order_id,
           mr.product_id,
           sum(greatest(
             0,
             COALESCE(mr.quantity_reserved, 0)
               - COALESCE(mr.quantity_consumed, 0)
           )) AS own_reserved
      FROM public.material_reservations mr
      JOIN public.orders o ON o.id = mr.order_id
      JOIN eligible_pvs pv ON pv.sale_order_id = o.sale_order_id
     WHERE mr.status IN ('reserved', 'partially_consumed')
       AND mr.sale_order_strap_demand_id IS NULL
       AND mr.strap_stock_floor_contribution_id IS NULL
     GROUP BY o.sale_order_id, mr.product_id
  ), annotated AS (
    SELECT d.*,
           greatest(0, COALESCE(p.quantity, 0)
             - COALESCE(p.reserved_stock, 0)) AS free_stock,
           COALESCE(p.stock_grade, '{}'::jsonb) AS stock_grade,
           COALESCE(orr.own_reserved, 0) AS own_reserved,
           EXISTS (
             SELECT 1
               FROM jsonb_each(
                 CASE WHEN jsonb_typeof(d.grade) = 'object'
                   THEN d.grade ELSE '{}'::jsonb END
               ) ge(key, value)
              WHERE left(ge.key, 1) <> '_'
                AND jsonb_typeof(ge.value) = 'number'
                AND (ge.value #>> '{}')::numeric > 0
           ) AS has_positive_grade
      FROM demand d
      JOIN public.products p ON p.id = d.material_id
      LEFT JOIN own_reservations orr
        ON orr.sale_order_id = d.sale_order_id
       AND orr.product_id = d.material_id
  ), scalar_with_own_before AS (
    SELECT a.*,
           COALESCE(sum(greatest(0, a.needed_qty)) OVER (
             PARTITION BY a.sale_order_id, a.material_id
             ORDER BY COALESCE(a.color, '')
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS own_demand_before
      FROM annotated a
     WHERE NOT a.has_positive_grade
  ), scalar_effective AS (
    SELECT s.*,
           least(
             greatest(0, s.needed_qty),
             greatest(0, s.own_reserved - s.own_demand_before)
           ) AS own_allocated,
           greatest(
             0,
             greatest(0, s.needed_qty)
               - least(
                   greatest(0, s.needed_qty),
                   greatest(0, s.own_reserved - s.own_demand_before)
                 )
           ) AS shared_demand
      FROM scalar_with_own_before s
  ), scalar_with_prior AS (
    SELECT s.*,
           COALESCE(sum(s.shared_demand) OVER (
             PARTITION BY s.material_id
             ORDER BY s.sale_order_created_at, s.sale_order_id,
                      COALESCE(s.color, '')
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS prior_shared_demand
      FROM scalar_effective s
  ), scalar_allocated AS (
    SELECT s.sale_order_id,
           s.material_id,
           s.color,
           public.sale_order_purchase_allocated_shortage(
             s.shared_demand,
             s.free_stock,
             s.prior_shared_demand
           ) AS allocated_shortage
      FROM scalar_with_prior s
  ), grade_entries AS (
    SELECT a.sale_order_id,
           a.sale_order_created_at,
           a.material_id,
           a.color,
           ge.key AS size_key,
           (ge.value #>> '{}')::numeric AS demand_qty,
           greatest(
             0,
             COALESCE(NULLIF(a.stock_grade ->> ge.key, '')::numeric, 0)
           ) AS size_onhand
      FROM annotated a
      CROSS JOIN LATERAL jsonb_each(a.grade) ge(key, value)
     WHERE a.has_positive_grade
       AND left(ge.key, 1) <> '_'
       AND jsonb_typeof(ge.value) = 'number'
       AND (ge.value #>> '{}')::numeric > 0
  ), grade_with_prior AS (
    SELECT ge.*,
           COALESCE(sum(ge.demand_qty) OVER (
             PARTITION BY ge.material_id, ge.size_key
             ORDER BY ge.sale_order_created_at, ge.sale_order_id,
                      COALESCE(ge.color, '')
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS prior_size_demand
      FROM grade_entries ge
  ), grade_allocated AS (
    SELECT gp.*,
           public.sale_order_purchase_allocated_shortage(
             gp.demand_qty,
             gp.size_onhand,
             gp.prior_size_demand
           ) AS size_shortage
      FROM grade_with_prior gp
  ), grade_rollup AS (
    SELECT ga.sale_order_id,
           ga.material_id,
           ga.color,
           sum(ga.size_shortage) AS allocated_shortage,
           COALESCE(
             jsonb_object_agg(
               ga.size_key,
               ga.size_shortage
               ORDER BY ga.size_key
             ) FILTER (WHERE ga.size_shortage > 0),
             '{}'::jsonb
           ) AS allocated_shortage_grade
      FROM grade_allocated ga
     GROUP BY ga.sale_order_id, ga.material_id, ga.color
  ), conflicting_open AS (
    SELECT pv.sale_order_id,
           poi.product_id,
           string_agg(DISTINCT po.order_number, ', ' ORDER BY po.order_number)
             AS order_numbers
      FROM eligible_pvs pv
      CROSS JOIN public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
     WHERE lower(COALESCE(po.status, '')) NOT IN (
             'cancelled', 'canceled', 'cancelada',
             'received', 'recebida', 'receiving'
           )
       AND po.source_type IS DISTINCT FROM 'strap_demand'
       -- Sugestão automática de OUTRO PV é a contribuição em trânsito dele e
       -- não bloqueia este. A sugestão do próprio PV continua sendo conflito.
       AND (
         NOT (
           COALESCE(po.auto_generated, false)
           AND po.source_type = 'per_pv'
         )
         OR COALESCE(po.source_pv_ids, ARRAY[]::uuid[])
              @> ARRAY[pv.sale_order_id]
         OR COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[])
              @> ARRAY[pv.sale_order_id]
       )
       AND greatest(
             0,
             COALESCE(poi.quantity, 0) - COALESCE(poi.received_quantity, 0)
           ) > 0
     GROUP BY pv.sale_order_id, poi.product_id
  )
  SELECT a.sale_order_id,
         a.material_id,
         a.product_name,
         a.unit,
         a.color,
         a.needed_qty,
         greatest(
           0,
           a.needed_qty - CASE WHEN a.has_positive_grade
             THEN COALESCE(gr.allocated_shortage, a.needed_qty)
             ELSE COALESCE(sa.allocated_shortage, a.needed_qty)
           END
         ) AS stock_qty,
         CASE WHEN a.has_positive_grade
           THEN COALESCE(gr.allocated_shortage, a.needed_qty)
           ELSE COALESCE(sa.allocated_shortage, a.needed_qty)
         END AS shortage,
         a.supplier_id,
         a.supplier_name,
         a.last_unit_price,
         a.is_artisanal,
         a.grade,
         a.color_mismatch,
         a.conversion_warning,
         CASE WHEN a.has_positive_grade
           THEN COALESCE(gr.allocated_shortage_grade, '{}'::jsonb)
           ELSE NULL
         END AS shortage_grade,
         CASE WHEN co.product_id IS NOT NULL THEN format(
           'Já existe compra manual/MRP aberta para "%s" nas OCs %s. '
           || 'Confira ou autorize explicitamente antes de comprar novamente.',
           a.product_name,
           co.order_numbers
         ) ELSE NULL END AS open_purchase_warning
    FROM annotated a
    LEFT JOIN scalar_allocated sa
      ON sa.sale_order_id = a.sale_order_id
     AND sa.material_id = a.material_id
     AND sa.color IS NOT DISTINCT FROM a.color
    LEFT JOIN grade_rollup gr
      ON gr.sale_order_id = a.sale_order_id
     AND gr.material_id = a.material_id
     AND gr.color IS NOT DISTINCT FROM a.color
    LEFT JOIN conflicting_open co ON co.product_id = a.material_id
      AND co.sale_order_id = a.sale_order_id
   WHERE a.sale_order_id = ANY(p_target_pv_ids)
   ORDER BY a.supplier_name NULLS LAST,
            a.product_name,
            a.sale_order_created_at,
            a.sale_order_id,
            COALESCE(a.color, '');
$function$;

CREATE OR REPLACE FUNCTION public.compute_per_pv_packaging_purchase_needs_124(
  p_pv_ids uuid[]
)
RETURNS TABLE(
  box_type_id uuid,
  packaging_type text,
  product_name text,
  unit text,
  needed_qty numeric,
  stock_qty numeric,
  shortage numeric,
  supplier_id uuid,
  supplier_name text,
  last_unit_price numeric,
  conversion_warning text,
  open_purchase_warning text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $function$
  WITH eligible_items AS (
    SELECT so.id AS sale_order_id,
           so.created_at AS sale_order_created_at,
           soi.id AS sale_order_item_id,
           soi.reference_id,
           COALESCE(soi.quantity, 0)::numeric AS quantity,
           soi.grade,
           so.packaging_mode
      FROM public.sale_orders so
      JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     WHERE so.deleted_at IS NULL
       AND (
         so.status IN ('Aprovado', 'Em Produção')
         OR (
           so.id = ANY(COALESCE(p_pv_ids, ARRAY[]::uuid[]))
           AND so.status IN ('Rascunho', 'Pendente')
         )
       )
       AND soi.reference_id IS NOT NULL
       AND COALESCE(soi.quantity, 0) > 0
  ), raw_lines AS (
    SELECT item.sale_order_id,
           item.sale_order_created_at,
           item.sale_order_item_id,
           packaging.box_type_id,
           packaging.packaging_type,
           packaging.box_name,
           packaging.unit,
           packaging.required,
           packaging.warning
      FROM eligible_items item
      CROSS JOIN LATERAL public.calculate_packaging_consumption(
        item.reference_id,
        item.quantity,
        item.packaging_mode,
        item.grade
      ) packaging
  ), demand_by_pv AS (
    SELECT line.sale_order_id,
           min(line.sale_order_created_at) AS sale_order_created_at,
           line.box_type_id,
           max(line.packaging_type) AS packaging_type,
           max(line.box_name) AS box_name,
           max(line.unit) AS unit,
           sum(line.required) AS needed_qty
      FROM raw_lines line
     WHERE line.box_type_id IS NOT NULL
       AND line.warning IS NULL
       AND COALESCE(line.required, 0) > 0
     GROUP BY line.sale_order_id, line.box_type_id
  ), ordered AS (
    SELECT demand.*,
           COALESCE(sum(demand.needed_qty) OVER (
             PARTITION BY demand.box_type_id
             ORDER BY demand.sale_order_created_at, demand.sale_order_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS prior_demand
      FROM demand_by_pv demand
  ), allocated AS (
    SELECT demand.*,
           LEAST(
             demand.needed_qty,
             GREATEST(0, COALESCE(box.quantity, 0) - demand.prior_demand)
           ) AS allocated_stock,
           GREATEST(
             0,
             demand.needed_qty
               - GREATEST(0, COALESCE(box.quantity, 0) - demand.prior_demand)
           ) AS allocated_shortage
      FROM ordered demand
      JOIN public.box_types box ON box.id = demand.box_type_id
  ), target_rollup AS (
    SELECT allocated.box_type_id,
           max(allocated.packaging_type) AS packaging_type,
           max(allocated.box_name) AS box_name,
           max(allocated.unit) AS unit,
           sum(allocated.needed_qty) AS needed_qty,
           sum(allocated.allocated_stock) AS stock_qty,
           sum(allocated.allocated_shortage) AS shortage
      FROM allocated
     WHERE allocated.sale_order_id = ANY(COALESCE(p_pv_ids, ARRAY[]::uuid[]))
     GROUP BY allocated.box_type_id
  ), open_purchase AS (
    SELECT item.box_type_id,
           string_agg(DISTINCT purchase_order.order_number, ', '
             ORDER BY purchase_order.order_number) AS order_numbers
      FROM public.purchase_order_items item
      JOIN public.purchase_orders purchase_order
        ON purchase_order.id = item.purchase_order_id
     WHERE item.box_type_id IS NOT NULL
       AND lower(COALESCE(purchase_order.status, '')) NOT IN (
         'cancelled', 'canceled', 'cancelada',
         'received', 'recebida', 'receiving'
       )
       AND purchase_order.source_type IS DISTINCT FROM 'strap_demand'
       -- Espelha o canal products da 111: compra automática de OUTRO PV é
       -- contribuição distinta e não bloqueia. Compra manual/MRP ou a compra
       -- automática dos próprios PVs selecionados continua sendo conflito.
       AND (
         NOT (
           COALESCE(purchase_order.auto_generated, false)
           AND purchase_order.source_type = 'per_pv'
         )
         OR COALESCE(purchase_order.source_pv_ids, ARRAY[]::uuid[])
              && COALESCE(p_pv_ids, ARRAY[]::uuid[])
         OR COALESCE(purchase_order.linked_sale_order_ids, ARRAY[]::uuid[])
              && COALESCE(p_pv_ids, ARRAY[]::uuid[])
       )
       AND GREATEST(
         0,
         COALESCE(item.quantity, 0) - COALESCE(item.received_quantity, 0)
       ) > 0
     GROUP BY item.box_type_id
  ), diagnostics AS (
    SELECT line.packaging_type,
           max(line.warning) AS warning
      FROM raw_lines line
     WHERE line.sale_order_id = ANY(COALESCE(p_pv_ids, ARRAY[]::uuid[]))
       AND line.warning IS NOT NULL
     GROUP BY line.packaging_type, line.warning
  )
  SELECT combined.*
    FROM (
      SELECT rollup.box_type_id AS box_type_id,
             rollup.packaging_type AS packaging_type,
             COALESCE(box.nome, rollup.box_name, rollup.box_type_id::text)
               AS product_name,
             CASE WHEN box.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END
               AS unit,
             rollup.needed_qty AS needed_qty,
             rollup.stock_qty AS stock_qty,
             rollup.shortage AS shortage,
             box.supplier_id AS supplier_id,
             supplier.name AS supplier_name,
             COALESCE(box.unit_price, 0) AS last_unit_price,
             NULL::text AS conversion_warning,
             CASE WHEN open_purchase.box_type_id IS NOT NULL THEN format(
               'Já existe compra aberta para a embalagem "%s" nas OCs %s. '
               || 'Confira ou autorize explicitamente antes de comprar novamente.',
               box.nome,
               open_purchase.order_numbers
             ) ELSE NULL END AS open_purchase_warning
        FROM target_rollup rollup
        JOIN public.box_types box
          ON box.id = rollup.box_type_id
         AND box.active = true
        LEFT JOIN public.suppliers supplier ON supplier.id = box.supplier_id
        LEFT JOIN open_purchase ON open_purchase.box_type_id = rollup.box_type_id
      UNION ALL
      SELECT NULL::uuid AS box_type_id,
             diagnostic.packaging_type AS packaging_type,
             'Embalagem não resolvida'::text AS product_name,
             'un'::text AS unit,
             0::numeric AS needed_qty,
             0::numeric AS stock_qty,
             0::numeric AS shortage,
             NULL::uuid AS supplier_id,
             NULL::text AS supplier_name,
             0::numeric AS last_unit_price,
             diagnostic.warning AS conversion_warning,
             NULL::text AS open_purchase_warning
        FROM diagnostics diagnostic
    ) combined
   ORDER BY combined.supplier_name NULLS LAST,
            combined.product_name,
            combined.packaging_type;
$function$;

REVOKE ALL ON FUNCTION public.compute_allocated_per_pv_purchase_need_lines(uuid[], uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_allocated_per_pv_purchase_need_lines(uuid[], uuid[])
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.compute_per_pv_packaging_purchase_needs_124(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_per_pv_packaging_purchase_needs_124(uuid[])
  TO authenticated, service_role;

-- Trava viva: corpo atual tem de incluir o alvo Rascunho/Pendente.
DO $guard$
DECLARE
  v_alloc text;
  v_pack text;
BEGIN
  SELECT pg_get_functiondef('public.compute_allocated_per_pv_purchase_need_lines(uuid[], uuid[])'::regprocedure)
    INTO v_alloc;
  SELECT pg_get_functiondef('public.compute_per_pv_packaging_purchase_needs_124(uuid[])'::regprocedure)
    INTO v_pack;

  IF position('Rascunho' IN v_alloc) = 0 OR position('p_target_pv_ids' IN v_alloc) = 0 THEN
    RAISE EXCEPTION 'compute_allocated_per_pv_purchase_need_lines sem elegibilidade de rascunho alvo';
  END IF;
  IF position('Rascunho' IN v_pack) = 0 OR position('p_pv_ids' IN v_pack) = 0 THEN
    RAISE EXCEPTION 'compute_per_pv_packaging_purchase_needs_124 sem elegibilidade de rascunho alvo';
  END IF;
END;
$guard$;
