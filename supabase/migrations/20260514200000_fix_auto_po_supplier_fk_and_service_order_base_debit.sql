-- ============================================================================
-- FIX: dois bugs de FK achados na auditoria do pedido teste (PV -> OC/OS)
-- ============================================================================
-- BUG B — auto_create_purchase_order viola purchase_orders_supplier_id_fkey:
--   No fallback de fornecedor via group_suppliers, a função fazia
--   v_supplier_id := group_suppliers.id. Mas purchase_orders.supplier_id tem
--   FK pra suppliers, não pra group_suppliers. Há um bloco que tenta remapear
--   por CNPJ, mas 4 dos 8 group_suppliers não têm suppliers correspondente —
--   o id inválido sobrava e a INSERT estourava, abortando o UPDATE de estoque.
--   Fix: não selecionar gs.id pra v_supplier_id. v_supplier_id fica NULL
--   (coluna é nullable) a menos que o bloco de CNPJ ache um suppliers real.
--   O supplier_name continua sendo preenchido pra exibição.
--
-- BUG C — tg_debit_service_order_base viola stock_movements_order_id_fkey:
--   A função inseria stock_movements com order_id = NEW.id — mas NEW é a linha
--   de service_orders, então NEW.id é um service_orders.id, e
--   stock_movements.order_id tem FK pra orders. service_orders TEM uma coluna
--   order_id própria (FK pra orders, a OP vinculada). Fix: usar NEW.order_id
--   (NULL quando a OS não tem OP vinculada — FK aceita NULL).
-- ============================================================================

-- ── BUG C ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_debit_service_order_base()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_recipe RECORD;
  v_product_id uuid;
  v_product_qty numeric;
  v_required numeric;
BEGIN
  IF NEW.artisanal_recipe_id IS NULL OR COALESCE(NEW.artisanal_output_meters, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('cancelado','cancelled','rejeitada') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_recipe FROM public.artisanal_recipes WHERE id = NEW.artisanal_recipe_id;
  IF v_recipe IS NULL OR COALESCE(v_recipe.yield_per_meter, 1) <= 0 THEN
    RETURN NEW;
  END IF;

  v_required := NEW.artisanal_output_meters / v_recipe.yield_per_meter;

  SELECT p.id, p.quantity INTO v_product_id, v_product_qty
    FROM public.products p
   WHERE p.active = true
     AND lower(trim(p.name)) = lower(trim(v_recipe.base_product_name))
     AND (NEW.artisanal_base_color IS NULL
          OR NEW.artisanal_base_color = ''
          OR lower(trim(coalesce(p.color, ''))) = lower(trim(NEW.artisanal_base_color)))
   ORDER BY (NEW.artisanal_base_color IS NOT NULL
             AND lower(trim(coalesce(p.color, ''))) = lower(trim(NEW.artisanal_base_color))) DESC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  IF v_product_id IS NULL THEN
    RAISE WARNING 'OS %: produto base "%" (cor %) não encontrado — não debitando estoque',
      NEW.order_number, v_recipe.base_product_name, COALESCE(NEW.artisanal_base_color, '');
    RETURN NEW;
  END IF;

  IF v_product_qty < v_required THEN
    RAISE WARNING 'OS %: estoque insuficiente de "%" (%) — disponível %, necessário %',
      NEW.order_number, v_recipe.base_product_name, COALESCE(NEW.artisanal_base_color, ''),
      v_product_qty, v_required;
  END IF;

  UPDATE public.products
     SET quantity   = GREATEST(0, quantity - v_required),
         updated_at = now()
   WHERE id = v_product_id;

  -- FIX: era NEW.id (service_orders.id) — coluna FK aponta pra orders.
  -- NEW.order_id é a OP vinculada (NULL quando a OS não tem OP — FK aceita NULL).
  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock,
    description, order_id
  ) VALUES (
    v_product_id, 'out', v_required, v_product_qty,
    GREATEST(0, v_product_qty - v_required),
    'OS Artesanal ' || COALESCE(NEW.order_number, '?') ||
      ' — base "' || v_recipe.base_product_name || '"' ||
      CASE WHEN NEW.artisanal_base_color IS NOT NULL AND NEW.artisanal_base_color <> ''
           THEN ' (' || NEW.artisanal_base_color || ')' ELSE '' END,
    NEW.order_id
  );

  RETURN NEW;
END;
$function$;

-- ── BUG B ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_create_purchase_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

      -- 1) Fornecedor da última nota que incluiu este produto (suppliers real)
      SELECT s.id, s.name, s.payment_terms, s.lead_time_days
      INTO v_supplier_id, v_supplier_name, v_payment_terms, v_lead_time
      FROM invoice_items ii
      JOIN invoices inv ON inv.id = ii.invoice_id
      JOIN suppliers s ON s.id = inv.supplier_id
      WHERE ii.product_id = NEW.id
      ORDER BY inv.issue_date DESC NULLS LAST, ii.created_at DESC
      LIMIT 1;

      -- 2) Fallback: group_suppliers. NÃO usa gs.id como supplier_id (FK quebra —
      --    aponta pra suppliers). v_supplier_id só recebe valor se o bloco de
      --    CNPJ achar um suppliers real; senão fica NULL (coluna é nullable).
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

      INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
      VALUES (v_po_id, NEW.id, NEW.quantity, NEW.min_stock, NEW.max_stock, v_suggested_qty, v_suggested_qty, NEW.unit_price, NEW.unit);

      UPDATE purchase_orders SET total_value = v_suggested_qty * NEW.unit_price WHERE id = v_po_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
