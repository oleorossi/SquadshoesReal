-- P1.2 (bug #3): auto_create_purchase_order respeita purchase_deadline da wave
-- Antes: PO criada por trigger de stock_min nascia com promised_date NULL
-- e ignorava a deadline de qualquer wave que dependesse desse material.
-- Agora resolve via cadeia product→sheet_materials→sale_order_items
-- →production_wave_item_sources→production_waves, pega o MIN(purchase_deadline)
-- de waves ativas, sinaliza is_late_origin se já passou, e popula
-- linked_sale_order_ids (resolve parte do bug #8).

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS is_late_origin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.purchase_orders.is_late_origin IS
  'TRUE quando PO nasceu com promised_date < CURRENT_DATE (wave deadline já vencida).';

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
  -- P1.2: wave context pra deadline-aware PO
  v_wave_deadline date;
  v_wave_sale_orders uuid[];
  v_is_late boolean := false;
  v_extra_note text := '';
BEGIN
  IF NEW.quantity <= NEW.min_stock AND NEW.min_stock > 0 AND (OLD.quantity > OLD.min_stock OR OLD.quantity IS NULL) THEN

    v_suggested_qty := GREATEST(
      COALESCE(NULLIF(NEW.max_stock, 0), NEW.min_stock * 2) - NEW.quantity,
      1
    );

    IF NEW.is_artisanal = true THEN
      v_group_name := trim(split_part(NEW.name, ':', 1));
      v_color_name := trim(split_part(NEW.name, ':', 2));

      SELECT id, default_contractor_id INTO v_recipe_id, v_contractor_id
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
          v_suggested_qty, NEW.unit_price, v_suggested_qty * NEW.unit_price,
          'Pendente',
          'Gerada automaticamente pelo sistema devido ao baixo estoque.',
          v_recipe_id, v_group_name, v_color_name,
          v_suggested_qty, v_suggested_qty
        );
      END IF;

    ELSE
      IF EXISTS (
        SELECT 1 FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        WHERE poi.product_id = NEW.id AND po.status = 'pending'
      ) THEN
        RETURN NEW;
      END IF;

      -- 1) Fornecedor da última nota
      SELECT s.id, s.name, s.payment_terms, s.lead_time_days
      INTO v_supplier_id, v_supplier_name, v_payment_terms, v_lead_time
      FROM invoice_items ii
      JOIN invoices inv ON inv.id = ii.invoice_id
      JOIN suppliers s ON s.id = inv.supplier_id
      WHERE ii.product_id = NEW.id
      ORDER BY inv.issue_date DESC NULLS LAST, ii.created_at DESC
      LIMIT 1;

      -- 2) Fallback: group_suppliers
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

      -- P1.2: busca wave ativa mais urgente que consome este produto
      -- Resolve via cadeia: product → sheet_materials → sale_order_items
      --   → sale_orders → production_wave_item_sources → production_waves
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

      -- Flag atraso se deadline da wave já passou
      IF v_wave_deadline IS NOT NULL AND v_wave_deadline < CURRENT_DATE THEN
        v_is_late := true;
        v_extra_note := ' | ⚠️ ATRASADA: deadline da wave era ' || v_wave_deadline::text;
      END IF;

      INSERT INTO purchase_orders (
        supplier_id, supplier_name, auto_generated, notes,
        is_late_origin, linked_sale_order_ids,
        promised_date
      )
      VALUES (
        v_supplier_id,
        COALESCE(v_supplier_name, 'A definir'),
        true,
        'Gerada automaticamente - Estoque mínimo atingido' ||
          CASE WHEN v_payment_terms IS NOT NULL AND v_payment_terms != '' THEN ' | Cond. Pgto: ' || v_payment_terms ELSE '' END ||
          CASE WHEN v_lead_time IS NOT NULL AND v_lead_time > 0 THEN ' | Prazo: ' || v_lead_time || ' dias' ELSE '' END ||
          v_extra_note,
        v_is_late,
        COALESCE(v_wave_sale_orders, ARRAY[]::uuid[]),
        -- Se há wave deadline: usa o menor entre wave_deadline e (hoje + lead_time)
        -- Se não há wave: NULL (trigger tg_purchase_orders_set_promised_date vai
        -- popular usando eta_days quando este for setado por tg_purchase_orders_set_auto_eta)
        CASE
          WHEN v_wave_deadline IS NOT NULL AND v_lead_time IS NOT NULL AND v_lead_time > 0 THEN
            LEAST(v_wave_deadline, public.add_business_days(CURRENT_DATE, v_lead_time))
          WHEN v_wave_deadline IS NOT NULL THEN v_wave_deadline
          ELSE NULL
        END
      )
      RETURNING id INTO v_po_id;

      INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
      VALUES (v_po_id, NEW.id, NEW.quantity, NEW.min_stock, NEW.max_stock, v_suggested_qty, v_suggested_qty, NEW.unit_price, NEW.unit);

      UPDATE purchase_orders SET total_value = v_suggested_qty * NEW.unit_price WHERE id = v_po_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
