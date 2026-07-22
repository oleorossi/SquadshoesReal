-- ============================================================================
-- Fase 2 da auditoria de motores — Pacote P4 (COMPRAS), parte 1/4
--
-- F3-1 (crítico): os 2 geradores ROP/estoque-mínimo (auto_create_purchase_order
--   e generate_rop_purchase_suggestions) gravavam o item de OC em unidade de
--   ESTOQUE (quantity=suggested_qty, unit=products.unit, unit_price=R$/estoque),
--   mas o recebimento da OC credita SEMPRE quantity × fator(purchase_unit→unit)
--   — pra PLACA EVA (rate 150) isso creditaria 150× a mais. Convenção canônica
--   (generate_purchase_orders_from_mrp / per-PV / Wizard): item de OC em unidade
--   de COMPRA → qty ÷ conversion_rate, preço × conversion_rate,
--   unit = COALESCE(purchase_order_unit, unit); suggested_quantity permanece em
--   unidade de ESTOQUE (mesma convenção do writer do MRP).
--
-- F3-2 (alto): v_mrp_needs passa a expor is_artisanal e os geradores de OC
--   (generate_purchase_orders_from_mrp + generate_rop_purchase_suggestions)
--   PULAM produtos artesanais — tira artesanal é produzida internamente via OS
--   (branch correto já existe no trigger auto_create_purchase_order; o canal
--   per-PV já rola artesanal pra base napa via compute_materials_per_pv).
--   Nenhuma limpeza de sugestões existentes aqui (proibido reparo de dados).
--
-- F3-9 (baixo): consolidação de OC automática não mistura canal — os dois
--   consolidadores (auto_create_purchase_order e upsert_open_purchase_order)
--   excluem OCs source_type='per_pv' da busca de OC aberta (item de reposição
--   de estoque-mínimo não pode cair dentro da OC de um PV específico).
--   check_purchase_order_idempotency não tem lookup por fornecedor — sem mudança.
--
-- Idempotente: CREATE OR REPLACE em views e funções, sem DML.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) v_mrp_needs — expõe is_artisanal (coluna APPENDADA no fim, nas 2 pernas
--    do UNION ALL, preservando ordem/tipos das colunas existentes).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_mrp_needs AS
 WITH demand AS (
         SELECT d_1.product_id,
            d_1.product_name,
            d_1.total_required,
            d_1.earliest_deadline,
            d_1.orders_count,
            d_1.order_ids,
            d_1.conversion_warning
           FROM fn_projected_demand() d_1(product_id, product_name, total_required, earliest_deadline, orders_count, order_ids, conversion_warning)
        ), po_open AS (
         SELECT poi.product_id,
            sum(poi.quantity) AS qty_in_pipeline
           FROM purchase_order_items poi
             JOIN purchase_orders po_1 ON po_1.id = poi.purchase_order_id
          WHERE po_1.status <> ALL (ARRAY['cancelled'::text, 'received'::text, 'suggested'::text])
          GROUP BY poi.product_id
        ), reserved AS (
         SELECT mr.product_id,
            sum(mr.quantity_reserved - mr.quantity_consumed) AS qty_reserved
           FROM material_reservations mr
          WHERE mr.status = ANY (ARRAY['reserved'::text, 'partially_consumed'::text])
          GROUP BY mr.product_id
        ), wave_deadline AS (
         SELECT sm.product_id,
            min(pw.purchase_deadline) AS wave_purchase_deadline
           FROM production_waves pw
             JOIN production_wave_items pwi ON pwi.wave_id = pw.id
             JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
             JOIN sale_order_items soi ON soi.id = pwis.sale_order_item_id
             JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
          WHERE (pw.status::text <> ALL (ARRAY['finished'::text, 'cancelled'::text])) AND pw.purchase_deadline IS NOT NULL
          GROUP BY sm.product_id
        ), box_po AS (
         SELECT poi.box_type_id,
            sum(poi.quantity) AS qty_in_pipeline
           FROM purchase_order_items poi
             JOIN purchase_orders po_1 ON po_1.id = poi.purchase_order_id
          WHERE poi.box_type_id IS NOT NULL AND (po_1.status <> ALL (ARRAY['cancelled'::text, 'received'::text, 'suggested'::text]))
          GROUP BY poi.box_type_id
        ), pkg_demand AS (
         SELECT d.box_type_id,
            d.boxes_required,
            d.earliest_deadline,
            d.orders_count
           FROM fn_projected_packaging_demand() d(box_type_id, boxes_required, earliest_deadline, orders_count)
        )
 SELECT p.id AS product_id,
    p.name AS product_name,
    p.sku,
    p.category,
    p.unit,
    p.unit_price,
    p.purchase_order_unit,
    COALESCE(p.conversion_rate, 1::numeric) AS conversion_rate,
    p.min_order_quantity,
    p.lead_time_days,
    p.preferred_supplier_id,
    s.name AS supplier_name,
    p.min_stock,
    p.quantity AS on_hand,
    COALESCE(r.qty_reserved, 0::numeric) AS reserved,
    GREATEST(p.quantity - COALESCE(r.qty_reserved, 0::numeric), 0::numeric) AS available_now,
    COALESCE(po.qty_in_pipeline, 0::numeric) AS qty_in_po,
    COALESCE(d.total_required, 0::numeric) AS projected_demand,
    d.earliest_deadline,
    d.orders_count,
    GREATEST(COALESCE(d.total_required, 0::numeric) + p.min_stock - p.quantity - COALESCE(po.qty_in_pipeline, 0::numeric), 0::numeric) AS suggested_qty,
    COALESCE(wd.wave_purchase_deadline, add_business_days(d.earliest_deadline, - COALESCE(p.lead_time_days, 0))) AS order_by_date,
    d.conversion_warning,
    false AS is_packaging,
    COALESCE(p.is_artisanal, false) AS is_artisanal
   FROM products p
     LEFT JOIN demand d ON d.product_id = p.id
     LEFT JOIN po_open po ON po.product_id = p.id
     LEFT JOIN reserved r ON r.product_id = p.id
     LEFT JOIN wave_deadline wd ON wd.product_id = p.id
     LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
  WHERE COALESCE(d.total_required, 0::numeric) > 0::numeric OR p.quantity < p.min_stock OR d.conversion_warning IS NOT NULL
