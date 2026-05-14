-- ============================================================================
-- Consolidação de OPs por (Referência × Cor) — eliminar fragmentação
-- ============================================================================
-- Análise feita em 2026-05-13:
-- O sistema já criava 1 OP por (reference_id, color, sale_order_item_id). A
-- fragmentação observada (ex: PV-2026-00083 com 9 OPs de 12 pares) vinha da
-- UI de criação do PV — o usuário cadastrava várias caixas pequenas. O fluxo
-- já tinha detecção de duplicatas, mas só oferecia "prosseguir mesmo assim"
-- (sem opção de mesclar).
--
-- Esta migration entrega:
-- 1. generate_op_number() → formato 'OP-AAAA-NNNNN' (com ano).
-- 2. Funções SQL compact_sale_order_items / compact_orders_by_ref_color /
--    compact_sale_order — disponíveis pra consolidação manual via UI quando
--    o usuário detectar PV antigo fragmentado. PVs com NF emitida são
--    automaticamente pulados (segurança fiscal).
--
-- O fix definitivo está no frontend: SaleOrderFormPanel.tsx agora oferece
-- "Mesclar duplicatas" como ação padrão recomendada no dialog de duplicados.
-- ============================================================================

-- 1. Novo gerador com ano
CREATE OR REPLACE FUNCTION public.generate_op_number()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.order_number = '' OR NEW.order_number IS NULL THEN
    NEW.order_number := 'OP-' || EXTRACT(YEAR FROM CURRENT_DATE)::text ||
                        '-' || lpad(nextval('op_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Funções de compactação (uso manual sob demanda)
CREATE OR REPLACE FUNCTION public.compact_sale_order_items(p_sale_order_id uuid)
RETURNS TABLE(items_kept int, items_removed int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_group RECORD;
  v_principal_id uuid;
  v_absorbed_ids uuid[];
  v_total_qty numeric;
  v_merged_grade jsonb;
  v_total_kept int := 0;
  v_total_removed int := 0;
BEGIN
  FOR v_group IN
    SELECT reference_id, color, COUNT(*) AS cnt, ARRAY_AGG(id ORDER BY created_at) AS ids
    FROM public.sale_order_items
    WHERE sale_order_id = p_sale_order_id
    GROUP BY reference_id, color
    HAVING COUNT(*) > 1
  LOOP
    v_principal_id := v_group.ids[1];
    v_absorbed_ids := v_group.ids[2:];

    SELECT SUM(quantity) INTO v_total_qty
    FROM public.sale_order_items WHERE id = ANY (v_group.ids);

    SELECT jsonb_object_agg(key, value) INTO v_merged_grade
    FROM (
      SELECT key, SUM((value)::numeric)::text::int AS value
      FROM public.sale_order_items, jsonb_each_text(COALESCE(grade, '{}'::jsonb))
      WHERE id = ANY (v_group.ids)
      GROUP BY key
    ) merged;

    UPDATE public.orders SET sale_order_item_id = v_principal_id
    WHERE sale_order_item_id = ANY (v_absorbed_ids);

    UPDATE public.sale_order_items
    SET quantity = v_total_qty, grade = COALESCE(v_merged_grade, grade)
    WHERE id = v_principal_id;

    DELETE FROM public.sale_order_items WHERE id = ANY (v_absorbed_ids);

    v_total_kept := v_total_kept + 1;
    v_total_removed := v_total_removed + array_length(v_absorbed_ids, 1);
  END LOOP;

  RETURN QUERY SELECT v_total_kept, v_total_removed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compact_sale_order_items(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compact_orders_by_ref_color(p_sale_order_id uuid)
RETURNS TABLE(ops_kept int, ops_removed int, nf_skipped int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_group RECORD;
  v_principal_id uuid;
  v_absorbed_ids uuid[];
  v_total_qty int;
  v_merged_grade jsonb;
  v_total_kept int := 0;
  v_total_removed int := 0;
  v_nf_skipped int := 0;
  v_has_nf boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.nfe_emitidas WHERE sale_order_id = p_sale_order_id
  ) INTO v_has_nf;
  IF v_has_nf THEN
    RETURN QUERY SELECT 0, 0, 1;
    RETURN;
  END IF;

  FOR v_group IN
    SELECT reference_id, color, COUNT(*) AS cnt, ARRAY_AGG(id ORDER BY created_at) AS ids
    FROM public.orders
    WHERE sale_order_id = p_sale_order_id
      AND status NOT IN ('Cancelada','cancelada','Cancelado','cancelado')
    GROUP BY reference_id, color
    HAVING COUNT(*) > 1
  LOOP
    v_principal_id := v_group.ids[1];
    v_absorbed_ids := v_group.ids[2:];

    SELECT SUM(quantity) INTO v_total_qty FROM public.orders WHERE id = ANY (v_group.ids);
    SELECT jsonb_object_agg(key, value) INTO v_merged_grade
    FROM (
      SELECT key, SUM((value)::numeric)::text::int AS value
      FROM public.orders, jsonb_each_text(COALESCE(grade, '{}'::jsonb))
      WHERE id = ANY (v_group.ids)
      GROUP BY key
    ) merged;

    -- Repointa FKs (19 tabelas)
    UPDATE public.cogs_entries SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.cost_variance_reports SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.equipment_downtime SET impacted_order_id = v_principal_id WHERE impacted_order_id = ANY (v_absorbed_ids);
    UPDATE public.finished_goods_receipts SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.goods_issues SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.material_reservations SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.mrp_suggestions SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.order_stages SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.picking_lists SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.production_consumptions SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.production_lots SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.production_stops SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.quality_inspections SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.quality_records SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.quarantine_stock SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.service_orders SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.service_orders SET related_order_id = v_principal_id WHERE related_order_id = ANY (v_absorbed_ids);
    UPDATE public.stock_movements SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);
    UPDATE public.wip_ledger SET order_id = v_principal_id WHERE order_id = ANY (v_absorbed_ids);

    -- Consolida order_stages duplicados na principal
    WITH stages_dup AS (
      SELECT stage_name, ARRAY_AGG(id ORDER BY stage_order, created_at) AS ids,
             SUM(quantity_total) AS sum_total, SUM(quantity_processed) AS sum_processed
      FROM public.order_stages WHERE order_id = v_principal_id
      GROUP BY stage_name HAVING COUNT(*) > 1
    ),
    keep AS (
      UPDATE public.order_stages os
      SET quantity_total = sd.sum_total, quantity_processed = sd.sum_processed
      FROM stages_dup sd WHERE os.id = sd.ids[1]
      RETURNING os.id
    )
    DELETE FROM public.order_stages
    WHERE order_id = v_principal_id
      AND id IN (SELECT unnest(ids[2:]) FROM stages_dup);

    UPDATE public.orders
    SET quantity = v_total_qty, grade = COALESCE(v_merged_grade, grade),
        notes = COALESCE(notes,'') || ' [consolidada ' || array_length(v_absorbed_ids,1) || ' OPs em ' || CURRENT_DATE || ']'
    WHERE id = v_principal_id;

    DELETE FROM public.orders WHERE id = ANY (v_absorbed_ids);

    v_total_kept := v_total_kept + 1;
    v_total_removed := v_total_removed + array_length(v_absorbed_ids, 1);
  END LOOP;

  RETURN QUERY SELECT v_total_kept, v_total_removed, v_nf_skipped;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compact_orders_by_ref_color(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compact_sale_order(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_items_kept int; v_items_removed int;
  v_ops_kept int; v_ops_removed int; v_nf_skipped int;
BEGIN
  SELECT * INTO v_ops_kept, v_ops_removed, v_nf_skipped
  FROM public.compact_orders_by_ref_color(p_sale_order_id);

  IF v_nf_skipped > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'NF-e emitida — PV imutável');
  END IF;

  SELECT * INTO v_items_kept, v_items_removed
  FROM public.compact_sale_order_items(p_sale_order_id);

  RETURN jsonb_build_object(
    'items_kept', COALESCE(v_items_kept,0), 'items_removed', COALESCE(v_items_removed,0),
    'ops_kept',   COALESCE(v_ops_kept,0),   'ops_removed',   COALESCE(v_ops_removed,0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.compact_sale_order(uuid) TO authenticated, service_role;
