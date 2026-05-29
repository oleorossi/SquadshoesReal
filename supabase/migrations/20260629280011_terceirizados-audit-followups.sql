-- P-TERCEIRIZADOS-AUDIT (2026-05-28): correções da auditoria do setor de
-- terceirizados. Cobre 4 fixes correctness no banco:
--   1) CRITICAL: remove tg_debit_service_order_base (+ revert) — frontend
--      via produceArtisanalOutput já faz débito comprehensive (per-cor,
--      error handling, toasts). Trigger fazia débito redundante no INSERT
--      → toda OS artesanal debitava base 2× (DB no insert + frontend no
--      Concluído). Material físico decrementado 2× por OS.
--   2) CRITICAL: auto_create_purchase_order artesanal usa
--      artisanal_recipes.labor_cost_per_meter em vez de NEW.unit_price
--      (preço de venda) — antes contratado recebia preço retail como mão
--      de obra, sobrepagamento massivo.
--   3) MAJOR: REVOKE EXECUTE de override_service_order_for_montagem
--      do PUBLIC + role check interno (admin/gerente/pcp). Antes qualquer
--      authenticated user (incl. operador chão) podia bypassar Montagem
--      block com justificativa de 5 chars.
--   4) MAJOR: DROP TRIGGER trg_create_ap_for_service_order (AFTER INSERT)
--      — duplicado do tg_create_ap_for_service_order (AFTER INSERT+UPDATE),
--      chamavam a mesma função. Função era idempotente mas rodava 2× a
--      cada INSERT (custo desnecessário).

-- ============================================================
-- 1. Drop artisanal debit DB triggers — frontend handles via
--    produceArtisanalOutput (per-color + error UX + idempotência
--    via artisanal_stock_entry_done flag)
-- ============================================================
DROP TRIGGER IF EXISTS trg_debit_service_order_base ON public.service_orders;
DROP TRIGGER IF EXISTS trg_revert_service_order_base_on_cancel ON public.service_orders;

-- Funções preservadas (caso queira reactivate como safety-net no futuro
-- via UPDATE de status='Concluído' apenas), mas atualmente não estão
-- bindeadas a trigger nenhum.
COMMENT ON FUNCTION public.tg_debit_service_order_base() IS
  'DEPRECATED 28/05/2026: causava double-debit com produceArtisanalOutput do frontend. Mantida só pra histórico — trigger trg_debit_service_order_base foi dropado.';
COMMENT ON FUNCTION public.tg_revert_service_order_base_on_cancel() IS
  'DEPRECATED 28/05/2026: companheira do tg_debit_service_order_base. Mantida só pra histórico.';

-- ============================================================
-- 2. auto_create_purchase_order artisanal usa labor_cost_per_meter
-- ============================================================
-- Em vez de NEW.unit_price (preço retail do produto artesanal), buscar
-- artisanal_recipes.labor_cost_per_meter. Se NULL, criar OS com unit_price=0
-- e total_value=0 — usuário preenche manualmente (melhor que sobrepagar).
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
BEGIN
  IF NEW.quantity <= NEW.min_stock AND NEW.min_stock > 0 AND (OLD.quantity > OLD.min_stock OR OLD.quantity IS NULL) THEN

    v_suggested_qty := GREATEST(
      COALESCE(NULLIF(NEW.max_stock, 0), NEW.min_stock * 2) - NEW.quantity,
      1
    );

    IF NEW.is_artisanal = true THEN
      v_group_name := trim(split_part(NEW.name, ':', 1));
      v_color_name := trim(split_part(NEW.name, ':', 2));

      -- Auditoria 28/05/2026: também busca labor_cost_per_meter pra evitar
      -- billing contratado com preço retail do produto.
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
        -- unit_price agora vem do labor_cost_per_meter da receita
        -- (0 se não cadastrado — user preenche depois). Antes pegava
        -- NEW.unit_price = preço de venda do produto artesanal.
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

-- ============================================================
-- 3. Role check + REVOKE PUBLIC em override RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.override_service_order_for_montagem(p_so_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Auditoria 28/05/2026: só admin/gerente/pcp podem fazer override. Antes
  -- qualquer authenticated user (incl. operador chão) podia bypassar com
  -- justificativa de 5 chars.
  IF NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'pcp']) THEN
    RAISE EXCEPTION 'Sem permissão pra liberar OS — função restrita a admin/gerente/PCP. Procure quem tem acesso.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Justificativa obrigatória (mín 5 caracteres)';
  END IF;

  UPDATE public.service_orders
  SET montagem_override_at = now(),
      montagem_override_by = auth.uid(),
      montagem_override_reason = trim(p_reason)
  WHERE id = p_so_id;

  BEGIN
    INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success)
    VALUES (
      auth.uid(),
      'override_montagem_block',
      'service_orders',
      p_so_id::text,
      jsonb_build_object('reason', p_reason),
      true
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.override_service_order_for_montagem(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.override_service_order_for_montagem(uuid, text) TO authenticated;

-- ============================================================
-- 4. Drop trigger AP duplicado
-- ============================================================
-- trg_create_ap_for_service_order (AFTER INSERT) duplicava
-- tg_create_ap_for_service_order (AFTER INSERT+UPDATE) — chamavam a
-- mesma função. Idempotente, mas custo desnecessário a cada INSERT.
DROP TRIGGER IF EXISTS trg_create_ap_for_service_order ON public.service_orders;