UNION ALL
 SELECT bt.id AS product_id,
    bt.nome AS product_name,
    NULL::text AS sku,
    'Embalagem'::text AS category,
        CASE
            WHEN bt.tipo::text = 'fitilho'::text THEN 'm'::text
            ELSE 'cx'::text
        END AS unit,
    bt.unit_price,
        CASE
            WHEN bt.tipo::text = 'fitilho'::text THEN 'm'::text
            ELSE 'cx'::text
        END AS purchase_order_unit,
    1::numeric AS conversion_rate,
    NULL::numeric AS min_order_quantity,
    0 AS lead_time_days,
    bt.supplier_id AS preferred_supplier_id,
    s.name AS supplier_name,
    bt.min_stock,
    bt.quantity AS on_hand,
    0::numeric AS reserved,
    GREATEST(bt.quantity - 0::numeric, 0::numeric) AS available_now,
    COALESCE(bpo.qty_in_pipeline, 0::numeric) AS qty_in_po,
    COALESCE(pd.boxes_required, 0::numeric) AS projected_demand,
    pd.earliest_deadline,
    pd.orders_count,
    GREATEST(COALESCE(pd.boxes_required, 0::numeric) + COALESCE(bt.min_stock, 0::numeric) - bt.quantity - COALESCE(bpo.qty_in_pipeline, 0::numeric), 0::numeric) AS suggested_qty,
    pd.earliest_deadline AS order_by_date,
    NULL::text AS conversion_warning,
    true AS is_packaging,
    false AS is_artisanal
   FROM box_types bt
     LEFT JOIN pkg_demand pd ON pd.box_type_id = bt.id
     LEFT JOIN box_po bpo ON bpo.box_type_id = bt.id
     LEFT JOIN suppliers s ON s.id = bt.supplier_id
  WHERE bt.active = true AND (COALESCE(pd.boxes_required, 0::numeric) > 0::numeric OR bt.quantity < COALESCE(bt.min_stock, 0::numeric));

