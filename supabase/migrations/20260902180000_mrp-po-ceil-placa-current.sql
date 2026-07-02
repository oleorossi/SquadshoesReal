-- =============================================================================
-- 20260902180000_mrp-po-ceil-placa-current.sql
-- OC do MRP: CEIL também para unidade 'placa' (auditoria motores 2026-07-01)
--
-- ACHADO: generate_purchase_orders_from_mrp arredonda a quantidade da OC pra
-- cima apenas quando `v_unit_po IN ('un','cx','rolo','chapa','unidade','par')`.
-- 'placa' — a grafia CANÔNICA da unidade (ver docs/UNIDADES_E_CONVERSOES.md;
-- 'chapa' é sinônimo DEPRECADO, mantido na lista só por compatibilidade) —
-- ficou de fora, então OC automática de PLACA EVA sai com quantidade
-- fracionária (ex.: 3,47 placas), que não existe fisicamente na compra.
--
-- FIX: adicionar 'placa' à lista do CEIL. Só singular — a lista viva não tem
-- nenhum plural, então 'placas' não seria coerente com o estilo (e a grafia
-- canônica é singular).
--
-- ⚠ POR QUE NÃO aplicar o arquivo antigo 20260723130000 do repo: ele recria a
-- função com o CORPO DE JULHO/2026, que regrediria todas as mudanças aplicadas
-- depois direto no banco (dedup por advisory lock + janela de 2 min,
-- linked_sale_order_ids, purchase_multiple por produto/grupo, conversão
-- unidade de compra × conversion_rate). Este arquivo parte do def VIVO
-- (pg_get_functiondef em produção ssvxfoybzmjlypnipqzn, 2026-07-02) e muda
-- SOMENTE a lista do CEIL — todo o resto é idêntico byte a byte.
--
-- Grants re-assertados espelhando o estado vivo (authenticated + service_role;
-- sem PUBLIC/anon — lockdown P0), no mesmo padrão das demais migrations.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_purchase_orders_from_mrp(p_product_ids uuid[] DEFAULT NULL::uuid[])
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
  v_multiple numeric;
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

    -- Auditoria 2026-07-01: 'placa' (canônica; 'chapa' é sinônimo deprecado)
    -- entra no CEIL — unidade discreta não admite quantidade fracionária na OC.
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
       AND status = 'pending'
       AND auto_generated = true
       AND created_at > now() - interval '2 minutes'
     LIMIT 1;

    IF v_po_id IS NULL THEN
      v_po_number := 'PO-MRP-' || to_char(now(),'YYYYMMDDHH24MISS') ||
                     '-' || substr(md5(random()::text),1,4);
      INSERT INTO public.purchase_orders
        (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated, linked_sale_order_ids)
      VALUES (
        v_po_number, 'pending', v_supplier,
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

-- Grants espelhando o estado vivo (CREATE OR REPLACE preserva ACLs em banco
-- existente; explícito pra ambiente recriado do zero não divergir).
REVOKE ALL ON FUNCTION public.generate_purchase_orders_from_mrp(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_purchase_orders_from_mrp(uuid[]) TO authenticated, service_role;
