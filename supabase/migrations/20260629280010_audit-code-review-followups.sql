-- P-CODE-REVIEW (2026-05-28): correções da segunda auditoria (code-review high effort)
-- sobre a refatoração do motor de OC. Cobre 6 fixes correctness no banco:
--   1) Status case-insensitive no bloqueio de Montagem (espelha o fix do
--      stage_name em 280009 — bypass via 'Em_Andamento' continuava)
--   2) tg_purchase_orders_set_promised_date volta a escutar UPDATE OF
--      created_at (TZ-fix backfills voltavam a deixar promised_date stale)
--   3) tg_waves_flag_late_creation passa a escutar UPDATE OF created_at
--      pra manter a invariante coerente após correções de timezone
--   4) tg_service_orders_compute_quoted_deadline recomputa quando user
--      altera quoted_lead_days (mesmo com quoted_deadline já setado) —
--      antes a mudança no lead_days era silenciosamente ignorada
--   5) auto_create_purchase_order anti-duplicate considera POs em
--      'Rascunho' (MRP) e outros statuses ativos, não só 'pending'
--   6) generate_purchase_orders_from_mrp usa pg_advisory_xact_lock por
--      supplier_id pra prevenir race condition em chamadas concorrentes
--      (dois users clicando "Gerar OCs" criavam POs duplicadas)

-- ============================================================
-- 1. Status case-insensitive em Montagem block
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_block_montagem_with_pending_service_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending_os_count int;
  v_status_norm text;
BEGIN
  IF lower(trim(COALESCE(NEW.stage_name, ''))) <> 'montagem' THEN RETURN NEW; END IF;

  -- Case-insensitive + whitespace-tolerant em status (antes só checava
  -- literais lowercase — 'Em_Andamento', 'EM_ANDAMENTO' etc. faziam bypass).
  v_status_norm := lower(trim(COALESCE(NEW.status, '')));
  IF v_status_norm NOT IN ('em_andamento', 'em_progresso') THEN RETURN NEW; END IF;

  IF OLD IS NOT NULL AND lower(trim(COALESCE(OLD.status, ''))) IN ('em_andamento', 'em_progresso') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_pending_os_count
  FROM public.service_orders so
  WHERE so.order_id = NEW.order_id
    AND so.status NOT IN ('received', 'Concluído', 'concluido', 'Cancelado', 'cancelled', 'cancelado')
    AND so.montagem_override_at IS NULL
    AND (
      (so.quoted_deadline IS NULL AND so.service_date IS NULL)
      OR
      COALESCE(so.quoted_deadline, so.service_date + interval '10 days')
        >= public.add_business_days(CURRENT_DATE, -7)
    );

  IF v_pending_os_count > 0 THEN
    RAISE EXCEPTION 'OP % tem % OS terceirizada(s) em andamento dentro do prazo. Marque como recebida em /terceirizados, libere com override (caso perdida), OU aguarde o vencimento + 7 dias úteis.',
      NEW.order_id, v_pending_os_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- 2. tg_purchase_orders_set_promised_date escuta created_at again
-- ============================================================
-- Opus 280009 removeu UPDATE OF created_at por receio de re-disparo.
-- O guard `NEW.promised_date IS NULL` no corpo da função já previne clobber
-- de valores manuais — adicionar volta cobre TZ-fix backfills e data
-- migrations que normalizam created_at.
DROP TRIGGER IF EXISTS trg_purchase_orders_set_promised_date ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_set_promised_date
  BEFORE INSERT OR UPDATE OF eta_days, created_at
  ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_purchase_orders_set_promised_date();

-- ============================================================
-- 3. tg_waves_flag_late_creation escuta created_at
-- ============================================================
DROP TRIGGER IF EXISTS trg_waves_flag_late_creation ON public.production_waves;
CREATE TRIGGER trg_waves_flag_late_creation
  BEFORE INSERT OR UPDATE OF material_ready_date, created_at
  ON public.production_waves
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_waves_flag_late_creation();

-- ============================================================
-- 4. tg_service_orders_compute_quoted_deadline recompute on lead_days
-- ============================================================
-- Antes: guard `NEW.quoted_deadline IS NULL` no início do IF descartava
-- updates de quoted_lead_days quando deadline já estava setado, mesmo que
-- o usuário tivesse mudado lead_days explicitamente.
-- Agora: detecta mudança em quoted_lead_days vs OLD e recomputa.
CREATE OR REPLACE FUNCTION public.tg_service_orders_compute_quoted_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead int;
  v_user_changed_lead boolean;