-- ----------------------------------------------------------------------------
-- 2) v_products_below_rop — appenda conversion_rate / purchase_order_unit /
--    purchase_multiple (efetivo, com fallback do grupo) / is_artisanal pro
--    gerador ROP converter pra unidade de compra e pular artesanais.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_products_below_rop AS
 SELECT id AS product_id,
    name AS product_name,
    group_id,
    category,
    unit,
    unit_price,
    quantity AS stock_qty,
    COALESCE(reserved_stock, 0::numeric) AS reserved_stock,
    GREATEST(0::numeric, quantity - COALESCE(reserved_stock, 0::numeric)) AS available_qty,
    min_stock,
    max_stock,
        CASE
            WHEN COALESCE(max_stock, 0::numeric) > 0::numeric AND max_stock <= (GREATEST(COALESCE(min_stock, 0::numeric), 1::numeric) * 10::numeric) THEN GREATEST(0::numeric, max_stock - GREATEST(0::numeric, quantity - COALESCE(reserved_stock, 0::numeric)))
            ELSE GREATEST(0::numeric, GREATEST(COALESCE(min_stock, 0::numeric), 1::numeric) * 2::numeric - GREATEST(0::numeric, quantity - COALESCE(reserved_stock, 0::numeric)))
        END AS suggested_qty,
    COALESCE(supplier_lead_time_days, 10) AS supplier_lead_days,
    COALESCE(( SELECT s.name
           FROM suppliers s
          WHERE s.id = p.supplier_id), ( SELECT gs.supplier_name
           FROM group_suppliers gs
          WHERE gs.group_id = p.group_id
          ORDER BY gs.updated_at DESC
         LIMIT 1), 'A definir'::text) AS suggested_supplier,
    ( SELECT s.id
           FROM suppliers s
          WHERE s.id = p.supplier_id) AS suggested_supplier_id,
    COALESCE(( SELECT gsm.minimum_order
           FROM group_supplier_materials gsm
          WHERE gsm.group_id = p.group_id AND gsm.active = true
          ORDER BY gsm.updated_at DESC
         LIMIT 1), 1::numeric) AS supplier_moq,
    (EXISTS ( SELECT 1
           FROM purchase_order_items poi
             JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.product_id = p.id AND (po.status = ANY (ARRAY['suggested'::text, 'pending'::text, 'approved'::text])))) AS has_active_po,
    COALESCE(p.conversion_rate, 1::numeric) AS conversion_rate,
    p.purchase_order_unit,
    COALESCE(NULLIF(p.purchase_multiple, 0::numeric), ( SELECT NULLIF(pg.purchase_multiple, 0::numeric)
           FROM product_groups pg
          WHERE pg.id = p.group_id), 0::numeric) AS purchase_multiple,
    COALESCE(p.is_artisanal, false) AS is_artisanal
   FROM products p
  WHERE COALESCE(active, true) = true AND COALESCE(min_stock, 0::numeric) > 0::numeric AND GREATEST(0::numeric, quantity - COALESCE(reserved_stock, 0::numeric)) <= COALESCE(min_stock, 0::numeric);

-- ----------------------------------------------------------------------------
-- 3) generate_purchase_orders_from_mrp — F3-2: pula produtos artesanais
--    (produzidos internamente via OS; o caminho correto é o branch artesanal
--    do trigger de estoque-mínimo, não OC de compra). Diff mínimo: filtro novo.
-- ----------------------------------------------------------------------------
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
     WHERE suggested_qty > 0 AND NOT COALESCE(is_packaging, false)
       AND NOT COALESCE(is_artisanal, false)   -- F3-2: artesanal = OS, não OC
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
    SELECT COALESCE(NULLIF(pr.purchase_multiple, 0), NULLIF(pg.purchase_multiple, 0), 0) INTO v_multiple
      FROM public.products pr LEFT JOIN public.product_groups pg ON pg.id = pr.group_id WHERE pr.id = v_row.product_id;
    IF v_multiple IS NOT NULL AND v_multiple > 1 THEN
      v_qty_to_order := CEIL(v_qty_to_order / v_multiple) * v_multiple;
    END IF;
    v_lock_key := hashtextextended(COALESCE(v_supplier::text, 'no-supplier'), 0);
    PERFORM pg_advisory_xact_lock(v_lock_key);
    SELECT ARRAY_AGG(DISTINCT so.id) INTO v_linked FROM sale_orders so
      JOIN sale_order_items soi ON soi.sale_order_id = so.id
      JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
     WHERE sm.product_id = v_row.product_id AND so.deleted_at IS NULL AND so.status IN ('Aprovado', 'Em Produção');
    SELECT id INTO v_po_id FROM public.purchase_orders
     WHERE supplier_id IS NOT DISTINCT FROM v_supplier AND status = 'pending' AND auto_generated = true
       AND created_at > now() - interval '2 minutes' LIMIT 1;
    IF v_po_id IS NULL THEN
      v_po_number := 'PO-MRP-' || to_char(now(),'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text),1,4);
      INSERT INTO public.purchase_orders (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated, linked_sale_order_ids)
      VALUES (v_po_number, 'pending', v_supplier, COALESCE(v_row.supplier_name, ''), 0,
        'Gerada automaticamente pelo MRP em ' || to_char(now(),'DD/MM/YYYY HH24:MI'), true, COALESCE(v_linked, ARRAY[]::uuid[]))
      RETURNING id INTO v_po_id;
    ELSE
      UPDATE public.purchase_orders SET linked_sale_order_ids = (
        SELECT ARRAY_AGG(DISTINCT x) FROM unnest(COALESCE(linked_sale_order_ids, ARRAY[]::uuid[]) || COALESCE(v_linked, ARRAY[]::uuid[])) AS x
      ) WHERE id = v_po_id;
    END IF;
    PERFORM public.upsert_po_item_atomic(
      v_po_id, v_row.product_id, v_qty_to_order, v_unit_price_po, v_unit_po,
      COALESCE(v_row.on_hand, 0), COALESCE(v_row.min_stock, 0), 0, NULL, NULL
    );
    UPDATE public.purchase_order_items
       SET suggested_quantity = COALESCE(suggested_quantity, 0) + v_row.suggested_qty
     WHERE purchase_order_id = v_po_id AND product_id = v_row.product_id;
    RETURN NEXT v_po_id;
  END LOOP;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4) generate_rop_purchase_suggestions — F3-1: item em unidade de COMPRA
