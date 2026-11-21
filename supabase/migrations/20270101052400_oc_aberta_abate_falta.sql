-- oc_aberta_abate_falta_20270101052400
--
-- Gerar OC desconta o saldo ainda não recebido de OC aberta já vinculada
-- ao mesmo pedido e ao mesmo material. A leitura lista necessidade,
-- reserva, compra e recebimento por PV. Não altera pedido, estoque nem OC.
-- Não toca PV-00249 nem LOTE-00004. PV-00250 só entra na leitura.

CREATE OR REPLACE FUNCTION public.open_purchase_pending_qty(
  p_sale_order_id uuid,
  p_product_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(GREATEST(
           0,
           poi.quantity - COALESCE(poi.received_quantity, 0)
         )), 0)
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
   WHERE p_sale_order_id IS NOT NULL
     AND p_product_id IS NOT NULL
     AND poi.product_id = p_product_id
     AND po.cancelled_at IS NULL
     AND po.status IN ('pending', 'approved', 'sent', 'parcial')
     AND p_sale_order_id = ANY (COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[]));
$$;

REVOKE ALL ON FUNCTION public.open_purchase_pending_qty(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_purchase_pending_qty(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_pv_material_coverage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.order_number, x.supplier_name, x.product_name)
      FROM (
        SELECT so.id AS sale_order_id,
               so.order_number,
               so.status AS sale_status,
               p.id AS product_id,
               p.name AS product_name,
               p.unit,
               s.id AS supplier_id,
               COALESCE(s.name, 'Sem fornecedor') AS supplier_name,
               SUM(COALESCE(mr.quantity_reserved, 0) + COALESCE(mr.quantity_short, 0)) AS required,
               SUM(COALESCE(mr.quantity_reserved, 0)) AS reserved,
               SUM(COALESCE(mr.quantity_short, 0)) AS short,
               public.open_purchase_pending_qty(so.id, p.id) AS open_pending,
               COALESCE((
                 SELECT SUM(COALESCE(poi.received_quantity, 0))
                   FROM public.purchase_order_items poi
                   JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
                  WHERE poi.product_id = p.id
                    AND po.cancelled_at IS NULL
                    AND so.id = ANY (COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[]))
               ), 0) AS received,
               (
                 SELECT po.id
                   FROM public.purchase_orders po
                   JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
                  WHERE poi.product_id = p.id
                    AND po.cancelled_at IS NULL
                    AND po.status IN ('pending', 'approved', 'sent', 'parcial')
                    AND so.id = ANY (COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[]))
                  ORDER BY po.created_at
                  LIMIT 1
               ) AS purchase_order_id,
               (
                 SELECT po.order_number
                   FROM public.purchase_orders po
                   JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
                  WHERE poi.product_id = p.id
                    AND po.cancelled_at IS NULL
                    AND po.status IN ('pending', 'approved', 'sent', 'parcial')
                    AND so.id = ANY (COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[]))
                  ORDER BY po.created_at
                  LIMIT 1
               ) AS purchase_order_number
          FROM public.sale_orders so
          JOIN public.material_reservations mr
            ON mr.sale_order_id = so.id
            OR mr.order_id IN (
              SELECT o.id FROM public.orders o WHERE o.sale_order_id = so.id
            )
          JOIN public.products p ON p.id = mr.product_id
          LEFT JOIN public.suppliers s ON s.id = p.supplier_id
         WHERE so.deleted_at IS NULL
           AND so.status IN ('Aprovado', 'Em Produção')
           AND so.order_number IS DISTINCT FROM 'PV-00249'
           AND so.order_number IS DISTINCT FROM 'LOTE-00004'
           AND mr.status = 'reserved'
         GROUP BY so.id, so.order_number, so.status, p.id, p.name, p.unit, s.id, s.name
      ) x
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_pv_material_coverage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pv_material_coverage() TO authenticated, service_role;

COMMENT ON FUNCTION public.list_pv_material_coverage() IS
  'Necessidade, reserva, OC aberta e recebimento por material do PV. Somente leitura.';

DO $abate_oc_aberta$
DECLARE
  v_def text;
  v_old text;
  v_new text;
  v_row record;
BEGIN
  v_def := pg_catalog.pg_get_functiondef(
    'public.create_cabedal_motor_purchase_orders(jsonb)'::regprocedure
  );
  IF pg_catalog.strpos(v_def, 'oc_aberta_abate_20270101052400') > 0 THEN
    RAISE NOTICE 'gerar_oc_ja_abate_aberta';
  ELSE
    v_old := $old$      IF COALESCE((v_line ->> 'quantity')::numeric, 0) <= 0 THEN
        CONTINUE;
      END IF;$old$;
    v_new := $new$      -- oc_aberta_abate_20270101052400
      IF GREATEST(
           0,
           COALESCE((v_line ->> 'quantity')::numeric, 0)
           - public.open_purchase_pending_qty(
               NULLIF(v_line ->> 'sale_order_id', '')::uuid,
               NULLIF(v_line ->> 'product_id', '')::uuid
             )
         ) <= 0 THEN
        CONTINUE;
      END IF;$new$;
    IF pg_catalog.strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'Âncora do Gerar OC mudou. A OC aberta continuaria duplicando a compra.';
    END IF;
    v_def := replace(v_def, v_old, v_new);
    v_def := replace(
      v_def,
      $q$        'quantity', (v_line ->> 'quantity')::numeric,
        'suggested_quantity', (v_line ->> 'quantity')::numeric,$q$,
      $q$        'quantity', GREATEST(0, (v_line ->> 'quantity')::numeric - public.open_purchase_pending_qty(NULLIF(v_line ->> 'sale_order_id', '')::uuid, NULLIF(v_line ->> 'product_id', '')::uuid)),
        'suggested_quantity', GREATEST(0, (v_line ->> 'quantity')::numeric - public.open_purchase_pending_qty(NULLIF(v_line ->> 'sale_order_id', '')::uuid, NULLIF(v_line ->> 'product_id', '')::uuid)),$q$
    );
    v_def := replace(
      v_def,
      $q$        'max_stock', (v_line ->> 'quantity')::numeric$q$,
      $q$        'max_stock', GREATEST(0, (v_line ->> 'quantity')::numeric - public.open_purchase_pending_qty(NULLIF(v_line ->> 'sale_order_id', '')::uuid, NULLIF(v_line ->> 'product_id', '')::uuid))$q$
    );
    EXECUTE v_def;
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_row IN
    SELECT so.order_number AS pv,
           po.order_number AS oc,
           po.status,
           p.name AS produto,
           poi.quantity,
           COALESCE(poi.received_quantity, 0) AS recebido
      FROM public.sale_orders so
      JOIN public.purchase_orders po
        ON so.id = ANY (COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[]))
      JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
      JOIN public.products p ON p.id = poi.product_id
     WHERE so.order_number IN ('PV-00238', 'PV-00250')
       AND po.cancelled_at IS NULL
       AND po.status IN ('pending', 'approved', 'sent', 'parcial')
     ORDER BY so.order_number, po.order_number, p.name
  LOOP
    RAISE NOTICE 'oc_aberta_pv % oc=% status=% produto=% qtd=% recebido=%',
      v_row.pv, v_row.oc, v_row.status, v_row.produto, v_row.quantity, v_row.recebido;
  END LOOP;
END;
$abate_oc_aberta$;