BEGIN
  v_user_changed_lead := (TG_OP = 'UPDATE'
    AND NEW.quoted_lead_days IS DISTINCT FROM OLD.quoted_lead_days);

  -- Recomputa SE:
  --   (a) inserção sem deadline mas com service_date (caminho original), OU
  --   (b) usuário mudou quoted_lead_days num UPDATE (recompute mesmo com
  --       deadline já setado — intent explícito do usuário)
  IF (NEW.quoted_deadline IS NULL AND NEW.service_date IS NOT NULL)
     OR (v_user_changed_lead AND NEW.service_date IS NOT NULL) THEN
    v_lead := COALESCE(
      NEW.quoted_lead_days,
      (SELECT default_lead_days FROM contractors WHERE id = NEW.contractor_id),
      10
    );
    NEW.quoted_deadline := public.add_business_days(NEW.service_date, v_lead);
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- 5. anti-duplicate em auto_create_purchase_order — cobre Rascunho/MRP
-- ============================================================
-- O check antigo `WHERE po.status = 'pending'` ignorava POs em 'Rascunho'
-- criadas pelo MRP. Resultado: produto que já tinha PO Rascunho aguardando
-- aprovação ganhava OUTRA PO automática via stock_min crossing.
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
      -- Code review #5: anti-duplicate inclui statuses 'Rascunho' (MRP),
      -- 'approved', 'sent', 'partial' — só ignora terminais.
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
-- 6. MRP advisory lock — previne race entre callers concorrentes
-- ============================================================
-- Dois users clicando "Gerar OCs MRP" ao mesmo tempo encontravam a mesma
-- PO Rascunho via SELECT...WHERE created_at > now()-2min e ambos faziam
-- INSERT items, duplicando linhas ou criando POs separadas pro mesmo
-- supplier. pg_advisory_xact_lock(hash) serializa por supplier_id.
CREATE OR REPLACE FUNCTION public.generate_purchase_orders_from_mrp(p_product_ids uuid[] DEFAULT NULL)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_supplier uuid;
  v_po_id uuid;
  v_po_number text;
  v_qty_to_order numeric;
  v_unit_price_po numeric;
  v_unit_po text;
  v_linked uuid[];
  v_lock_key bigint;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_mrp_needs
     WHERE suggested_qty > 0
       AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids))
     ORDER BY preferred_supplier_id NULLS LAST, product_name
  LOOP
    v_supplier := v_row.preferred_supplier_id;
    v_qty_to_order := v_row.suggested_qty / COALESCE(v_row.conversion_rate, 1);
    v_unit_price_po := COALESCE(v_row.unit_price, 0) * COALESCE(v_row.conversion_rate, 1);
    v_unit_po := COALESCE(v_row.purchase_order_unit, v_row.unit);
    v_qty_to_order := GREATEST(v_qty_to_order, COALESCE(v_row.min_order_quantity, 0));

    IF v_unit_po IN ('un', 'cx', 'rolo', 'chapa', 'unidade', 'par') THEN
      v_qty_to_order := CEIL(v_qty_to_order);
    END IF;

    -- Advisory lock per-supplier dentro da transação: serializa quem busca
    -- ou cria a PO draft pra esse supplier. hashtextextended pra estabilizar
    -- entre runs (hashtext muda entre versões de pg).
    v_lock_key := hashtextextended(COALESCE(v_supplier::text, 'no-supplier'), 0);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT ARRAY_AGG(DISTINCT so.id)
    INTO v_linked
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    WHERE sm.product_id = v_row.product_id
      AND so.deleted_at IS NULL
      AND so.status IN ('Aprovado', 'Em Produção');

    SELECT id INTO v_po_id
      FROM public.purchase_orders
     WHERE supplier_id IS NOT DISTINCT FROM v_supplier
       AND status = 'Rascunho'
       AND created_at > now() - interval '2 minutes'
     LIMIT 1;

    IF v_po_id IS NULL THEN
      v_po_number := 'PO-MRP-' || to_char(now(),'YYYYMMDDHH24MISS') ||
                     '-' || substr(md5(random()::text),1,4);
      INSERT INTO public.purchase_orders
        (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated, linked_sale_order_ids)
      VALUES (
        v_po_number, 'Rascunho', v_supplier,
        COALESCE(v_row.supplier_name, ''),
        0,
        'Gerada automaticamente pelo MRP em ' || to_char(now(),'DD/MM/YYYY HH24:MI'),
        true,
        COALESCE(v_linked, ARRAY[]::uuid[])
      ) RETURNING id INTO v_po_id;
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
    VALUES (
      v_po_id, v_row.product_id,
      v_qty_to_order, v_unit_price_po, v_unit_po,
      v_row.on_hand, v_row.min_stock, v_row.suggested_qty
    );

    UPDATE public.purchase_orders
       SET total_value = (
         SELECT COALESCE(SUM(quantity * unit_price), 0)
           FROM public.purchase_order_items
          WHERE purchase_order_id = v_po_id
       ),
       updated_at = now()
     WHERE id = v_po_id;

    RETURN NEXT v_po_id;
  END LOOP;
END;
$function$;