--    (mesma matemática do generate_purchase_orders_from_mrp: qty ÷ rate,
--    preço × rate, unit = purchase_order_unit, CEIL em unidade contável,
--    múltiplo de compra) + F3-2: pula artesanais.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_rop_purchase_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_supplier RECORD; v_prod RECORD; v_po_id uuid; v_total numeric; v_qty numeric;
  v_sup_id uuid; v_sup_name text;
  v_unit_po text; v_price_po numeric; v_rate numeric;
  v_created int := 0; v_appended int := 0; v_items_added int := 0;
BEGIN
  FOR v_supplier IN
    SELECT suggested_supplier_id, COALESCE(suggested_supplier, 'A definir') AS supplier_name
      FROM public.v_products_below_rop
     WHERE NOT has_active_po
       AND NOT COALESCE(is_artisanal, false)   -- F3-2: artesanal = OS (trigger de min_stock), não OC
     GROUP BY suggested_supplier_id, suggested_supplier
  LOOP
    -- Guarda defensiva: fornecedor inexistente vira NULL (PO "A definir").
    v_sup_id := v_supplier.suggested_supplier_id;
    IF v_sup_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_sup_id) THEN
      v_sup_id := NULL;
    END IF;
    v_sup_name := v_supplier.supplier_name;

    SELECT id INTO v_po_id FROM public.purchase_orders
     WHERE COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(v_sup_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND status = 'suggested' AND auto_generated = true
       AND created_at > now() - interval '7 days'
     ORDER BY created_at DESC LIMIT 1;
    IF v_po_id IS NULL THEN
      INSERT INTO public.purchase_orders (status, supplier_id, supplier_name, total_value, auto_generated, notes)
      VALUES ('suggested', v_sup_id, v_sup_name, 0, true,
        'Sugestao automatica ROP em ' || to_char(now(), 'DD/MM/YYYY HH24:MI'))
      RETURNING id INTO v_po_id;
      v_created := v_created + 1;
    ELSE
      v_appended := v_appended + 1;
    END IF;
    v_total := COALESCE((SELECT total_value FROM public.purchase_orders WHERE id = v_po_id), 0);
    FOR v_prod IN
      SELECT * FROM public.v_products_below_rop
       WHERE NOT has_active_po
         AND NOT COALESCE(is_artisanal, false)   -- F3-2
         AND COALESCE(suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(v_supplier.suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LOOP
      IF EXISTS (SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id = v_po_id AND product_id = v_prod.product_id) THEN CONTINUE; END IF;
      -- F3-1: item de OC em unidade de COMPRA — mesma matemática do MRP.
      -- suggested_qty está em unidade de ESTOQUE; o recebimento credita
      -- quantity × fator(purchase_unit→unit), então quantity TEM que sair
      -- em unidade de compra (senão PLACA EVA credita 150× a mais).
      v_rate := COALESCE(NULLIF(v_prod.conversion_rate, 0), 1);
      v_qty := v_prod.suggested_qty / v_rate;
      v_price_po := COALESCE(v_prod.unit_price, 0) * v_rate;
      v_unit_po := COALESCE(v_prod.purchase_order_unit, v_prod.unit);
      v_qty := GREATEST(v_qty, COALESCE(v_prod.supplier_moq, 1));
      IF v_unit_po IN ('un', 'cx', 'rolo', 'chapa', 'placa', 'unidade', 'par') THEN
        v_qty := CEIL(v_qty);
      END IF;
      IF COALESCE(v_prod.purchase_multiple, 0) > 1 THEN
        v_qty := CEIL(v_qty / v_prod.purchase_multiple) * v_prod.purchase_multiple;
      END IF;
      INSERT INTO public.purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
      VALUES (v_po_id, v_prod.product_id, v_prod.stock_qty, v_prod.min_stock, v_prod.max_stock, v_prod.suggested_qty, v_qty, v_price_po, v_unit_po);
      v_total := v_total + v_qty * v_price_po;
      v_items_added := v_items_added + 1;
    END LOOP;
    UPDATE public.purchase_orders SET total_value = v_total WHERE id = v_po_id;
  END LOOP;
  RETURN jsonb_build_object('pos_created', v_created, 'pos_appended', v_appended, 'items_added', v_items_added, 'run_at', now());
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5) auto_create_purchase_order (trigger de estoque-mínimo) —
--    F3-1: item em unidade de COMPRA (qty ÷ rate, preço × rate,
--          unit = purchase_order_unit, CEIL contável, múltiplo aplicado na
--          quantidade JÁ convertida; suggested_quantity segue em estoque);
--    F3-9: lookup de OC aberta exclui o canal per_pv.
--    Branch artesanal (→ OS) inalterado.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_create_purchase_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_po_id uuid;
  v_so_id uuid;
  v_supplier_id uuid;
  v_supplier_name text;
  v_suggested_qty numeric;
  v_payment_terms text;
  v_lead_time integer;
  v_recipe_id uuid;
  v_contractor_id uuid;
  v_group_name text;
  v_color_name text;
  v_wave_deadline date;
  v_wave_sale_orders uuid[];
  v_is_late boolean := false;
  v_extra_note text := '';
  v_labor_cost numeric;
  v_new_promised date;
  v_multiple numeric;
  v_rate numeric;
  v_qty_po numeric;
  v_price_po numeric;
  v_unit_po text;
BEGIN
  IF NEW.quantity <= NEW.min_stock AND NEW.min_stock > 0 AND (OLD.quantity > OLD.min_stock OR OLD.quantity IS NULL) THEN
    v_suggested_qty := GREATEST(
      COALESCE(NULLIF(NEW.max_stock, 0), NEW.min_stock * 2) - NEW.quantity,
      1
    );

    IF NEW.is_artisanal = true THEN
      v_group_name := trim(split_part(NEW.name, ':', 1));
      v_color_name := trim(split_part(NEW.name, ':', 2));

      SELECT id, default_contractor_id, COALESCE(labor_cost_per_meter, 0)
      INTO v_recipe_id, v_contractor_id, v_labor_cost
      FROM artisanal_recipes
      WHERE artisanal_product_name ILIKE v_group_name || '%'
      LIMIT 1;

      IF v_contractor_id IS NULL THEN
        SELECT id INTO v_contractor_id FROM contractors LIMIT 1;
      END IF;

      IF v_contractor_id IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT id INTO v_so_id
      FROM service_orders
      WHERE artisanal_recipe_id = v_recipe_id
        AND artisanal_output_color = v_color_name
        AND status = 'Pendente'
      LIMIT 1;

      IF v_so_id IS NOT NULL THEN
        UPDATE service_orders
        SET
          quantity = quantity + v_suggested_qty,
          total_value = (quantity + v_suggested_qty) * unit_price,
          description = description || ' | Adição auto (estoque baixo)'
        WHERE id = v_so_id;
      ELSE
        INSERT INTO service_orders (
          contractor_id, description, quantity, unit_price, total_value,
          status, notes, artisanal_recipe_id, artisanal_output_name,
          artisanal_output_color, artisanal_output_meters, artisanal_for_stock_meters
        )
        VALUES (
          v_contractor_id,
          'OS Gerada automaticamente - Estoque mínimo: ' || v_group_name,
          v_suggested_qty, v_labor_cost, v_suggested_qty * v_labor_cost,
          'Pendente',
          CASE WHEN v_labor_cost = 0
            THEN 'Gerada automaticamente devido ao baixo estoque. labor_cost_per_meter nao cadastrado na receita - preencha unit_price antes de finalizar.'
            ELSE 'Gerada automaticamente pelo sistema devido ao baixo estoque.'
          END,
          v_recipe_id, v_group_name, v_color_name,
          v_suggested_qty, v_suggested_qty
        );
      END IF;

    ELSE
      BEGIN
        IF EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.product_id = NEW.id
            AND po.status NOT IN ('received', 'receiving', 'cancelled')
        ) THEN
          RETURN NEW;
        END IF;

        SELECT s.id, s.name, s.payment_terms, s.lead_time_days
        INTO v_supplier_id, v_supplier_name, v_payment_terms, v_lead_time
        FROM invoice_items ii
        JOIN invoices inv ON inv.id = ii.invoice_id
        JOIN suppliers s ON s.id = inv.supplier_id
        WHERE ii.product_id = NEW.id
        ORDER BY inv.issue_date DESC NULLS LAST, ii.created_at DESC
        LIMIT 1;

        IF v_supplier_id IS NULL AND NEW.group_id IS NOT NULL THEN
          SELECT gs.supplier_name, gs.payment_terms, gs.lead_time_days
          INTO v_supplier_name, v_payment_terms, v_lead_time
          FROM group_suppliers gs
          WHERE gs.group_id = NEW.group_id
          ORDER BY gs.updated_at DESC
          LIMIT 1;

          IF v_supplier_name IS NOT NULL THEN
            DECLARE
              v_gs_cnpj text;
              v_main_supplier_id uuid;
            BEGIN
              SELECT gs.supplier_cnpj INTO v_gs_cnpj
              FROM group_suppliers gs
              WHERE gs.group_id = NEW.group_id
              ORDER BY gs.updated_at DESC
              LIMIT 1;

              IF v_gs_cnpj IS NOT NULL AND v_gs_cnpj != '' THEN
                SELECT s.id INTO v_main_supplier_id
                FROM suppliers s
                WHERE replace(replace(replace(s.cnpj, '.', ''), '/', ''), '-', '') = replace(replace(replace(v_gs_cnpj, '.', ''), '/', ''), '-', '')
                LIMIT 1;

                IF v_main_supplier_id IS NOT NULL THEN
                  v_supplier_id := v_main_supplier_id;
                END IF;
              END IF;
            END;
          END IF;
        END IF;

        SELECT MIN(pw.purchase_deadline), ARRAY_AGG(DISTINCT so.id)
        INTO v_wave_deadline, v_wave_sale_orders
        FROM production_waves pw
        JOIN production_wave_items pwi ON pwi.wave_id = pw.id
        JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
        JOIN sale_orders so ON so.id = pwis.sale_order_id
        JOIN sale_order_items soi ON soi.id = pwis.sale_order_item_id
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
        WHERE sm.product_id = NEW.id
          AND pw.status NOT IN ('finished', 'cancelled')
          AND pw.purchase_deadline IS NOT NULL;

        IF v_wave_deadline IS NOT NULL AND v_wave_deadline < CURRENT_DATE THEN
          v_is_late := true;
          v_extra_note := ' | ATRASADA: deadline da wave era ' || v_wave_deadline::text;
        END IF;

        v_new_promised := CASE
          WHEN v_wave_deadline IS NOT NULL AND v_lead_time IS NOT NULL AND v_lead_time > 0 THEN
            LEAST(v_wave_deadline, public.add_business_days(CURRENT_DATE, v_lead_time))
          WHEN v_wave_deadline IS NOT NULL THEN v_wave_deadline
          ELSE NULL
        END;

        v_po_id := NULL;
        IF v_supplier_id IS NOT NULL THEN
          SELECT id INTO v_po_id
          FROM purchase_orders
          WHERE supplier_id = v_supplier_id
            AND status NOT IN ('received', 'receiving', 'cancelled')
            -- F3-9: não consolidar item de estoque-mínimo dentro de OC do
            -- canal "Compras por Pedido" (per_pv) — mistura de canal fazia a
            -- aba "Compras deste PV" somar material que não é do pedido.
            AND COALESCE(source_type, 'manual') <> 'per_pv'
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE;
        END IF;

        IF v_po_id IS NULL THEN
          INSERT INTO purchase_orders (
            supplier_id, supplier_name, auto_generated, notes,
            is_late_origin, linked_sale_order_ids, promised_date
          )
          VALUES (
            v_supplier_id,
            COALESCE(v_supplier_name, 'A definir'),
            true,
            'Gerada automaticamente - Estoque minimo atingido' ||
              CASE WHEN v_payment_terms IS NOT NULL AND v_payment_terms != '' THEN ' | Cond. Pgto: ' || v_payment_terms ELSE '' END ||
              CASE WHEN v_lead_time IS NOT NULL AND v_lead_time > 0 THEN ' | Prazo: ' || v_lead_time || ' dias' ELSE '' END ||
              v_extra_note,
            v_is_late,
            COALESCE(v_wave_sale_orders, ARRAY[]::uuid[]),
            v_new_promised
          )
          RETURNING id INTO v_po_id;
        ELSE
          UPDATE purchase_orders
          SET linked_sale_order_ids = (
                SELECT array_agg(DISTINCT x)
                FROM unnest(COALESCE(linked_sale_order_ids, ARRAY[]::uuid[]) || COALESCE(v_wave_sale_orders, ARRAY[]::uuid[])) x
              ),
              is_late_origin = COALESCE(is_late_origin, false) OR v_is_late,
              promised_date = CASE
                WHEN v_new_promised IS NULL THEN promised_date
                WHEN promised_date IS NULL THEN v_new_promised
                ELSE LEAST(promised_date, v_new_promised)
              END,
              notes = COALESCE(notes, '') || E'\n' || 'Acumulo auto - Estoque minimo: ' || NEW.name || v_extra_note,
              updated_at = now()
          WHERE id = v_po_id;
        END IF;

        -- F3-1: item de OC em unidade de COMPRA (mesma matemática do
        -- generate_purchase_orders_from_mrp). suggested_quantity permanece em
        -- unidade de ESTOQUE (convenção do writer do MRP); quantity/unit_price
        -- saem na convenção que o recebimento espera (qtd × fator credita a
        -- quantidade certa; antes PLACA EVA rate 150 creditava 150× a mais).
        v_rate := COALESCE(NULLIF(NEW.conversion_rate, 0), 1);
        v_unit_po := COALESCE(NEW.purchase_order_unit, NEW.unit);
        v_qty_po := v_suggested_qty / v_rate;
        v_price_po := COALESCE(NEW.unit_price, 0) * v_rate;
        v_qty_po := GREATEST(v_qty_po, COALESCE(NEW.min_order_quantity, 0));
        IF v_unit_po IN ('un', 'cx', 'rolo', 'chapa', 'placa', 'unidade', 'par') THEN
          v_qty_po := CEIL(v_qty_po);
        END IF;
        v_multiple := COALESCE(NULLIF(NEW.purchase_multiple,0), (SELECT NULLIF(pg.purchase_multiple,0) FROM product_groups pg WHERE pg.id = NEW.group_id), 1);
        IF v_multiple > 1 THEN v_qty_po := ceil(v_qty_po / v_multiple) * v_multiple; END IF;
        INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
        VALUES (v_po_id, NEW.id, NEW.quantity, NEW.min_stock, NEW.max_stock, v_suggested_qty, v_qty_po, v_price_po, v_unit_po);

        UPDATE purchase_orders po
        SET total_value = (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM purchase_order_items WHERE purchase_order_id = po.id),
            updated_at = now()
        WHERE po.id = v_po_id;

      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'auto_create_purchase_order: falha ao gerar/consolidar OC do produto % (%): %', NEW.id, NEW.name, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6) upsert_open_purchase_order — F3-9: lookup de OC aberta exclui per_pv.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_open_purchase_order(p_supplier_id uuid, p_supplier_name text, p_sale_order_id uuid, p_notes text, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_po_id uuid;
  v_linked uuid[];
  v_item jsonb;
  v_existing_id uuid;
  v_existing_qty numeric;
  v_existing_grade jsonb;
  v_new_grade jsonb;
  v_merged_grade jsonb;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_id é obrigatório pra agrupar OC';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items vazio — nada pra inserir/atualizar';
  END IF;

  -- Busca OC ABERTA existente do fornecedor + também o array de PVs linkados.
  -- F3-9: OC do canal per_pv fica FORA da consolidação — pertence a um PV
  -- específico (aba "Compras deste PV" exibe a OC inteira).
  SELECT id, COALESCE(linked_sale_order_ids, ARRAY[]::uuid[])
  INTO v_po_id, v_linked
  FROM public.purchase_orders
  WHERE supplier_id = p_supplier_id
    AND status NOT IN ('received','receiving','cancelled')
    AND COALESCE(source_type, 'manual') <> 'per_pv'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- ── IDEMPOTÊNCIA POR PV ──
  -- Se a OC aberta já tem esse PV vinculado, considera disparo duplicado e
  -- retorna sem alterar nada. Antes desse guard, cada save/edit do PV somava
  -- quantity de novo (incidente OC-00031: 9232 vs 1240 esperados).
  IF v_po_id IS NOT NULL
     AND p_sale_order_id IS NOT NULL
     AND p_sale_order_id = ANY(v_linked) THEN
    RETURN v_po_id;
  END IF;

  IF v_po_id IS NULL THEN
    INSERT INTO public.purchase_orders (
      supplier_id, supplier_name, notes, auto_generated, linked_sale_order_ids
    ) VALUES (
      p_supplier_id, p_supplier_name,
      COALESCE(p_notes, ''), true,
      CASE WHEN p_sale_order_id IS NOT NULL THEN ARRAY[p_sale_order_id] ELSE ARRAY[]::uuid[] END
    )
    RETURNING id INTO v_po_id;
  ELSE
    IF p_sale_order_id IS NOT NULL THEN
      UPDATE public.purchase_orders
      SET linked_sale_order_ids = (
        SELECT array_agg(DISTINCT x ORDER BY x)
        FROM unnest(linked_sale_order_ids || p_sale_order_id) x
      ),
      notes = CASE WHEN p_notes IS NOT NULL AND p_notes <> ''
                   THEN COALESCE(notes || E'\n', '') || p_notes
                   ELSE notes END,
      updated_at = now()
      WHERE id = v_po_id;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, quantity, grade INTO v_existing_id, v_existing_qty, v_existing_grade
    FROM public.purchase_order_items
    WHERE purchase_order_id = v_po_id
      AND product_id = (v_item->>'product_id')::uuid
      AND COALESCE(color, '') = COALESCE(v_item->>'color', '')
    LIMIT 1;

    v_new_grade := v_item->'grade';

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_grade IS NOT NULL AND v_new_grade IS NOT NULL AND jsonb_typeof(v_new_grade) = 'object' THEN
        SELECT jsonb_object_agg(k, (COALESCE((v_existing_grade->>k)::numeric, 0)
                                  + COALESCE((v_new_grade->>k)::numeric, 0)))
        INTO v_merged_grade
        FROM (
          SELECT jsonb_object_keys(v_existing_grade) AS k
          UNION
          SELECT jsonb_object_keys(v_new_grade) AS k
        ) keys;
      ELSIF v_new_grade IS NOT NULL AND jsonb_typeof(v_new_grade) = 'object' THEN
        v_merged_grade := v_new_grade;
      ELSE
        v_merged_grade := v_existing_grade;
      END IF;

      UPDATE public.purchase_order_items
      SET quantity = v_existing_qty + COALESCE((v_item->>'quantity')::numeric, 0),
          suggested_quantity = COALESCE(suggested_quantity, 0) + COALESCE((v_item->>'quantity')::numeric, 0),
          unit_price = COALESCE(NULLIF((v_item->>'unit_price')::numeric, 0), unit_price),
          grade = v_merged_grade
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO public.purchase_order_items (
        purchase_order_id, product_id, quantity, suggested_quantity,
        unit_price, unit, current_stock, min_stock, max_stock, grade, color
      ) VALUES (
        v_po_id,
        (v_item->>'product_id')::uuid,
        COALESCE((v_item->>'quantity')::numeric, 0),
        COALESCE((v_item->>'quantity')::numeric, 0),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE(v_item->>'unit', 'un'),
        COALESCE((v_item->>'current_stock')::numeric, 0),
        COALESCE((v_item->>'min_stock')::numeric, 0),
        COALESCE((v_item->>'max_stock')::numeric, 0),
        v_item->'grade',
        v_item->>'color'
      );
    END IF;
  END LOOP;

  UPDATE public.purchase_orders po
  SET total_value = COALESCE((
    SELECT SUM(quantity * unit_price)
    FROM public.purchase_order_items
    WHERE purchase_order_id = po.id
  ), 0),
  updated_at = now()
  WHERE id = v_po_id;

  RETURN v_po_id;
END;
$function$;
