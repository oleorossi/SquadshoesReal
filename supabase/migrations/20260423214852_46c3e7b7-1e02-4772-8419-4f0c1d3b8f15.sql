DROP FUNCTION IF EXISTS public.auto_create_purchase_order() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_create_purchase_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_po_id uuid;
  v_supplier_id uuid;
  v_supplier_name text;
  v_suggested_qty numeric;
  v_payment_terms text;
  v_lead_time integer;
BEGIN
  -- Only trigger when quantity changes and goes at or below min_stock
  -- Added condition: NEW.is_artisanal = false
  IF NEW.is_artisanal = false AND NEW.quantity <= NEW.min_stock AND NEW.min_stock > 0 AND (OLD.quantity > OLD.min_stock OR OLD.quantity IS NULL) THEN
    -- Check if there's already a pending PO for this product
    IF EXISTS (
      SELECT 1 FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
      WHERE poi.product_id = NEW.id AND po.status = 'pending'
    ) THEN
      RETURN NEW;
    END IF;

    -- 1) Try to find supplier from the last invoice that included this product
    SELECT s.id, s.name, s.payment_terms, s.lead_time_days
    INTO v_supplier_id, v_supplier_name, v_payment_terms, v_lead_time
    FROM invoice_items ii
    JOIN invoices inv ON inv.id = ii.invoice_id
    JOIN suppliers s ON s.id = inv.supplier_id
    WHERE ii.product_id = NEW.id
    ORDER BY inv.issue_date DESC NULLS LAST, ii.created_at DESC
    LIMIT 1;

    -- 2) Fallback: try group_suppliers if product has a group
    IF v_supplier_id IS NULL AND NEW.group_id IS NOT NULL THEN
      SELECT gs.id, gs.supplier_name, gs.payment_terms, gs.lead_time_days
      INTO v_supplier_id, v_supplier_name, v_payment_terms, v_lead_time
      FROM group_suppliers gs
      WHERE gs.group_id = NEW.group_id
      ORDER BY gs.updated_at DESC
      LIMIT 1;

      -- Also check if there's a matching supplier in the main suppliers table by CNPJ
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

    -- Calculate suggested quantity (fill to max_stock, or double min_stock if no max)
    v_suggested_qty := GREATEST(
      COALESCE(NULLIF(NEW.max_stock, 0), NEW.min_stock * 2) - NEW.quantity,
      1
    );

    -- Create purchase order with supplier details
    INSERT INTO purchase_orders (supplier_id, supplier_name, auto_generated, notes)
    VALUES (
      v_supplier_id,
      COALESCE(v_supplier_name, 'A definir'),
      true,
      'Gerada automaticamente - Estoque mínimo atingido' ||
        CASE WHEN v_payment_terms IS NOT NULL AND v_payment_terms != '' THEN ' | Cond. Pgto: ' || v_payment_terms ELSE '' END ||
        CASE WHEN v_lead_time IS NOT NULL AND v_lead_time > 0 THEN ' | Prazo: ' || v_lead_time || ' dias' ELSE '' END
    )
    RETURNING id INTO v_po_id;

    -- Create purchase order item
    INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
    VALUES (v_po_id, NEW.id, NEW.quantity, NEW.min_stock, NEW.max_stock, v_suggested_qty, v_suggested_qty, NEW.unit_price, NEW.unit);

    -- Update total
    UPDATE purchase_orders SET total_value = v_suggested_qty * NEW.unit_price WHERE id = v_po_id;
  END IF;

  RETURN NEW;
END;
$function$;