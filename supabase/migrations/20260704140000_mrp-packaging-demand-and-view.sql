-- ════════════════════════════════════════════════════════════════════════════
-- M7 (parte 2/2) — Embalagem (box_types) no MRP
--
-- Depende de 20260704130000 (purchase_order_items.box_type_id).
--
--  (1) fn_projected_packaging_demand(): demanda de caixa por box_type a partir
--      dos pedidos abertos, espelhando a resolução do débito
--      (debit_packaging_for_order): pedido → technical_sheets.sole_group_id →
--      product_groups.box_type_* + pares/caixa, por packaging_mode. Boxes =
--      CEIL(pares_do_item / pares_por_caixa); fitilho em metros (× metros/amarrado).
--      Pares/caixa: product_groups → box_types.pairs_per_box_default → 12 (mesma
--      cascata da NF/débito). Precedência espelha o débito: se a ficha tem caixa
--      vinculada (technical_sheet_box_types) para os tipos do modo, usa ESSAS
--      caixas; senão cai no grupo do solado (o que a aba Embalagem cadastra).
--
--  (2) v_mrp_needs recriada: mesma definição + coluna `is_packaging` (false p/
--      produtos) e UNION ALL de box_types como pseudo-produtos (is_packaging=true,
--      reserved=0, demanda de (1), qty_in_po via purchase_order_items.box_type_id).
--
--  (3) generate_purchase_orders_from_mrp(): passa a PULAR rows is_packaging —
--      product_id delas é um box_type (não products), quebraria o INSERT. Compra
--      de embalagem é feita no módulo /embalagens; no MRP as caixas são só
--      visibilidade de necessidade (o frontend desabilita "Gerar OC" nessas rows).
--
-- Validado via transação + ROLLBACK com pedido real (SALTINHO BLOCO, colmeia):
-- view recria sem erro, demanda > 0, row is_packaging aparece. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- (1) ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_projected_packaging_demand()
RETURNS TABLE(box_type_id uuid, boxes_required numeric, earliest_deadline date, orders_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH open_items AS (
    SELECT so.id AS sale_order_id, so.delivery_deadline,
           ts.id AS sheet_id, ts.sole_group_id, soi.quantity::numeric AS qty,
           CASE
             WHEN so.packaging_mode = 'colmeia' THEN ARRAY['colmeia']
             WHEN so.packaging_mode = 'individual_master' THEN ARRAY['individual','master']
             WHEN so.packaging_mode IN ('individual_fitilho','individual_amarrado') THEN ARRAY['individual','fitilho']
             ELSE ARRAY['individual']
           END AS types
      FROM public.sale_orders so
      JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
      JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE so.status NOT IN ('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado','Expedido','Concluído')
       AND ts.sole_group_id IS NOT NULL
       AND soi.quantity > 0
  ),
  -- Espelha a precedência do débito: se a FICHA tem caixa vinculada
  -- (technical_sheet_box_types) para algum dos tipos do modo, o débito usa ESSAS
  -- caixas e ignora o grupo. Só cai no grupo do solado quando a ficha não tem.
  flagged AS (
    SELECT oi.*,
      EXISTS (
        SELECT 1 FROM public.technical_sheet_box_types tb
          JOIN public.box_types bt ON bt.id = tb.box_type_id AND bt.active = true
         WHERE tb.sheet_id = oi.sheet_id AND bt.tipo::text = ANY(oi.types)
      ) AS uses_tsbt
      FROM open_items oi
  ),
  typed AS (
    SELECT f.*, t.pkg_type
      FROM flagged f
      CROSS JOIN LATERAL unnest(f.types) AS t(pkg_type)
  ),
  resolved AS (
    SELECT ty.sale_order_id, ty.delivery_deadline, ty.qty, ty.pkg_type,
      CASE WHEN ty.uses_tsbt THEN (
        SELECT tb.box_type_id FROM public.technical_sheet_box_types tb
          JOIN public.box_types bt ON bt.id = tb.box_type_id AND bt.active = true
         WHERE tb.sheet_id = ty.sheet_id AND bt.tipo::text = ty.pkg_type LIMIT 1
      ) ELSE (CASE ty.pkg_type
        WHEN 'individual' THEN pg.box_type_id
        WHEN 'master'     THEN pg.box_type_master_id
        WHEN 'colmeia'    THEN pg.box_type_colmeia_id
        WHEN 'fitilho'    THEN pg.box_type_fitilho_id END)
      END AS box_type_id,
      CASE WHEN ty.uses_tsbt THEN (
        SELECT bt.pairs_per_box_default FROM public.technical_sheet_box_types tb
          JOIN public.box_types bt ON bt.id = tb.box_type_id AND bt.active = true
         WHERE tb.sheet_id = ty.sheet_id AND bt.tipo::text = ty.pkg_type LIMIT 1
      ) ELSE (CASE ty.pkg_type
        WHEN 'individual' THEN pg.pairs_per_box_individual
        WHEN 'master'     THEN pg.pairs_per_box_master
        WHEN 'colmeia'    THEN pg.pairs_per_box_colmeia
        WHEN 'fitilho'    THEN pg.pairs_per_box_fitilho END)
      END AS pg_pairs,
      COALESCE(pg.metros_fitilho_per_amarrado, 1.0) AS metros
      FROM typed ty
      LEFT JOIN public.product_groups pg ON pg.id = ty.sole_group_id
  ),
  computed AS (
    SELECT r.box_type_id, r.sale_order_id, r.delivery_deadline,
      CEIL(r.qty / GREATEST(COALESCE(r.pg_pairs, bt.pairs_per_box_default, 12), 1))
        * CASE WHEN r.pkg_type = 'fitilho' THEN r.metros ELSE 1 END AS boxes
      FROM resolved r
      JOIN public.box_types bt ON bt.id = r.box_type_id AND bt.active = true
     WHERE r.box_type_id IS NOT NULL
  )
  SELECT box_type_id,
         SUM(boxes) AS boxes_required,
         MIN(delivery_deadline) AS earliest_deadline,
         COUNT(DISTINCT sale_order_id)::integer AS orders_count
    FROM computed
   GROUP BY box_type_id;
$function$;

-- (2) ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_mrp_needs AS
WITH demand AS (
  SELECT d_1.product_id, d_1.product_name, d_1.total_required, d_1.earliest_deadline,
         d_1.orders_count, d_1.order_ids, d_1.conversion_warning
    FROM fn_projected_demand() d_1(product_id, product_name, total_required, earliest_deadline, orders_count, order_ids, conversion_warning)
), po_open AS (
  SELECT poi.product_id, sum(poi.quantity) AS qty_in_pipeline
    FROM purchase_order_items poi
    JOIN purchase_orders po_1 ON po_1.id = poi.purchase_order_id
   WHERE po_1.status <> ALL (ARRAY['cancelled'::text, 'received'::text, 'suggested'::text])
   GROUP BY poi.product_id
), reserved AS (
  SELECT mr.product_id, sum(mr.quantity_reserved - mr.quantity_consumed) AS qty_reserved
    FROM material_reservations mr
   WHERE mr.status = ANY (ARRAY['reserved'::text, 'partially_consumed'::text])
   GROUP BY mr.product_id
), wave_deadline AS (
  SELECT sm.product_id, min(pw.purchase_deadline) AS wave_purchase_deadline
    FROM production_waves pw
    JOIN production_wave_items pwi ON pwi.wave_id = pw.id
    JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
    JOIN sale_order_items soi ON soi.id = pwis.sale_order_item_id
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
   WHERE (pw.status::text <> ALL (ARRAY['finished'::text, 'cancelled'::text])) AND pw.purchase_deadline IS NOT NULL
   GROUP BY sm.product_id
), box_po AS (
  SELECT poi.box_type_id, sum(poi.quantity) AS qty_in_pipeline
    FROM purchase_order_items poi
    JOIN purchase_orders po_1 ON po_1.id = poi.purchase_order_id
   WHERE poi.box_type_id IS NOT NULL
     AND po_1.status <> ALL (ARRAY['cancelled'::text, 'received'::text, 'suggested'::text])
   GROUP BY poi.box_type_id
), pkg_demand AS (
  SELECT d.box_type_id, d.boxes_required, d.earliest_deadline, d.orders_count
    FROM fn_projected_packaging_demand() d
)
-- ── Produtos (comportamento original) ──
SELECT p.id AS product_id, p.name AS product_name, p.sku, p.category, p.unit, p.unit_price,
    p.purchase_order_unit, COALESCE(p.conversion_rate, 1::numeric) AS conversion_rate,
    p.min_order_quantity, p.lead_time_days, p.preferred_supplier_id, s.name AS supplier_name,
    p.min_stock, p.quantity AS on_hand, COALESCE(r.qty_reserved, 0::numeric) AS reserved,
    GREATEST(p.quantity - COALESCE(r.qty_reserved, 0::numeric), 0::numeric) AS available_now,
    COALESCE(po.qty_in_pipeline, 0::numeric) AS qty_in_po,
    COALESCE(d.total_required, 0::numeric) AS projected_demand,
    d.earliest_deadline, d.orders_count,
    GREATEST(COALESCE(d.total_required, 0::numeric) + p.min_stock - p.quantity - COALESCE(po.qty_in_pipeline, 0::numeric), 0::numeric) AS suggested_qty,
    COALESCE(wd.wave_purchase_deadline, add_business_days(d.earliest_deadline, - COALESCE(p.lead_time_days, 0))) AS order_by_date,
    d.conversion_warning,
    false AS is_packaging
   FROM products p
     LEFT JOIN demand d ON d.product_id = p.id
     LEFT JOIN po_open po ON po.product_id = p.id
     LEFT JOIN reserved r ON r.product_id = p.id
     LEFT JOIN wave_deadline wd ON wd.product_id = p.id
     LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
  WHERE COALESCE(d.total_required, 0::numeric) > 0::numeric OR p.quantity < p.min_stock OR d.conversion_warning IS NOT NULL
UNION ALL
-- ── Embalagem (box_types como pseudo-produtos) ──
SELECT bt.id AS product_id, bt.nome AS product_name, NULL::text AS sku, 'Embalagem'::text AS category,
    (CASE WHEN bt.tipo::text = 'fitilho' THEN 'm' ELSE 'cx' END)::text AS unit,
    bt.unit_price,
    (CASE WHEN bt.tipo::text = 'fitilho' THEN 'm' ELSE 'cx' END)::text AS purchase_order_unit,
    1::numeric AS conversion_rate,
    NULL::numeric AS min_order_quantity, 0::integer AS lead_time_days,
    bt.supplier_id AS preferred_supplier_id, s.name AS supplier_name,
    bt.min_stock, bt.quantity AS on_hand, 0::numeric AS reserved,
    GREATEST(bt.quantity - 0::numeric, 0::numeric) AS available_now,
    COALESCE(bpo.qty_in_pipeline, 0::numeric) AS qty_in_po,
    COALESCE(pd.boxes_required, 0::numeric) AS projected_demand,
    pd.earliest_deadline, pd.orders_count,
    GREATEST(COALESCE(pd.boxes_required, 0::numeric) + COALESCE(bt.min_stock, 0::numeric) - bt.quantity - COALESCE(bpo.qty_in_pipeline, 0::numeric), 0::numeric) AS suggested_qty,
    pd.earliest_deadline AS order_by_date,
    NULL::text AS conversion_warning,
    true AS is_packaging
   FROM box_types bt
     LEFT JOIN pkg_demand pd ON pd.box_type_id = bt.id
     LEFT JOIN box_po bpo ON bpo.box_type_id = bt.id
     LEFT JOIN suppliers s ON s.id = bt.supplier_id
  WHERE bt.active = true
    AND (COALESCE(pd.boxes_required, 0::numeric) > 0::numeric OR bt.quantity < COALESCE(bt.min_stock, 0::numeric));

-- (3) ─────────────────────────────────────────────────────────────────────────
-- generate_purchase_orders_from_mrp: pula rows is_packaging (product_id de caixa
-- não é products → quebraria o INSERT). Mesma função, +1 filtro no WHERE do loop.
CREATE OR REPLACE FUNCTION public.generate_purchase_orders_from_mrp(p_product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record; v_supplier uuid; v_po_id uuid; v_po_number text;
  v_qty_to_order numeric; v_unit_price_po numeric; v_unit_po text;
  v_linked uuid[]; v_lock_key bigint; v_multiple numeric;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_mrp_needs
     WHERE suggested_qty > 0
       AND NOT COALESCE(is_packaging, false)   -- M7: embalagem se compra em /embalagens
       AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids))
     ORDER BY preferred_supplier_id NULLS LAST, product_name
  LOOP
    v_supplier := v_row.preferred_supplier_id;
    v_qty_to_order := v_row.suggested_qty / COALESCE(v_row.conversion_rate, 1);
    v_unit_price_po := COALESCE(v_row.unit_price, 0) * COALESCE(v_row.conversion_rate, 1);
    v_unit_po := COALESCE(v_row.purchase_order_unit, v_row.unit);
    v_qty_to_order := GREATEST(v_qty_to_order, COALESCE(v_row.min_order_quantity, 0));

    IF v_unit_po IN ('un', 'cx', 'rolo', 'chapa', 'placa', 'unidade', 'par') THEN
      v_qty_to_order := CEIL(v_qty_to_order);
    END IF;

    SELECT COALESCE(NULLIF(pr.purchase_multiple, 0), NULLIF(pg.purchase_multiple, 0), 0)
      INTO v_multiple
      FROM public.products pr
      LEFT JOIN public.product_groups pg ON pg.id = pr.group_id
     WHERE pr.id = v_row.product_id;
    IF v_multiple IS NOT NULL AND v_multiple > 1 THEN
      v_qty_to_order := CEIL(v_qty_to_order / v_multiple) * v_multiple;
    END IF;

    v_lock_key := hashtextextended(COALESCE(v_supplier::text, 'no-supplier'), 0);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT ARRAY_AGG(DISTINCT so.id) INTO v_linked
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    WHERE sm.product_id = v_row.product_id
      AND so.deleted_at IS NULL
      AND so.status IN ('Aprovado', 'Em Produção');

    SELECT id INTO v_po_id
      FROM public.purchase_orders
     WHERE supplier_id IS NOT DISTINCT FROM v_supplier
       AND status = 'pending' AND auto_generated = true
       AND created_at > now() - interval '2 minutes'
     LIMIT 1;

    IF v_po_id IS NULL THEN
      v_po_number := 'PO-MRP-' || to_char(now(),'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text),1,4);
      INSERT INTO public.purchase_orders
        (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated, linked_sale_order_ids)
      VALUES (v_po_number, 'pending', v_supplier, COALESCE(v_row.supplier_name, ''), 0,
        'Gerada automaticamente pelo MRP em ' || to_char(now(),'DD/MM/YYYY HH24:MI'), true,
        COALESCE(v_linked, ARRAY[]::uuid[]))
      RETURNING id INTO v_po_id;
    ELSE
      UPDATE public.purchase_orders
      SET linked_sale_order_ids = (
        SELECT ARRAY_AGG(DISTINCT x)
        FROM unnest(COALESCE(linked_sale_order_ids, ARRAY[]::uuid[]) || COALESCE(v_linked, ARRAY[]::uuid[])) AS x
      )
      WHERE id = v_po_id;
    END IF;

    INSERT INTO public.purchase_order_items
      (purchase_order_id, product_id, quantity, unit_price, unit, current_stock, min_stock, suggested_quantity)
    VALUES (v_po_id, v_row.product_id, v_qty_to_order, v_unit_price_po, v_unit_po,
      v_row.on_hand, v_row.min_stock, v_row.suggested_qty);

    UPDATE public.purchase_orders
       SET total_value = (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM public.purchase_order_items WHERE purchase_order_id = v_po_id),
           updated_at = now()
     WHERE id = v_po_id;

    RETURN NEXT v_po_id;
  END LOOP;
END;
$function$;
