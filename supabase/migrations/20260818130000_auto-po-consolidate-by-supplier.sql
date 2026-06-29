-- ════════════════════════════════════════════════════════════════════════════
-- Consolidação da OC automática por fornecedor — auditoria compras 2026-06-29
-- ════════════════════════════════════════════════════════════════════════════
-- auto_create_purchase_order (trigger de estoque mínimo) criava uma OC NOVA por
-- produto que cruzava o mínimo, fragmentando o mesmo fornecedor em várias OCs
-- abertas (ex.: PVC SOLADOS com 4). As outras rotas já consolidam (ROP janela 7d,
-- MRP janela 2min, upsert_open_purchase_order por supplier_id). Esta passa a:
--   • reaproveitar a OC ABERTA do mesmo supplier_id (acumula o item nela);
--   • só criar nova quando não há OC aberta OU quando o fornecedor é só nome
--     (sem supplier_id — caso 'A definir', que não dá pra agrupar com segurança).
-- Tudo dentro de BEGIN/EXCEPTION: uma falha na geração/consolidação da OC vira
-- WARNING e NÃO aborta o UPDATE de estoque (hot path) — mais seguro que antes,
-- onde um erro (ex.: max_stock NULL) podia travar o save do produto.
-- Mantém: guarda de produto-já-em-OC-aberta, resolução de fornecedor
-- (NF→group_suppliers→CNPJ), deadline/atraso da wave e promised_date backward.

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
            THEN 'Gerada automaticamente devido ao baixo estoque. ⚠️ labor_cost_per_meter não cadastrado na receita — preencha unit_price antes de finalizar.'
            ELSE 'Gerada automaticamente pelo sistema devido ao baixo estoque.'
          END,
          v_recipe_id, v_group_name, v_color_name,
          v_suggested_qty, v_suggested_qty
        );
      END IF;

    ELSE
      -- ── OC de material: geração/consolidação protegida (não pode abortar o
      --    UPDATE de estoque) ──────────────────────────────────────────────
      BEGIN
        -- Produto já tem OC aberta? Não duplica.
        IF EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.product_id = NEW.id
            AND po.status NOT IN ('received', 'receiving', 'cancelled')
        ) THEN
          RETURN NEW;
        END IF;

        -- Resolve fornecedor: histórico de NF → group_suppliers → CNPJ.
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
          v_extra_note := ' | ⚠️ ATRASADA: deadline da wave era ' || v_wave_deadline::text;
        END IF;

        v_new_promised := CASE
          WHEN v_wave_deadline IS NOT NULL AND v_lead_time IS NOT NULL AND v_lead_time > 0 THEN
            LEAST(v_wave_deadline, public.add_business_days(CURRENT_DATE, v_lead_time))
          WHEN v_wave_deadline IS NOT NULL THEN v_wave_deadline
          ELSE NULL
        END;

        -- ── CONSOLIDA: reaproveita OC aberta do mesmo fornecedor (por
        --    supplier_id). Sem supplier_id (só nome / 'A definir') → cria nova.
        v_po_id := NULL;
        IF v_supplier_id IS NOT NULL THEN
          SELECT id INTO v_po_id
          FROM purchase_orders
          WHERE supplier_id = v_supplier_id
            AND status NOT IN ('received', 'receiving', 'cancelled')
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
            'Gerada automaticamente - Estoque mínimo atingido' ||
              CASE WHEN v_payment_terms IS NOT NULL AND v_payment_terms != '' THEN ' | Cond. Pgto: ' || v_payment_terms ELSE '' END ||
              CASE WHEN v_lead_time IS NOT NULL AND v_lead_time > 0 THEN ' | Prazo: ' || v_lead_time || ' dias' ELSE '' END ||
              v_extra_note,
            v_is_late,
            COALESCE(v_wave_sale_orders, ARRAY[]::uuid[]),
            v_new_promised
          )
          RETURNING id INTO v_po_id;
        ELSE
          -- Acumula na OC aberta existente: merge PVs, data mais cedo, atraso OR.
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
              notes = COALESCE(notes, '') || E'\n' || 'Acúmulo auto - Estoque mínimo: ' || NEW.name || v_extra_note,
              updated_at = now()
          WHERE id = v_po_id;
        END IF;

        -- O guarda no topo garante que o produto não está em nenhuma OC aberta,
        -- então o item é sempre novo (não dobra quantidade num item existente).
        INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
        VALUES (v_po_id, NEW.id, NEW.quantity, NEW.min_stock, NEW.max_stock, v_suggested_qty, v_suggested_qty, NEW.unit_price, NEW.unit);

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
